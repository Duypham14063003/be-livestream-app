import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  ReservationSource,
  ReservationStatus,
  SeatStatus,
  TicketStatus,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { REALTIME_TOPICS } from "../../common/constants/realtime-topics";
import { PrismaService } from "../../prisma/prisma.service";
import { SystemSettingsService } from "../system-settings/system-settings.service";
import { ConfirmReservationDto } from "./dto/confirm-reservation.dto";
import { CreateReservationDto } from "./dto/create-reservation.dto";
import { ExpireReservationDto } from "./dto/expire-reservation.dto";

type ReservationMutationRecord = Prisma.ReservationGetPayload<{
  include: {
    reservationSeats: true;
    order: {
      include: {
        payment: true;
        tickets: true;
      };
    };
  };
}>;

interface CreateHeldReservationParams {
  userId: string;
  eventId: string;
  seatIds: string[];
  source: ReservationSource;
  expiresAt: Date;
  auditAction: string;
}

export interface ExpiredReservationResult {
  id: string;
  eventId: string;
  status: ReservationStatus;
  seatIds: string[];
  linkedOrderId: string | null;
  linkedOrderStatus: OrderStatus | null;
  usedManualPendingResolver: boolean;
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly systemSettingsService: SystemSettingsService,
  ) {}

  async createHold(dto: CreateReservationDto, authUser: { userId: string }) {
    const event = await this.prisma.event.findUnique({
      where: { id: dto.eventId },
    });
    if (!event) {
      throw new NotFoundException("Event không tồn tại");
    }

    const uniqueSeatIds = [...new Set(dto.seatIds)];
    if (uniqueSeatIds.length !== dto.seatIds.length) {
      throw new BadRequestException("seatIds không được trùng nhau");
    }

    const ttlMinutes = Number(
      this.configService.get<string>("SEAT_HOLD_TTL_MINUTES") ?? 10,
    );
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const reservation = await this.prisma.$transaction((tx) =>
      this.createHeldReservationRecord(tx, {
        userId: dto.userId,
        eventId: dto.eventId,
        seatIds: dto.seatIds,
        source: ReservationSource.CHECKOUT,
        expiresAt,
        auditAction: "RESERVATION_HELD",
      }),
    );

    const reservation = await this.prisma.$transaction(async (tx) => {
      const updatedSeats = await tx.seat.updateMany({
        where: {
          id: { in: uniqueSeatIds },
          eventId: dto.eventId,
          status: SeatStatus.AVAILABLE,
        },
        data: {
          status: SeatStatus.HELD,
        },
      });

      if (updatedSeats.count !== uniqueSeatIds.length) {
        throw new ConflictException(
          "Một hoặc nhiều ghế đã được giữ/mua bởi người khác, vui lòng chọn ghế khác",
        );
      }

      const seats = await tx.seat.findMany({
        where: {
          id: { in: uniqueSeatIds },
        },
        select: {
          id: true,
          price: true,
        },
      });

      const createdReservation = await tx.reservation.create({
        data: {
          userId: authUser.userId,
          eventId: dto.eventId,
          status: ReservationStatus.HELD,
          expiresAt,
          reservationSeats: {
            create: seats.map((seat) => ({
              seatId: seat.id,
              price: seat.price,
            })),
          },
        },
        include: {
          reservationSeats: {
            include: {
              seat: true,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: "RESERVATION_HELD",
          entityType: "reservation",
          entityId: createdReservation.id,
          payload: {
            eventId: dto.eventId,
            userId: authUser.userId,
            seatIds: uniqueSeatIds,
            expiresAt,
          },
        },
      });

      return createdReservation;
    });

    this.eventEmitter.emit(REALTIME_TOPICS.SEAT_UPDATED, {
      eventId: dto.eventId,
      seatIds: uniqueSeatIds,
      status: SeatStatus.HELD,
      reservationId: reservation.id,
      expiresAt: reservation.expiresAt,
    });

    return reservation;
  }

  async createManualPendingHold(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      eventId: string;
      seatIds: string[];
      expiresAt?: Date;
    },
  ) {
    const ttlSetting =
      await this.systemSettingsService.getManualPendingOrderTtlSetting(tx);
    const expiresAt =
      params.expiresAt ??
      this.systemSettingsService.buildManualPendingOrderExpiry(
        ttlSetting.ttlMinutes,
      );

    return this.createHeldReservationRecord(tx, {
      userId: params.userId,
      eventId: params.eventId,
      seatIds: params.seatIds,
      source: ReservationSource.ADMIN_MANUAL_ORDER,
      expiresAt,
      auditAction: "RESERVATION_HELD",
    });
  }

  async confirmReservation(reservationId: string, dto: ConfirmReservationDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          reservationSeats: true,
          order: {
            include: {
              payment: true,
              tickets: true,
            },
          },
        },
      });

      if (!reservation) {
        throw new NotFoundException("Reservation khÃ´ng tá»“n táº¡i");
      }

      if (reservation.userId !== authUser.userId) {
        throw new ForbiddenException(
          "Bạn không có quyền xác nhận reservation này",
        );
      }

      if (
        reservation.status === ReservationStatus.CONFIRMED &&
        reservation.order
      ) {
        return {
          reservation,
          order: reservation.order,
          isIdempotent: true,
        };
      }

      if (reservation.status !== ReservationStatus.HELD) {
        throw new BadRequestException(
          "Reservation khÃ´ng á»Ÿ tráº¡ng thÃ¡i HELD",
        );
      }

      if (reservation.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException(
          "Reservation Ä‘Ã£ háº¿t háº¡n, vui lÃ²ng giá»¯ gháº¿ láº¡i",
        );
      }

      if (reservation.reservationSeats.length === 0) {
        throw new BadRequestException("Reservation chÆ°a cÃ³ gháº¿ nÃ o");
      }

      const conflictingPayment = await tx.payment.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });

      if (
        conflictingPayment &&
        conflictingPayment.orderId !== reservation.order?.id
      ) {
        throw new ConflictException(
          "idempotencyKey Ä‘Ã£ Ä‘Æ°á»£c sá»­ dá»¥ng cho giao dá»‹ch khÃ¡c",
        );
      }

      const totalAmount = reservation.reservationSeats.reduce(
        (sum, item) => sum + item.price,
        0,
      );
      const currency =
        this.configService.get<string>("DEFAULT_CURRENCY") ?? "USD";

      const order = reservation.order
        ? await tx.order.update({
            where: { id: reservation.order.id },
            data: {
              amount: totalAmount,
              currency,
              status: OrderStatus.PAID,
            },
            include: {
              payment: true,
              tickets: true,
            },
          })
        : await tx.order.create({
            data: {
              userId: reservation.userId,
              reservationId: reservation.id,
              amount: totalAmount,
              currency,
              status: OrderStatus.PAID,
            },
            include: {
              payment: true,
              tickets: true,
            },
          });

      const payment = order.payment
        ? await tx.payment.update({
            where: {
              id: order.payment.id,
            },
            data: {
              provider: dto.provider,
              providerRef: dto.providerRef,
              status: PaymentStatus.PAID,
              paidAt: new Date(),
            },
          })
        : await tx.payment.create({
            data: {
              orderId: order.id,
              provider: dto.provider,
              providerRef: dto.providerRef,
              status: PaymentStatus.PAID,
              paidAt: new Date(),
              idempotencyKey: dto.idempotencyKey,
            },
          });

      const existingTicketSeatIds = new Set(
        order.tickets.map((ticket) => ticket.seatId),
      );
      const newTicketSeats = reservation.reservationSeats.filter(
        (seat) => !existingTicketSeatIds.has(seat.seatId),
      );

      if (newTicketSeats.length > 0) {
        await tx.ticket.createMany({
          data: newTicketSeats.map((item) => ({
            orderId: order.id,
            seatId: item.seatId,
            qrCode: randomUUID(),
            pdfUrl: `https://cdn.example.com/tickets/${order.id}/${item.seatId}.pdf`,
            status: TicketStatus.ACTIVE,
          })),
        });
      }

      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          status: ReservationStatus.CONFIRMED,
        },
      });

      const seatIds = reservation.reservationSeats.map((item) => item.seatId);
      await tx.seat.updateMany({
        where: {
          id: { in: seatIds },
          status: SeatStatus.HELD,
        },
        data: {
          status: SeatStatus.BOOKED,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "RESERVATION_CONFIRMED",
          entityType: "reservation",
          entityId: reservation.id,
          payload: {
            paymentId: payment.id,
            orderId: order.id,
            seatIds,
          },
        },
      });

      const orderWithTickets = await tx.order.findUnique({
        where: {
          id: order.id,
        },
        include: {
          payment: true,
          tickets: true,
        },
      });

      return {
        reservation,
        order: orderWithTickets,
        seatIds,
        isIdempotent: false,
      };
    });

    if (!result.order) {
      throw new NotFoundException("Order khÃ´ng tá»“n táº¡i sau khi confirm");
    }

    this.eventEmitter.emit(REALTIME_TOPICS.ORDER_PAID, {
      reservationId,
      orderId: result.order.id,
      isIdempotent: result.isIdempotent,
    });

    if (result.seatIds && result.seatIds.length > 0) {
      this.eventEmitter.emit(REALTIME_TOPICS.SEAT_UPDATED, {
        eventId: result.reservation.eventId,
        seatIds: result.seatIds,
        status: SeatStatus.BOOKED,
      });

      this.eventEmitter.emit(REALTIME_TOPICS.TICKET_ISSUED, {
        orderId: result.order.id,
        reservationId,
        seatIds: result.seatIds,
      });
    }

    return result.order;
  }

  async expireReservation(reservationId: string, dto?: ExpireReservationDto) {
    const reason = dto?.reason ?? "manual_expire";
    const expired = await this.prisma.$transaction(async (tx) => {
      const reservation = await this.getReservationForMutation(
        tx,
        reservationId,
      );

      if (!reservation) {
        throw new NotFoundException("Reservation khÃ´ng tá»“n táº¡i");
      }

      if (reservation.status === ReservationStatus.CONFIRMED) {
        throw new BadRequestException(
          "Reservation Ä‘Ã£ xÃ¡c nháº­n, khÃ´ng thá»ƒ expire",
        );
      }

      if (reservation.status === ReservationStatus.EXPIRED) {
        return {
          id: reservation.id,
          eventId: reservation.eventId,
          status: reservation.status,
          seatIds: reservation.reservationSeats.map((item) => item.seatId),
          linkedOrderId: reservation.order?.id ?? null,
          linkedOrderStatus: reservation.order?.status ?? null,
          usedManualPendingResolver: false,
        };
      }

      if (this.isManualPendingCleanupCandidate(reservation)) {
        return this.resolvePendingManualOrderCleanup(tx, reservation.id, {
          reason,
          orderAction: "cancel",
        });
      }

      return this.applyReservationExpiration(tx, reservation, reason);
    });

    this.emitReservationExpiredEvents(expired, reason);

    return expired;
  }

  async expireStaleReservations() {
    const staleReservations = await this.prisma.reservation.findMany({
      where: {
        status: ReservationStatus.HELD,
        expiresAt: {
          lte: new Date(),
        },
      },
      include: {
        reservationSeats: true,
        order: {
          include: {
            payment: true,
            tickets: true,
          },
        },
      },
    });

    if (staleReservations.length === 0) {
      return { expiredCount: 0, releasedSeats: [] };
    }

    const expiredReservations: Array<
      ExpiredReservationResult & { reason: string }
    > = [];

    await this.prisma.$transaction(async (tx) => {
      for (const reservation of staleReservations) {
        const reason = "ttl_expired";
        const expired = this.isManualPendingCleanupCandidate(reservation)
          ? await this.resolvePendingManualOrderCleanup(tx, reservation.id, {
              reason,
              orderAction: "cancel",
            })
          : await this.applyReservationExpiration(tx, reservation, reason);

        expiredReservations.push({
          ...expired,
          reason,
        });
      }
    });

    for (const expired of expiredReservations) {
      this.emitReservationExpiredEvents(expired, expired.reason);
    }

    return {
      expiredCount: expiredReservations.length,
      releasedSeats: [
        ...new Set(expiredReservations.flatMap((item) => item.seatIds)),
      ],
    };
  }

  async resolvePendingManualOrderCleanup(
    tx: Prisma.TransactionClient,
    reservationId: string,
    options: {
      reason: string;
      orderAction: "cancel" | "delete";
    },
  ) {
    const reservation = await this.getReservationForMutation(tx, reservationId);

    if (!reservation) {
      throw new NotFoundException("Reservation khÃ´ng tá»“n táº¡i");
    }

    if (!this.isManualPendingCleanupCandidate(reservation)) {
      throw new BadRequestException(
        "Reservation is not backing an eligible manual pending order.",
      );
    }

    return this.applyReservationExpiration(
      tx,
      reservation,
      options.reason,
      options.orderAction,
    );
  }

  emitReservationExpiredEvents(
    expired: ExpiredReservationResult,
    reason: string,
  ) {
    this.eventEmitter.emit(REALTIME_TOPICS.RESERVATION_EXPIRED, {
      reservationId: expired.id,
      reason,
      linkedOrderId: expired.linkedOrderId,
      linkedOrderStatus: expired.linkedOrderStatus,
      usedManualPendingResolver: expired.usedManualPendingResolver,
    });

    if (expired.seatIds.length > 0) {
      this.eventEmitter.emit(REALTIME_TOPICS.SEAT_UPDATED, {
        eventId: expired.eventId,
        reservationId: expired.id,
        seatIds: expired.seatIds,
        status: SeatStatus.AVAILABLE,
      });
    }
  }

  getReservation(id: string, authUser: { userId: string }) {
    return this.prisma.reservation.findUnique({
      where: { id },
      include: {
        reservationSeats: {
          include: {
            seat: true,
          },
        },
        order: {
          include: {
            payment: true,
            tickets: true,
          },
        },
      },
    });
  }
  private async createHeldReservationRecord(
    tx: Prisma.TransactionClient,
    params: CreateHeldReservationParams,
  ) {
    const [user, event] = await Promise.all([
      tx.user.findUnique({ where: { id: params.userId } }),
      tx.event.findUnique({ where: { id: params.eventId } }),
    ]);

    if (!user) {
      throw new NotFoundException("User khÃ´ng tá»“n táº¡i");
    }

    if (!event) {
      throw new NotFoundException("Event khÃ´ng tá»“n táº¡i");
    }

    const uniqueSeatIds = this.assertUniqueSeatIds(params.seatIds);
    const updatedSeats = await tx.seat.updateMany({
      where: {
        id: { in: uniqueSeatIds },
        eventId: params.eventId,
        status: SeatStatus.AVAILABLE,
      },
      data: {
        status: SeatStatus.HELD,
      },
    });

    if (updatedSeats.count !== uniqueSeatIds.length) {
      throw new ConflictException(
        "Má»™t hoáº·c nhiá»u gháº¿ Ä‘Ã£ Ä‘Æ°á»£c giá»¯/mua bá»Ÿi ngÆ°á»i khÃ¡c, vui lÃ²ng chá»n gháº¿ khÃ¡c",
      );
    }

    const seats = await tx.seat.findMany({
      where: {
        id: { in: uniqueSeatIds },
      },
      select: {
        id: true,
        price: true,
      },
    });

    const reservation = await tx.reservation.create({
      data: {
        userId: params.userId,
        eventId: params.eventId,
        status: ReservationStatus.HELD,
        source: params.source,
        expiresAt: params.expiresAt,
        reservationSeats: {
          create: seats.map((seat) => ({
            seatId: seat.id,
            price: seat.price,
          })),
        },
      },
      include: {
        reservationSeats: {
          include: {
            seat: true,
          },
        },
      },
    });

    await tx.auditLog.create({
      data: {
        action: params.auditAction,
        entityType: "reservation",
        entityId: reservation.id,
        payload: {
          eventId: params.eventId,
          userId: params.userId,
          seatIds: uniqueSeatIds,
          expiresAt: params.expiresAt,
          source: params.source,
        },
      },
    });

    return reservation;
  }

  private async getReservationForMutation(
    client: Prisma.TransactionClient | PrismaService,
    reservationId: string,
  ) {
    return client.reservation.findUnique({
      where: {
        id: reservationId,
      },
      include: {
        reservationSeats: true,
        order: {
          include: {
            payment: true,
            tickets: true,
          },
        },
      },
    });
  }

  private async applyReservationExpiration(
    tx: Prisma.TransactionClient,
    reservation: ReservationMutationRecord,
    reason: string,
    manualOrderAction: "cancel" | "delete" = "cancel",
  ): Promise<ExpiredReservationResult> {
    const seatIds = reservation.reservationSeats.map((item) => item.seatId);
    const updatedReservation =
      reservation.status === ReservationStatus.EXPIRED
        ? reservation
        : await tx.reservation.update({
            where: {
              id: reservation.id,
            },
            data: {
              status: ReservationStatus.EXPIRED,
            },
            include: {
              reservationSeats: true,
              order: {
                include: {
                  payment: true,
                  tickets: true,
                },
              },
            },
          });

    if (seatIds.length > 0) {
      await tx.seat.updateMany({
        where: {
          id: { in: seatIds },
          status: SeatStatus.HELD,
        },
        data: {
          status: SeatStatus.AVAILABLE,
        },
      });
    }

    let linkedOrderId = updatedReservation.order?.id ?? null;
    let linkedOrderStatus = updatedReservation.order?.status ?? null;
    let usedManualPendingResolver = false;

    if (
      updatedReservation.order &&
      this.isManualPendingCleanupCandidate(updatedReservation)
    ) {
      usedManualPendingResolver = true;

      if (manualOrderAction === "delete") {
        await tx.order.delete({
          where: {
            id: updatedReservation.order.id,
          },
        });
        linkedOrderStatus = null;
      } else {
        const cancelledOrder = await tx.order.update({
          where: {
            id: updatedReservation.order.id,
          },
          data: {
            status: OrderStatus.CANCELLED,
          },
        });
        linkedOrderStatus = cancelledOrder.status;
      }
    }

    await tx.auditLog.create({
      data: {
        action: "RESERVATION_EXPIRED",
        entityType: "reservation",
        entityId: updatedReservation.id,
        payload: {
          reason,
          seatIds,
          source: updatedReservation.source,
          linkedOrderId,
          linkedOrderResolution: usedManualPendingResolver
            ? manualOrderAction
            : null,
        },
      },
    });

    return {
      id: updatedReservation.id,
      eventId: updatedReservation.eventId,
      status: updatedReservation.status,
      seatIds,
      linkedOrderId,
      linkedOrderStatus,
      usedManualPendingResolver,
    };
  }

  private isManualPendingCleanupCandidate(
    reservation: Pick<ReservationMutationRecord, "status" | "source" | "order">,
  ) {
    if (
      reservation.status !== ReservationStatus.HELD &&
      reservation.status !== ReservationStatus.EXPIRED
    ) {
      return false;
    }

    return (
      reservation.source === ReservationSource.ADMIN_MANUAL_ORDER &&
      reservation.order?.status === OrderStatus.PENDING &&
      !reservation.order.payment &&
      reservation.order.tickets.length === 0
    );
  }

  private emitReservationHeldEvents(
    eventId: string,
    reservationId: string,
    seatIds: string[],
    expiresAt: Date,
  ) {
    this.eventEmitter.emit(REALTIME_TOPICS.SEAT_UPDATED, {
      eventId,
      seatIds,
      status: SeatStatus.HELD,
      reservationId,
      expiresAt,
    });
  }

  private assertUniqueSeatIds(seatIds: string[]) {
    const uniqueSeatIds = [...new Set(seatIds)];

    if (uniqueSeatIds.length !== seatIds.length) {
      throw new BadRequestException("seatIds khÃ´ng Ä‘Æ°á»£c trÃ¹ng nhau");
    }

    return uniqueSeatIds;
  }
}
