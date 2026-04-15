import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  ReservationSource,
  ReservationStatus,
  SeatStatus,
  TicketStatus,
} from "@prisma/client";
import { REALTIME_TOPICS } from "../../../common/constants/realtime-topics";
import { PrismaService } from "../../../prisma/prisma.service";
import { PaymentsService } from "../../payments/payments.service";
import { ReservationsService } from "../../reservations/reservations.service";
import { MANUAL_PENDING_ORDER_TTL_SETTING_KEY } from "../../system-settings/system-settings.constants";
import { SystemSettingsService } from "../../system-settings/system-settings.service";
import { TicketsService } from "../../tickets/tickets.service";
import {
  buildAdminListMeta,
  normalizeAdminListQuery,
  type NormalizedAdminListQuery,
} from "../common/admin-listing";
import {
  ADMIN_ORDER_AUDIT_ACTIONS,
  type AdminManualOrderCreatedAuditPayload,
  type AdminManualOrderDeletedAuditPayload,
  type AdminManualOrderSeatsReplacedAuditPayload,
  type AdminManualPendingTtlUpdatedAuditPayload,
  type AdminOrderCancelledAuditPayload,
} from "./manual-order-audit.constants";
import {
  ADMIN_PAYMENT_AUDIT_ACTIONS,
  type AdminPaymentDeletedAuditPayload,
  type AdminPaymentRecordedAuditPayload,
  type AdminPaymentRetryAuditPayload,
  type AdminPaymentStatusUpdatedAuditPayload,
} from "./admin-payment-audit.constants";
import { CancelAdminOrderDto } from "./dto/cancel-admin-order.dto";
import { CreateManualOrderDto } from "./dto/create-manual-order.dto";
import {
  AdminOrdersQueryDto,
  AdminPaymentsQueryDto,
  AdminRefundsQueryDto,
  AdminTicketsQueryDto,
} from "./dto/admin-operations-query.dto";
import { ReplaceManualOrderSeatsDto } from "./dto/replace-manual-order-seats.dto";
import { UpdateManualPendingSettingDto } from "./dto/update-manual-pending-setting.dto";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { UpdatePaymentStatusDto } from "./dto/update-payment-status.dto";
import { UpdateTicketStatusDto } from "./dto/update-ticket-status.dto";
import { VoidTicketDto } from "./dto/void-ticket.dto";
import {
  ADMIN_TICKET_AUDIT_ACTIONS,
  type AdminTicketIssuedAuditPayload,
  type AdminTicketStatusUpdatedAuditPayload,
  type AdminTicketVoidedAuditPayload,
  type AdminTicketResendAttemptedAuditPayload,
  type AdminTicketDeletedAuditPayload,
} from "./admin-ticket-audit.constants";

const ORDER_SORT_FIELDS = ["createdAt", "amount", "status"] as const;
const PAYMENT_SORT_FIELDS = [
  "createdAt",
  "paidAt",
  "status",
  "provider",
] as const;
const REFUND_SORT_FIELDS = ["createdAt", "amount", "status"] as const;
const TICKET_SORT_FIELDS = ["createdAt", "checkedInAt", "status"] as const;

type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];
type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];
type RefundSortField = (typeof REFUND_SORT_FIELDS)[number];
type TicketSortField = (typeof TICKET_SORT_FIELDS)[number];

type OrderControlsSource = {
  status: OrderStatus;
  payment:
    | {
        status: PaymentStatus;
        refunds: Array<{
          status: RefundStatus;
        }>;
      }
    | null;
  tickets: Array<unknown>;
  reservation: {
    source: ReservationSource;
    status: ReservationStatus;
    expiresAt: Date;
  };
};

