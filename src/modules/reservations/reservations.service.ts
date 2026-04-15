import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  OrderStatus,
  PaymentStatus,
  ReservationStatus,
  SeatStatus,
  TicketStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { REALTIME_TOPICS } from '../../common/constants/realtime-topics';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfirmReservationDto } from './dto/confirm-reservation.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ExpireReservationDto } from './dto/expire-reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createHold(dto: CreateReservationDto, authUser: { userId: string }) {
    const event = await this.prisma.event.findUnique({ where: { id: dto.eventId } });
    if (!event) {
      throw new NotFoundException('Event không tồn tại');
    }

    const uniqueSeatIds = [...new Set(dto.seatIds)];
    if (uniqueSeatIds.length !== dto.seatIds.length) {
      throw new BadRequestException('seatIds không được trùng nhau');
    }

    const ttlMinutes = Number(this.configService.get<string>('SEAT_HOLD_TTL_MINUTES') ?? 10);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

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
          'Một hoặc nhiều ghế đã được giữ/mua bởi người khác, vui lòng chọn ghế khác',
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
          action: 'RESERVATION_HELD',
          entityType: 'reservation',
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

  async confirmReservation(reservationId: string, dto: ConfirmReservationDto, authUser: { userId: string }) {
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
        throw new NotFoundException('Reservation không tồn tại');
      }

      if (reservation.userId !== authUser.userId) {
        throw new ForbiddenException('Bạn không có quyền xác nhận reservation này');
      }

      if (reservation.status === ReservationStatus.CONFIRMED && reservation.order) {
        return {
          reservation,
          order: reservation.order,
          isIdempotent: true,
        };
      }

      if (reservation.status !== ReservationStatus.HELD) {
        throw new BadRequestException('Reservation không ở trạng thái HELD');
      }

      if (reservation.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException('Reservation đã hết hạn, vui lòng giữ ghế lại');
      }

      if (reservation.reservationSeats.length === 0) {
        throw new BadRequestException('Reservation chưa có ghế nào');
      }

      const conflictingPayment = await tx.payment.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });

      if (conflictingPayment && conflictingPayment.orderId !== reservation.order?.id) {
        throw new ConflictException('idempotencyKey đã được sử dụng cho giao dịch khác');
      }

      const totalAmount = reservation.reservationSeats.reduce((sum, item) => sum + item.price, 0);
      const currency = this.configService.get<string>('DEFAULT_CURRENCY') ?? 'USD';

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

      const existingTicketSeatIds = new Set(order.tickets.map((ticket) => ticket.seatId));
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
          action: 'RESERVATION_CONFIRMED',
          entityType: 'reservation',
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
      throw new NotFoundException('Order không tồn tại sau khi confirm');
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
    const expired = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: {
          id: reservationId,
        },
        include: {
          reservationSeats: true,
        },
      });

      if (!reservation) {
        throw new NotFoundException('Reservation không tồn tại');
      }

      if (reservation.status === ReservationStatus.CONFIRMED) {
        throw new BadRequestException('Reservation đã xác nhận, không thể expire');
      }

      const seatIds = reservation.reservationSeats.map((item) => item.seatId);

      if (reservation.status === ReservationStatus.EXPIRED) {
        return {
          id: reservation.id,
          eventId: reservation.eventId,
          status: reservation.status,
          seatIds,
        };
      }

      const updatedReservation = await tx.reservation.update({
        where: {
          id: reservation.id,
        },
        data: {
          status: ReservationStatus.EXPIRED,
        },
      });

      await tx.seat.updateMany({
        where: {
          id: { in: seatIds },
          status: SeatStatus.HELD,
        },
        data: {
          status: SeatStatus.AVAILABLE,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'RESERVATION_EXPIRED',
          entityType: 'reservation',
          entityId: reservation.id,
          payload: {
            reason: dto?.reason ?? 'manual_expire',
            seatIds,
          },
        },
      });

      return {
        id: updatedReservation.id,
        eventId: updatedReservation.eventId,
        status: updatedReservation.status,
        seatIds,
      };
    });

    this.eventEmitter.emit(REALTIME_TOPICS.RESERVATION_EXPIRED, {
      reservationId,
      reason: dto?.reason ?? 'manual_expire',
    });

    if (expired.seatIds.length > 0) {
      this.eventEmitter.emit(REALTIME_TOPICS.SEAT_UPDATED, {
        eventId: expired.eventId,
        reservationId,
        seatIds: expired.seatIds,
        status: SeatStatus.AVAILABLE,
      });
    }

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
      },
    });

    if (staleReservations.length === 0) {
      return { expiredCount: 0, releasedSeats: [] };
    }

    const expiredIds: string[] = [];
    const releasedSeats: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const reservation of staleReservations) {
        const seatIds = reservation.reservationSeats.map((item) => item.seatId);

        await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            status: ReservationStatus.EXPIRED,
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

        await tx.auditLog.create({
          data: {
            action: 'RESERVATION_EXPIRED',
            entityType: 'reservation',
            entityId: reservation.id,
            payload: {
              reason: 'ttl_expired',
              seatIds,
            },
          },
        });

        expiredIds.push(reservation.id);
        releasedSeats.push(...seatIds);
      }
    });

    for (const reservationId of expiredIds) {
      this.eventEmitter.emit(REALTIME_TOPICS.RESERVATION_EXPIRED, {
        reservationId,
        reason: 'ttl_expired',
      });
    }

    if (releasedSeats.length > 0) {
      this.eventEmitter.emit(REALTIME_TOPICS.SEAT_UPDATED, {
        seatIds: [...new Set(releasedSeats)],
        status: SeatStatus.AVAILABLE,
      });
    }

    return {
      expiredCount: expiredIds.length,
      releasedSeats: [...new Set(releasedSeats)],
    };
  }

  async getReservation(id: string, authUser: { userId: string }) {
    const reservation = await this.prisma.reservation.findUnique({
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

    if (!reservation) {
      throw new NotFoundException('Reservation không tồn tại');
    }

    if (reservation.userId !== authUser.userId) {
      throw new ForbiddenException('Bạn không có quyền xem reservation này');
    }

    return reservation;
  }
}