@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly ticketsService: TicketsService,
    private readonly paymentsService: PaymentsService,
    private readonly reservationsService: ReservationsService,
    private readonly systemSettingsService: SystemSettingsService,
  ) {}

  async getManualPendingSetting() {
    return {
      setting: await this.systemSettingsService.getManualPendingOrderTtlSetting(),
    };
  }

  async updateManualPendingSetting(
    dto: UpdateManualPendingSettingDto,
    adminUserId: string,
  ) {
    const previous =
      await this.systemSettingsService.getManualPendingOrderTtlSetting();
    const setting = await this.systemSettingsService.updateManualPendingOrderTtlMinutes(
      dto.ttlMinutes,
    );
    const payload: AdminManualPendingTtlUpdatedAuditPayload = {
      adminId: adminUserId,
      previousTtlMinutes: previous.ttlMinutes,
      nextTtlMinutes: setting.ttlMinutes,
    };

    await this.prisma.auditLog.create({
      data: {
        action: ADMIN_ORDER_AUDIT_ACTIONS.updateTtl,
        entityType: "system_setting",
        entityId: MANUAL_PENDING_ORDER_TTL_SETTING_KEY,
        payload: payload as unknown as Prisma.InputJsonObject,
      },
    });

    return { setting };
  }

  async createManualOrder(dto: CreateManualOrderDto, adminUserId: string) {
    const adminNote = dto.adminNote?.trim() || null;
    const currency = this.configService.get<string>("DEFAULT_CURRENCY") ?? "USD";
    const created = await this.prisma.$transaction(async (tx) => {
      const reservation = await this.reservationsService.createManualPendingHold(
        tx,
        {
          userId: dto.userId,
          eventId: dto.eventId,
          seatIds: dto.seatIds,
        },
      );
      const seatIds = reservation.reservationSeats.map((item) => item.seatId);
      const amount = reservation.reservationSeats.reduce(
        (sum, item) => sum + item.price,
        0,
      );
      const order = await tx.order.create({
        data: {
          userId: dto.userId,
          reservationId: reservation.id,
          amount,
          currency,
          status: OrderStatus.PENDING,
          adminNote,
        },
      });
      const payload: AdminManualOrderCreatedAuditPayload = {
        adminId: adminUserId,
        userId: dto.userId,
        eventId: dto.eventId,
        reservationId: reservation.id,
        seatIds,
        expiresAt: reservation.expiresAt.toISOString(),
        adminNote,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_ORDER_AUDIT_ACTIONS.create,
          entityType: "order",
          entityId: order.id,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return {
        id: order.id,
        reservationId: reservation.id,
        eventId: reservation.eventId,
        seatIds,
        expiresAt: reservation.expiresAt,
      };
    });

    this.eventEmitter.emit(REALTIME_TOPICS.SEAT_UPDATED, {
      eventId: created.eventId,
      reservationId: created.reservationId,
      seatIds: created.seatIds,
      status: SeatStatus.HELD,
      expiresAt: created.expiresAt,
    });

    return {
      data: {
        id: created.id,
      },
    };
  }

  async replaceManualOrderSeats(
    orderId: string,
    dto: ReplaceManualOrderSeatsDto,
    adminUserId: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await this.getOrderForMutation(tx, orderId);

      if (!order) {
        throw new NotFoundException("Order was not found.");
      }

      const controls = this.buildOrderControls(order);
      if (!controls.canUpdateSeats) {
        throw new BadRequestException(
          controls.guardMessage ?? "This order cannot update seats.",
        );
      }

      const nextSeatIds = this.assertUniqueSeatIds(dto.seatIds);
      const previousSeatIds = order.reservation.reservationSeats.map(
        (item) => item.seatId,
      );
      const previousSeatIdSet = new Set(previousSeatIds);
      const nextSeatIdSet = new Set(nextSeatIds);
      const addedSeatIds = nextSeatIds.filter((seatId) => !previousSeatIdSet.has(seatId));
      const removedSeatIds = previousSeatIds.filter(
        (seatId) => !nextSeatIdSet.has(seatId),
      );

      if (addedSeatIds.length > 0) {
        const updatedSeats = await tx.seat.updateMany({
          where: {
            id: { in: addedSeatIds },
            eventId: order.reservation.eventId,
            status: SeatStatus.AVAILABLE,
          },
          data: {
            status: SeatStatus.HELD,
          },
        });

        if (updatedSeats.count !== addedSeatIds.length) {
          throw new ConflictException(
            "One or more requested seats are no longer available.",
          );
        }
      }

      if (removedSeatIds.length > 0) {
        await tx.seat.updateMany({
          where: {
            id: { in: removedSeatIds },
            status: SeatStatus.HELD,
          },
          data: {
            status: SeatStatus.AVAILABLE,
          },
        });

        await tx.reservationSeat.deleteMany({
          where: {
            reservationId: order.reservationId,
            seatId: {
              in: removedSeatIds,
            },
          },
        });
      }

      if (addedSeatIds.length > 0) {
        const addedSeats = await tx.seat.findMany({
          where: {
            id: {
              in: addedSeatIds,
            },
          },
          select: {
            id: true,
            price: true,
          },
        });

        await tx.reservationSeat.createMany({
          data: addedSeats.map((seat) => ({
            reservationId: order.reservationId,
            seatId: seat.id,
            price: seat.price,
          })),
        });
      }

      const reservationSeats = await tx.reservationSeat.findMany({
        where: {
          reservationId: order.reservationId,
        },
      });
      const amount = reservationSeats.reduce((sum, item) => sum + item.price, 0);

      await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          amount,
        },
      });

      const payload: AdminManualOrderSeatsReplacedAuditPayload = {
        adminId: adminUserId,
        reservationId: order.reservationId,
        previousSeatIds,
        nextSeatIds,
        addedSeatIds,
        removedSeatIds,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_ORDER_AUDIT_ACTIONS.replaceSeats,
          entityType: "order",
          entityId: order.id,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return {
        eventId: order.reservation.eventId,
        reservationId: order.reservationId,
        addedSeatIds,
        removedSeatIds,
      };
    });

    if (result.addedSeatIds.length > 0) {
      this.eventEmitter.emit(REALTIME_TOPICS.SEAT_UPDATED, {
        eventId: result.eventId,
        reservationId: result.reservationId,
        seatIds: result.addedSeatIds,
        status: SeatStatus.HELD,
      });
    }

    if (result.removedSeatIds.length > 0) {
      this.eventEmitter.emit(REALTIME_TOPICS.SEAT_UPDATED, {
        eventId: result.eventId,
        reservationId: result.reservationId,
        seatIds: result.removedSeatIds,
        status: SeatStatus.AVAILABLE,
      });
    }

    return {
      data: {
        id: orderId,
      },
    };
  }

  async cancelOrder(
    orderId: string,
    dto: CancelAdminOrderDto,
    adminUserId: string,
  ) {
    const reason = dto.reason?.trim() || null;
    const order = await this.getOrderForMutation(this.prisma, orderId);

    if (!order) {
      throw new NotFoundException("Order was not found.");
    }

    const controls = this.buildOrderControls(order);
    if (!controls.canCancel || !controls.cancelMode) {
      throw new BadRequestException(
        controls.cancelMessage ?? "This order cannot be cancelled.",
      );
    }

    if (controls.cancelMode === "refund_request_only") {
      if (!order.payment) {
        throw new BadRequestException("Paid cancel requires an existing payment.");
      }

      const refund = await this.paymentsService.createRefund({
        paymentId: order.payment.id,
        reason: reason ?? `admin_cancel:${adminUserId}`,
        idempotencyKey: `admin_order_cancel_${order.id}`,
      });
      const payload: AdminOrderCancelledAuditPayload = {
        adminId: adminUserId,
        reservationId: order.reservationId,
        reason,
        mode: "refund_request_only",
        refundId: refund.id,
      };

      await this.prisma.auditLog.create({
        data: {
          action: ADMIN_ORDER_AUDIT_ACTIONS.cancel,
          entityType: "order",
          entityId: order.id,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return {
        data: {
          id: order.id,
          mode: controls.cancelMode,
        },
      };
    }

    const reservationReason = reason ?? `admin_order_cancel:${adminUserId}`;
    const expired = await this.prisma.$transaction(async (tx) => {
      const cleanup = await this.reservationsService.resolvePendingManualOrderCleanup(
        tx,
        order.reservationId,
        {
          reason: reservationReason,
          orderAction: "cancel",
        },
      );
      const payload: AdminOrderCancelledAuditPayload = {
        adminId: adminUserId,
        reservationId: order.reservationId,
        reason,
        mode: "release_hold",
        refundId: null,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_ORDER_AUDIT_ACTIONS.cancel,
          entityType: "order",
          entityId: order.id,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return cleanup;
    });

    this.reservationsService.emitReservationExpiredEvents(
      expired,
      reservationReason,
    );

    return {
      data: {
        id: order.id,
        mode: controls.cancelMode,
      },
    };
  }

  async deletePendingOrder(orderId: string, adminUserId: string) {
    const order = await this.getOrderForMutation(this.prisma, orderId);

    if (!order) {
      throw new NotFoundException("Order was not found.");
    }

    const controls = this.buildOrderControls(order);
    if (!controls.canDelete) {
      throw new BadRequestException(
        controls.guardMessage ?? "This order cannot be deleted.",
      );
    }

    const reason = `admin_order_delete:${adminUserId}`;
    const deleted = await this.prisma.$transaction(async (tx) => {
      const cleanup = await this.reservationsService.resolvePendingManualOrderCleanup(
        tx,
        order.reservationId,
        {
          reason,
          orderAction: "delete",
        },
      );
      const payload: AdminManualOrderDeletedAuditPayload = {
        adminId: adminUserId,
        reservationId: order.reservationId,
        seatIds: order.reservation.reservationSeats.map((item) => item.seatId),
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_ORDER_AUDIT_ACTIONS.delete,
          entityType: "order",
          entityId: order.id,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return cleanup;
    });

    this.reservationsService.emitReservationExpiredEvents(deleted, reason);

    return {
      success: true,
      orderId,
      seatsReleased: deleted.seatIds.length,
    };
  }

  // ─── Payment mutations ───────────────────────────────────────────────────────

  async createManualPayment(dto: CreatePaymentDto, adminUserId: string) {
    const paid = dto.paid !== false;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
        include: { payment: true },
      });

      if (!order) {
        throw new NotFoundException("Order not found.");
      }

      if (order.payment?.status === PaymentStatus.PAID) {
        throw new ConflictException("Order already has a paid payment.");
      }

      const paidAt = dto.paidAt ? new Date(dto.paidAt) : paid ? new Date() : null;
      const finalStatus = paid ? PaymentStatus.PAID : PaymentStatus.PENDING;

      const payment = await tx.payment.create({
        data: {
          orderId: dto.orderId,
          provider: dto.provider,
          status: finalStatus,
          providerRef: dto.providerRef ?? null,
          paidAt,
          idempotencyKey: `admin_manual_${dto.orderId}_${Date.now()}`,
        },
      });

      if (paid) {
        await tx.order.update({
          where: { id: dto.orderId },
          data: { status: OrderStatus.PAID },
        });
      }

      const payload: AdminPaymentRecordedAuditPayload = {
        adminId: adminUserId,
        orderId: dto.orderId,
        paymentId: payment.id,
        provider: dto.provider,
        amount: order.amount,
        paid,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_PAYMENT_AUDIT_ACTIONS.recorded,
          entityType: "payment",
          entityId: payment.id,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return { payment };
    });
  }

  async updatePaymentStatus(
    paymentId: string,
    dto: UpdatePaymentStatusDto,
    adminUserId: string,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException("Payment not found.");
    }

    if (payment.status === dto.status) {
      return { payment, idempotent: true };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: dto.status,
          paidAt: dto.status === PaymentStatus.PAID && !payment.paidAt ? new Date() : payment.paidAt,
        },
      });

      if (dto.status === PaymentStatus.PAID) {
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.PAID },
        });
      } else if (dto.status === PaymentStatus.FAILED) {
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.CANCELLED },
        });
      }

      const payload: AdminPaymentStatusUpdatedAuditPayload = {
        adminId: adminUserId,
        paymentId,
        previousStatus: payment.status,
        nextStatus: dto.status,
        note: null,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_PAYMENT_AUDIT_ACTIONS.statusUpdated,
          entityType: "payment",
          entityId: paymentId,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return nextPayment;
    });

    return { payment: updated, idempotent: false };
  }

  async retryPayment(paymentId: string, adminUserId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException("Payment not found.");
    }

    if (payment.status !== PaymentStatus.FAILED) {
      throw new ConflictException("Only FAILED payments can be retried.");
    }

    const previousRef = payment.providerRef;

    const updated = await this.prisma.$transaction(async (tx) => {
      const retried = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.PENDING,
          paidAt: null,
          providerRef: null,
        },
      });

      const payload: AdminPaymentRetryAuditPayload = {
        adminId: adminUserId,
        paymentId,
        previousProviderRef: previousRef,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_PAYMENT_AUDIT_ACTIONS.retry,
          entityType: "payment",
          entityId: paymentId,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return retried;
    });

    return { payment: updated };
  }

  async deletePayment(paymentId: string, adminUserId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException("Payment not found.");
    }

    if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.FAILED) {
      throw new ConflictException("Only PENDING or FAILED payments can be deleted.");
    }

    await this.prisma.$transaction(async (tx) => {
      const payload: AdminPaymentDeletedAuditPayload = {
        adminId: adminUserId,
        paymentId,
        amount: payment.order.amount,
        orderId: payment.orderId,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_PAYMENT_AUDIT_ACTIONS.deleted,
          entityType: "payment",
          entityId: paymentId,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      await tx.payment.delete({
        where: { id: paymentId },
      });
    });

    return { success: true, paymentId };
  }

  // ─── Ticket mutations ────────────────────────────────────────────────────────

  async createTicket(dto: CreateTicketDto, adminUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
        include: { payment: true, tickets: { include: { seat: true } } },
      });

      if (!order) {
        throw new NotFoundException("Order not found.");
      }

      if (order.status !== OrderStatus.PAID) {
        throw new ConflictException(
          `Cannot issue a ticket — order is "${order.status}". Only PAID orders can receive tickets.`,
        );
      }

      const seat = await tx.seat.findUnique({ where: { id: dto.seatId } });
      if (!seat) {
        throw new NotFoundException("Seat not found.");
      }

      const existingTicket = await tx.ticket.findUnique({
        where: { seatId: dto.seatId },
      });
      if (existingTicket) {
        throw new ConflictException(
          `Seat "${seat.zone}-${seat.row}-${seat.number}" already has an active ticket (${existingTicket.id}).`,
        );
      }

      const { randomUUID } = await import("crypto");
      const qrCode = randomUUID();

      const ticket = await tx.ticket.create({
        data: {
          orderId: dto.orderId,
          seatId: dto.seatId,
          qrCode,
          status: TicketStatus.ACTIVE,
        },
      });

      const payload: AdminTicketIssuedAuditPayload = {
        adminId: adminUserId,
        orderId: dto.orderId,
        userId: dto.userId,
        seatId: dto.seatId,
        eventId: dto.eventId,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_TICKET_AUDIT_ACTIONS.issued,
          entityType: "ticket",
          entityId: ticket.id,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return { ticket };
    });
  }

  async updateTicketStatus(
    ticketId: string,
    dto: UpdateTicketStatusDto,
    adminUserId: string,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException("Ticket not found.");
    }

    if (ticket.status === dto.status) {
      return { ticket, idempotent: true };
    }

    // Only ACTIVE tickets can transition
    if (ticket.status !== TicketStatus.ACTIVE) {
      throw new ConflictException(
        `Cannot change status of a ${ticket.status} ticket. Only ACTIVE tickets can be updated.`,
      );
    }

    // Forbidden transitions: USED → anything, REFUNDED → anything, EXPIRED → anything
    const FORBIDDEN_TRANSITIONS: TicketStatus[] = [
      TicketStatus.USED,
      TicketStatus.REFUNDED,
      TicketStatus.EXPIRED,
    ];
    if (FORBIDDEN_TRANSITIONS.includes(ticket.status)) {
      throw new ConflictException(
        `${ticket.status} tickets cannot be modified.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: dto.status,
          checkedInAt:
            dto.status === TicketStatus.USED ? new Date() : ticket.checkedInAt,
        },
      });

      const payload: AdminTicketStatusUpdatedAuditPayload = {
        adminId: adminUserId,
        ticketId,
        previousStatus: ticket.status,
        nextStatus: dto.status,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_TICKET_AUDIT_ACTIONS.statusUpdated,
          entityType: "ticket",
          entityId: ticketId,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return nextTicket;
    });

    return { ticket: updated, idempotent: false };
  }

  async voidTicket(
    ticketId: string,
    dto: VoidTicketDto,
    adminUserId: string,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { seat: true },
    });

    if (!ticket) {
      throw new NotFoundException("Ticket not found.");
    }

    if (ticket.status !== TicketStatus.ACTIVE) {
      throw new ConflictException(
        `Cannot void a ${ticket.status} ticket. Only ACTIVE tickets can be voided.`,
      );
    }

    const releaseSeat = dto.releaseSeat !== false;

    return this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.REFUNDED },
      });

      if (releaseSeat) {
        const conflictTicket = await tx.ticket.findFirst({
          where: { seatId: ticket.seatId, status: TicketStatus.ACTIVE },
        });
        if (conflictTicket && conflictTicket.id !== ticketId) {
          throw new ConflictException(
            `Cannot release seat — it already has an active ticket (${conflictTicket.id}).`,
          );
        }
        await tx.seat.update({
          where: { id: ticket.seatId },
          data: { status: SeatStatus.AVAILABLE },
        });
      }

      const payload: AdminTicketVoidedAuditPayload = {
        adminId: adminUserId,
        ticketId,
        seatReleased: releaseSeat,
        reason: dto.reason ?? null,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_TICKET_AUDIT_ACTIONS.voided,
          entityType: "ticket",
          entityId: ticketId,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      return { ticketId, seatReleased: releaseSeat };
    });
  }

  async resendTicket(ticketId: string, adminUserId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException("Ticket not found.");
    }

    await this.prisma.auditLog.create({
      data: {
        action: ADMIN_TICKET_AUDIT_ACTIONS.resendAttempted,
        entityType: "ticket",
        entityId: ticketId,
        payload: {
          adminId: adminUserId,
          ticketId,
        } as AdminTicketResendAttemptedAuditPayload as unknown as Prisma.InputJsonObject,
      },
    });

    return {
      success: true,
      message: "Email integration not implemented.",
    };
  }

  async deleteTicket(ticketId: string, adminUserId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException("Ticket not found.");
    }

    await this.prisma.$transaction(async (tx) => {
      const payload: AdminTicketDeletedAuditPayload = {
        adminId: adminUserId,
        ticketId,
        seatId: ticket.seatId,
        orderId: ticket.orderId,
      };

      await tx.auditLog.create({
        data: {
          action: ADMIN_TICKET_AUDIT_ACTIONS.deleted,
          entityType: "ticket",
          entityId: ticketId,
          payload: payload as unknown as Prisma.InputJsonObject,
        },
      });

      await tx.ticket.delete({ where: { id: ticketId } });
    });

    return { success: true, ticketId };
  }

  async getOrders(query: AdminOrdersQueryDto) {
    const listing = normalizeAdminListQuery(query, {
      allowedSortBy: ORDER_SORT_FIELDS,
      defaultSortBy: "createdAt",
      defaultSortOrder: "desc",
    });
    const where: Prisma.OrderWhereInput = {
      status:
        query.status && this.isOrderStatus(query.status)
          ? query.status
          : undefined,
      ...(query.search
        ? {
            OR: [
              {
                id: {
                  contains: query.search,
                },
              },
              {
                adminNote: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                user: {
                  displayName: {
                    contains: query.search,
                    mode: "insensitive",
                  },
                },
              },
              {
                user: {
                  email: {
                    contains: query.search,
                    mode: "insensitive",
                  },
                },
              },
              {
                reservation: {
                  event: {
                    title: {
                      contains: query.search,
                      mode: "insensitive",
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: this.buildOrdersOrderBy(listing),
        skip: listing.skip,
        take: listing.take,
        include: {
          user: true,
          payment: {
            include: {
              refunds: {
                orderBy: {
                  createdAt: "desc",
                },
                take: 1,
              },
            },
          },
          reservation: {
            include: {
              event: true,
            },
          },
          tickets: {
            select: {
              id: true,
            },
            take: 1,
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((order) => {
        const controls = this.buildOrderControls(order);

        return {
          id: order.id,
          amount: order.amount,
          currency: order.currency,
          status: order.status,
          paymentStatus: order.payment?.status ?? null,
          refundStatus: order.payment?.refunds[0]?.status ?? null,
          createdAt: order.createdAt.toISOString(),
          eventTitle: order.reservation.event.title,
          userName: order.user.displayName ?? order.user.email ?? order.user.id,
          reservationSource: order.reservation.source,
          adminNote: order.adminNote,
          expiresAt: order.reservation.expiresAt.toISOString(),
          controls,
        };
      }),
      meta: buildAdminListMeta(total, listing),
    };
  }

  async getOrderDetail(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        reservation: {
          include: {
            event: true,
            reservationSeats: {
              include: {
                seat: true,
              },
            },
          },
        },
        payment: {
          include: {
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
              include: {
                reviewedBy: true,
              },
            },
          },
        },
        tickets: true,
      },
    });

    if (!order) {
      throw new NotFoundException("Order was not found.");
    }

    const controls = this.buildOrderControls(order);

    return {
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        adminNote: order.adminNote,
        createdAt: order.createdAt.toISOString(),
        user: {
          id: order.user.id,
          displayName: order.user.displayName,
          email: order.user.email,
        },
        event: {
          id: order.reservation.event.id,
          title: order.reservation.event.title,
          startAt: order.reservation.event.startAt.toISOString(),
        },
        reservation: {
          id: order.reservation.id,
          status: order.reservation.status,
          source: order.reservation.source,
          expiresAt: order.reservation.expiresAt.toISOString(),
          expiredByClock: order.reservation.expiresAt.getTime() <= Date.now(),
        },
        controls,
        payment: order.payment
          ? {
              id: order.payment.id,
              provider: order.payment.provider,
              status: order.payment.status,
              paidAt: order.payment.paidAt?.toISOString() ?? null,
              providerRef: order.payment.providerRef,
            }
          : null,
        refunds:
          order.payment?.refunds.map((refund) => ({
            id: refund.id,
            amount: refund.amount,
            status: refund.status,
            reason: refund.reason,
            decisionNote: refund.decisionNote,
            createdAt: refund.createdAt.toISOString(),
            reviewedAt: refund.reviewedAt?.toISOString() ?? null,
            reviewedBy:
              refund.reviewedBy?.displayName ??
              refund.reviewedBy?.email ??
              refund.reviewedBy?.id ??
              null,
          })) ?? [],
        seats: order.reservation.reservationSeats.map((item) => ({
          id: item.seat.id,
          label: `${item.seat.zone}-${item.seat.row}-${item.seat.number}`,
          price: item.price,
        })),
        tickets: order.tickets.map((ticket) => ({
          id: ticket.id,
          status: ticket.status,
          pdfUrl: ticket.pdfUrl,
        })),
      },
    };
  }

  async getPayments(query: AdminPaymentsQueryDto) {
    const listing = normalizeAdminListQuery(query, {
      allowedSortBy: PAYMENT_SORT_FIELDS,
      defaultSortBy: "createdAt",
      defaultSortOrder: "desc",
    });
    const where: Prisma.PaymentWhereInput = {
      status:
        query.status && this.isPaymentStatus(query.status)
          ? query.status
          : undefined,
      ...(query.search
        ? {
            OR: [
              {
                id: {
                  contains: query.search,
                },
              },
              {
                orderId: {
                  contains: query.search,
                },
              },
              {
                providerRef: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                order: {
                  user: {
                    displayName: {
                      contains: query.search,
                      mode: "insensitive",
                    },
                  },
                },
              },
              {
                order: {
                  user: {
                    email: {
                      contains: query.search,
                      mode: "insensitive",
                    },
                  },
                },
              },
              {
                order: {
                  reservation: {
                    event: {
                      title: {
                        contains: query.search,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: this.buildPaymentsOrderBy(listing),
        skip: listing.skip,
        take: listing.take,
        include: {
          order: {
            include: {
              user: true,
              reservation: {
                include: {
                  event: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: payments.map((payment) => ({
        id: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        providerRef: payment.providerRef,
        status: payment.status,
        paidAt: payment.paidAt?.toISOString() ?? null,
        amount: payment.order.amount,
        currency: payment.order.currency,
        userName:
          payment.order.user.displayName ??
          payment.order.user.email ??
          payment.order.user.id,
        eventTitle: payment.order.reservation.event.title,
      })),
      meta: buildAdminListMeta(total, listing),
    };
  }

  async getRefunds(query: AdminRefundsQueryDto) {
    const listing = normalizeAdminListQuery(query, {
      allowedSortBy: REFUND_SORT_FIELDS,
      defaultSortBy: "createdAt",
      defaultSortOrder: "desc",
    });
    const where: Prisma.RefundWhereInput = {
      status:
        query.status && this.isRefundStatus(query.status)
          ? query.status
          : undefined,
      ...(query.search
        ? {
            OR: [
              {
                id: {
                  contains: query.search,
                },
              },
              {
                paymentId: {
                  contains: query.search,
                },
              },
              {
                reason: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                payment: {
                  orderId: {
                    contains: query.search,
                  },
                },
              },
              {
                payment: {
                  order: {
                    user: {
                      displayName: {
                        contains: query.search,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              },
              {
                payment: {
                  order: {
                    user: {
                      email: {
                        contains: query.search,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              },
              {
                payment: {
                  order: {
                    reservation: {
                      event: {
                        title: {
                          contains: query.search,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [refunds, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        orderBy: this.buildRefundsOrderBy(listing),
        skip: listing.skip,
        take: listing.take,
        include: {
          payment: {
            include: {
              order: {
                include: {
                  user: true,
                  payment: true,
                  reservation: {
                    include: {
                      event: true,
                    },
                  },
                },
              },
            },
          },
          reviewedBy: true,
        },
      }),
      this.prisma.refund.count({ where }),
    ]);

    return {
      data: refunds.map((refund) => ({
        id: refund.id,
        paymentId: refund.paymentId,
        orderId: refund.payment.orderId,
        amount: refund.amount,
        currency: refund.payment.order.currency,
        status: refund.status,
        reason: refund.reason,
        decisionNote: refund.decisionNote,
        createdAt: refund.createdAt.toISOString(),
        reviewedAt: refund.reviewedAt?.toISOString() ?? null,
        reviewedBy:
          refund.reviewedBy?.displayName ??
          refund.reviewedBy?.email ??
          refund.reviewedBy?.id ??
          null,
        paymentStatus: refund.payment.order.payment?.status ?? null,
        userName:
          refund.payment.order.user.displayName ??
          refund.payment.order.user.email ??
          refund.payment.order.user.id,
        eventTitle: refund.payment.order.reservation.event.title,
      })),
      meta: buildAdminListMeta(total, listing),
    };
  }

  async getTickets(query: AdminTicketsQueryDto) {
    const listing = normalizeAdminListQuery(query, {
      allowedSortBy: TICKET_SORT_FIELDS,
      defaultSortBy: "createdAt",
      defaultSortOrder: "desc",
    });
    const where: Prisma.TicketWhereInput = {
      status:
        query.status && this.isTicketStatus(query.status)
          ? query.status
          : undefined,
      ...(query.search
        ? {
            OR: [
              {
                id: {
                  contains: query.search,
                },
              },
              {
                qrCode: {
                  contains: query.search,
                },
              },
              {
                order: {
                  user: {
                    displayName: {
                      contains: query.search,
                      mode: "insensitive",
                    },
                  },
                },
              },
              {
                order: {
                  user: {
                    email: {
                      contains: query.search,
                      mode: "insensitive",
                    },
                  },
                },
              },
              {
                order: {
                  reservation: {
                    event: {
                      title: {
                        contains: query.search,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [tickets, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        orderBy: this.buildTicketsOrderBy(listing),
        skip: listing.skip,
        take: listing.take,
        include: {
          seat: true,
          order: {
            include: {
              user: true,
              payment: true,
              reservation: {
                include: {
                  event: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      data: tickets.map((ticket) => ({
        id: ticket.id,
        qrCode: ticket.qrCode,
        pdfUrl: ticket.pdfUrl,
        status: ticket.status,
        checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
        createdAt: ticket.createdAt.toISOString(),
        eventTitle: ticket.order.reservation.event.title,
        userName:
          ticket.order.user.displayName ??
          ticket.order.user.email ??
          ticket.order.user.id,
        seatLabel: `${ticket.seat.zone}-${ticket.seat.row}-${ticket.seat.number}`,
        paymentStatus: ticket.order.payment?.status ?? null,
      })),
      meta: buildAdminListMeta(total, listing),
    };
  }

  async getTicketDetail(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        seat: true,
        order: {
          include: {
            user: true,
            payment: {
              include: {
                refunds: {
                  orderBy: {
                    createdAt: "desc",
                  },
                  take: 1,
                },
              },
            },
            reservation: {
              include: {
                event: true,
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException("Ticket was not found.");
    }

    const document = await this.ticketsService.resolveTicketDocument(ticket.id);
    const latestRefund = ticket.order.payment?.refunds[0] ?? null;

    return {
      ticket: {
        id: ticket.id,
        qrCode: ticket.qrCode,
        pdfUrl: ticket.pdfUrl,
        status: ticket.status,
        checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
        createdAt: ticket.createdAt.toISOString(),
        user: {
          id: ticket.order.user.id,
          displayName: ticket.order.user.displayName,
          email: ticket.order.user.email,
        },
        event: {
          id: ticket.order.reservation.event.id,
          title: ticket.order.reservation.event.title,
          startAt: ticket.order.reservation.event.startAt.toISOString(),
        },
        seat: {
          id: ticket.seat.id,
          label: `${ticket.seat.zone}-${ticket.seat.row}-${ticket.seat.number}`,
          price: ticket.seat.price,
        },
        order: {
          id: ticket.order.id,
          status: ticket.order.status,
          amount: ticket.order.amount,
          currency: ticket.order.currency,
          createdAt: ticket.order.createdAt.toISOString(),
        },
        reservation: {
          id: ticket.order.reservation.id,
          status: ticket.order.reservation.status,
          expiresAt: ticket.order.reservation.expiresAt.toISOString(),
        },
        payment: ticket.order.payment
          ? {
              id: ticket.order.payment.id,
              status: ticket.order.payment.status,
              provider: ticket.order.payment.provider,
              paidAt: ticket.order.payment.paidAt?.toISOString() ?? null,
              providerRef: ticket.order.payment.providerRef,
            }
          : null,
        support: {
          document: {
            documentUrl: document.documentUrl,
            source: document.source,
            hasStoredDocument: document.hasStoredDocument,
            fileName: document.fileName,
          },
          identifiers: {
            ticketId: ticket.id,
            qrCode: ticket.qrCode,
            seatId: ticket.seat.id,
            orderId: ticket.order.id,
            reservationId: ticket.order.reservation.id,
            paymentId: ticket.order.payment?.id ?? null,
            providerRef: ticket.order.payment?.providerRef ?? null,
            userId: ticket.order.user.id,
            eventId: ticket.order.reservation.event.id,
          },
          troubleshooting: {
            accessState: this.resolveTicketAccessState(
              ticket.status,
              ticket.checkedInAt,
            ),
            deliveryState: this.resolveTicketDeliveryState(
              document.source,
              ticket.order.user.email,
              ticket.status,
              ticket.order.payment?.status ?? null,
            ),
            customerEmail: ticket.order.user.email,
            paymentStatus: ticket.order.payment?.status ?? null,
            latestRefundStatus: latestRefund?.status ?? null,
            latestRefundAt: latestRefund?.createdAt.toISOString() ?? null,
            checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
            eventStartAt: ticket.order.reservation.event.startAt.toISOString(),
            providerRef: ticket.order.payment?.providerRef ?? null,
          },
        },
      },
    };
  }

  async getTicketDocument(ticketId: string) {
    const document = await this.ticketsService.resolveTicketDocument(ticketId);

    return {
      ticketId: document.ticketId,
      documentUrl: document.documentUrl,
      source: document.source,
      hasStoredDocument: document.hasStoredDocument,
      fileName: document.fileName,
    };
  }

  private async getOrderForMutation(
    client: Prisma.TransactionClient | PrismaService,
    orderId: string,
  ) {
    return client.order.findUnique({
      where: {
        id: orderId,
      },
      include: {
        user: true,
        reservation: {
          include: {
            event: true,
            reservationSeats: {
              include: {
                seat: true,
              },
            },
          },
        },
        payment: {
          include: {
            refunds: {
              orderBy: {
                createdAt: "desc",
              },
              take: 1,
            },
          },
        },
        tickets: true,
      },
    });
  }

  private buildOrderControls(order: OrderControlsSource) {
    const expiredByClock = order.reservation.expiresAt.getTime() <= Date.now();
    const latestRefundStatus = order.payment?.refunds[0]?.status ?? null;
    const isEditableManualPending =
      order.reservation.source === ReservationSource.ADMIN_MANUAL_ORDER &&
      order.status === OrderStatus.PENDING &&
      order.reservation.status === ReservationStatus.HELD &&
      !expiredByClock &&
      !order.payment &&
      order.tickets.length === 0;
    const canRequestRefund =
      order.payment?.status === PaymentStatus.PAID &&
      order.status === OrderStatus.PAID &&
      latestRefundStatus !== RefundStatus.PENDING;

    let guardMessage: string | null = null;

    if (order.reservation.source !== ReservationSource.ADMIN_MANUAL_ORDER) {
      guardMessage = "Only manual pending orders can update seats or be deleted.";
    } else if (order.status !== OrderStatus.PENDING) {
      guardMessage = "Only pending manual orders remain editable.";
    } else if (order.reservation.status !== ReservationStatus.HELD) {
      guardMessage = "The linked reservation is no longer held.";
    } else if (expiredByClock) {
      guardMessage = "The linked hold has already expired.";
    } else if (order.payment) {
      guardMessage = "Paid orders cannot change seats or be deleted.";
    } else if (order.tickets.length > 0) {
      guardMessage = "Orders with issued tickets can no longer be edited.";
    }

    let cancelMode: "release_hold" | "refund_request_only" | null = null;
    let cancelMessage: string | null = null;
    let canCancel = false;

    if (isEditableManualPending) {
      canCancel = true;
      cancelMode = "release_hold";
      cancelMessage =
        "Cancelling will expire the hold and release seats immediately.";
    } else if (canRequestRefund) {
      canCancel = true;
      cancelMode = "refund_request_only";
      cancelMessage =
        "Cancelling this paid order creates a refund request only. Seats stay booked until refund approval.";
    } else if (latestRefundStatus === RefundStatus.PENDING) {
      cancelMessage = "A refund request is already pending review for this order.";
    } else {
      cancelMessage =
        guardMessage ?? "This order can no longer be cancelled from this view.";
    }

    return {
      canUpdateSeats: isEditableManualPending,
      canCancel,
      canDelete: isEditableManualPending,
      cancelMode,
      guardMessage,
      cancelMessage,
      expiredByClock,
    };
  }

  private assertUniqueSeatIds(seatIds: string[]) {
    const uniqueSeatIds = [...new Set(seatIds)];

    if (uniqueSeatIds.length !== seatIds.length) {
      throw new BadRequestException("seatIds must not contain duplicates.");
    }

    return uniqueSeatIds;
  }

  private isOrderStatus(status: string): status is OrderStatus {
    return Object.values(OrderStatus).includes(status as OrderStatus);
  }

  private isPaymentStatus(status: string): status is PaymentStatus {
    return Object.values(PaymentStatus).includes(status as PaymentStatus);
  }

  private isRefundStatus(status: string): status is RefundStatus {
    return Object.values(RefundStatus).includes(status as RefundStatus);
  }

  private isTicketStatus(status: string): status is TicketStatus {
    return Object.values(TicketStatus).includes(status as TicketStatus);
  }

  private buildOrdersOrderBy(
    query: NormalizedAdminListQuery<OrderSortField>,
  ): Prisma.OrderOrderByWithRelationInput[] {
    switch (query.sortBy) {
      case "amount":
        return [
          { amount: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      case "status":
        return [
          { status: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      default:
        return [{ createdAt: query.sortOrder }, { id: "desc" }];
    }
  }

  private buildPaymentsOrderBy(
    query: NormalizedAdminListQuery<PaymentSortField>,
  ): Prisma.PaymentOrderByWithRelationInput[] {
    switch (query.sortBy) {
      case "paidAt":
        return [
          { paidAt: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      case "status":
        return [
          { status: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      case "provider":
        return [
          { provider: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      default:
        return [{ createdAt: query.sortOrder }, { id: "desc" }];
    }
  }

  private buildRefundsOrderBy(
    query: NormalizedAdminListQuery<RefundSortField>,
  ): Prisma.RefundOrderByWithRelationInput[] {
    switch (query.sortBy) {
      case "amount":
        return [
          { amount: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      case "status":
        return [
          { status: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      default:
        return [{ createdAt: query.sortOrder }, { id: "desc" }];
    }
  }

  private buildTicketsOrderBy(
    query: NormalizedAdminListQuery<TicketSortField>,
  ): Prisma.TicketOrderByWithRelationInput[] {
    switch (query.sortBy) {
      case "checkedInAt":
        return [
          { checkedInAt: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      case "status":
        return [
          { status: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      default:
        return [{ createdAt: query.sortOrder }, { id: "desc" }];
    }
  }

  private resolveTicketAccessState(
    status: TicketStatus,
    checkedInAt: Date | null,
  ) {
    if (checkedInAt) {
      return "checked_in";
    }

    if (status === TicketStatus.REFUNDED) {
      return "refunded";
    }

    if (status === TicketStatus.EXPIRED) {
      return "expired";
    }

    return "ready_for_access";
  }

  private resolveTicketDeliveryState(
    documentSource: string,
    customerEmail: string | null,
    ticketStatus: TicketStatus,
    paymentStatus: PaymentStatus | null,
  ) {
    if (!customerEmail) {
      return "missing_customer_email";
    }

    if (
      ticketStatus === TicketStatus.REFUNDED ||
      paymentStatus === PaymentStatus.REFUNDED
    ) {
      return "refund_completed";
    }

    if (documentSource === "canonical_fallback") {
      return "using_canonical_fallback";
    }

    return "stored_document_available";
  }
}
