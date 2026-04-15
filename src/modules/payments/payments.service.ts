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
  TicketStatus,
  UserRole,
} from "@prisma/client";
import { REALTIME_TOPICS } from "../../common/constants/realtime-topics";
import { PrismaService } from "../../prisma/prisma.service";
import { ConfirmPaymentDto } from "./dto/confirm-payment.dto";
import { CreatePaymentIntentDto } from "./dto/create-intent.dto";
import { CreateRefundDto } from "./dto/create-refund.dto";

type RefundReviewContext = Prisma.RefundGetPayload<{
  include: {
    payment: {
      include: {
        order: {
          include: {
            tickets: true;
            reservation: true;
          };
        };
        refunds: true;
      };
    };
    reviewedBy: true;
  };
}>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createIntent(dto: CreatePaymentIntentDto) {
    const reservation = await this.prisma.reservation.findUnique({
      where: {
        id: dto.reservationId,
      },
      include: {
        reservationSeats: true,
      },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation không tồn tại");
    }

    if (reservation.reservationSeats.length === 0) {
      throw new BadRequestException("Reservation không có ghế để thanh toán");
    }

    const duplicatedByIdempotency = await this.prisma.payment.findUnique({
      where: {
        idempotencyKey: dto.idempotencyKey,
      },
      include: {
        order: true,
      },
    });

    if (duplicatedByIdempotency) {
      return {
        paymentId: duplicatedByIdempotency.id,
        orderId: duplicatedByIdempotency.orderId,
        status: duplicatedByIdempotency.status,
        clientSecret: `pi_${duplicatedByIdempotency.id}_secret_demo`,
      };
    }

    const amount = reservation.reservationSeats.reduce(
      (sum, item) => sum + item.price,
      0,
    );
    const currency =
      this.configService.get<string>("DEFAULT_CURRENCY") ?? "USD";

    const payment = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.upsert({
        where: {
          reservationId: reservation.id,
        },
        update: {
          amount,
          currency,
          status: OrderStatus.PENDING,
        },
        create: {
          reservationId: reservation.id,
          userId: reservation.userId,
          amount,
          currency,
          status: OrderStatus.PENDING,
        },
      });

      const existingPayment = await tx.payment.findUnique({
        where: {
          orderId: order.id,
        },
      });

      const createdPayment = existingPayment
        ? await tx.payment.update({
            where: { id: existingPayment.id },
            data: {
              provider: dto.provider,
              status: PaymentStatus.PENDING,
              idempotencyKey: dto.idempotencyKey,
            },
          })
        : await tx.payment.create({
            data: {
              orderId: order.id,
              provider: dto.provider,
              status: PaymentStatus.PENDING,
              idempotencyKey: dto.idempotencyKey,
            },
          });

      await tx.auditLog.create({
        data: {
          action: "PAYMENT_INTENT_CREATED",
          entityType: "payment",
          entityId: createdPayment.id,
          payload: {
            reservationId: reservation.id,
            orderId: order.id,
            amount,
            currency,
            provider: dto.provider,
          },
        },
      });

      return createdPayment;
    });

    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      status: payment.status,
      clientSecret: `pi_${payment.id}_secret_demo`,
    };
  }

  async confirmPayment(dto: ConfirmPaymentDto) {
    const payment = await this.prisma.payment.findUnique({
      where: {
        id: dto.paymentId,
      },
      include: {
        order: {
          include: {
            reservation: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException("Payment không tồn tại");
    }

    if (dto.paid && payment.status === PaymentStatus.PAID) {
      return {
        payment,
        idempotent: true,
      };
    }

    const updatedPayment = await this.prisma.$transaction(async (tx) => {
      const finalPaymentStatus = dto.paid
        ? PaymentStatus.PAID
        : PaymentStatus.FAILED;
      const finalOrderStatus = dto.paid
        ? OrderStatus.PAID
        : OrderStatus.CANCELLED;

      const nextPayment = await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status: finalPaymentStatus,
          providerRef: dto.providerRef,
          paidAt: dto.paid ? new Date() : null,
        },
      });

      await tx.order.update({
        where: {
          id: payment.orderId,
        },
        data: {
          status: finalOrderStatus,
        },
      });

      await tx.auditLog.create({
        data: {
          action: dto.paid ? "PAYMENT_CONFIRMED" : "PAYMENT_FAILED",
          entityType: "payment",
          entityId: payment.id,
          payload: {
            providerRef: dto.providerRef,
            orderId: payment.orderId,
          },
        },
      });

      return nextPayment;
    });

    if (dto.paid) {
      this.eventEmitter.emit(REALTIME_TOPICS.ORDER_PAID, {
        orderId: payment.orderId,
        reservationId: payment.order.reservationId,
      });
    }

    return {
      payment: updatedPayment,
      idempotent: false,
    };
  }

  async createRefund(dto: CreateRefundDto) {
    const payment = await this.prisma.payment.findUnique({
      where: {
        id: dto.paymentId,
      },
      include: {
        order: {
          include: {
            tickets: true,
            reservation: true,
          },
        },
        refunds: true,
      },
    });

    if (!payment) {
      throw new NotFoundException("Payment không tồn tại");
    }

    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.REFUNDED
    ) {
      throw new BadRequestException("Payment chưa ở trạng thái có thể refund");
    }

    const duplicatedRefund = await this.prisma.refund.findUnique({
      where: {
        idempotencyKey: dto.idempotencyKey,
      },
    });

    if (duplicatedRefund) {
      return duplicatedRefund;
    }

    const totalRefunded = this.getSettledRefundTotal(payment.refunds);
    const remainingAmount = payment.order.amount - totalRefunded;
    const amount = dto.amount ?? remainingAmount;

    if (amount <= 0 || amount > remainingAmount) {
      throw new ConflictException("Số tiền refund không hợp lệ");
    }

    return this.prisma.$transaction(async (tx) => {
      const createdRefund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amount,
          reason: dto.reason,
          status: RefundStatus.PENDING,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "REFUND_REQUESTED",
          entityType: "refund",
          entityId: createdRefund.id,
          payload: {
            paymentId: payment.id,
            orderId: payment.orderId,
            amount,
            reason: dto.reason ?? null,
          },
        },
      });

      return createdRefund;
    });
  }

  async approveRefund(
    refundId: string,
    adminUserId: string,
    decisionNote?: string,
  ) {
    const reviewer = await this.ensureReviewer(adminUserId);

    return this.prisma.$transaction(async (tx) => {
      const refund = await this.getRefundReviewContext(tx, refundId);

      if (!refund) {
        throw new NotFoundException("Refund request was not found.");
      }

      if (refund.status !== RefundStatus.PENDING) {
        throw new ConflictException(
          "Refund request is no longer pending review.",
        );
      }

      const settledRefundTotal = this.getSettledRefundTotal(
        refund.payment.refunds,
        refund.id,
      );
      const remainingAmount = refund.payment.order.amount - settledRefundTotal;

      if (refund.amount <= 0 || refund.amount > remainingAmount) {
        const failedRefund = await this.markRefundFailed(
          tx,
          refund,
          reviewer.id,
          decisionNote,
          remainingAmount,
        );

        return {
          outcome: failedRefund?.status ?? RefundStatus.FAILED,
          refund: failedRefund,
        };
      }

      const reviewedAt = new Date();
      const updated = await tx.refund.updateMany({
        where: {
          id: refund.id,
          status: RefundStatus.PENDING,
        },
        data: {
          status: RefundStatus.SUCCEEDED,
          reviewedById: reviewer.id,
          reviewedAt,
          decisionNote: decisionNote || null,
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException(
          "Refund request is no longer pending review.",
        );
      }

      const afterTotalRefunded = settledRefundTotal + refund.amount;
      const fullRefund = afterTotalRefunded >= refund.payment.order.amount;

      await tx.payment.update({
        where: {
          id: refund.paymentId,
        },
        data: {
          status: fullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PAID,
        },
      });

      await tx.order.update({
        where: {
          id: refund.payment.orderId,
        },
        data: {
          status: fullRefund
            ? OrderStatus.REFUNDED
            : OrderStatus.REFUND_PENDING,
        },
      });

      if (fullRefund) {
        await tx.ticket.updateMany({
          where: {
            orderId: refund.payment.orderId,
          },
          data: {
            status: TicketStatus.REFUNDED,
          },
        });
      }

      await tx.auditLog.createMany({
        data: [
          {
            action: "REFUND_APPROVED",
            entityType: "refund",
            entityId: refund.id,
            payload: {
              paymentId: refund.paymentId,
              orderId: refund.payment.orderId,
              amount: refund.amount,
              fullRefund,
              reviewedById: reviewer.id,
              decisionNote: decisionNote ?? null,
            },
          },
          {
            action: "PAYMENT_REFUND_SETTLED",
            entityType: "payment",
            entityId: refund.paymentId,
            payload: {
              refundId: refund.id,
              orderId: refund.payment.orderId,
              amount: refund.amount,
              fullRefund,
            },
          },
        ],
      });

      const approvedRefund = await tx.refund.findUnique({
        where: {
          id: refund.id,
        },
      });

      return {
        outcome: approvedRefund?.status ?? RefundStatus.SUCCEEDED,
        refund: approvedRefund,
      };
    });
  }

  async rejectRefund(
    refundId: string,
    adminUserId: string,
    decisionNote: string,
  ) {
    const reviewer = await this.ensureReviewer(adminUserId);

    return this.prisma.$transaction(async (tx) => {
      const refund = await this.getRefundReviewContext(tx, refundId);

      if (!refund) {
        throw new NotFoundException("Refund request was not found.");
      }

      if (refund.status !== RefundStatus.PENDING) {
        throw new ConflictException(
          "Refund request is no longer pending review.",
        );
      }

      const reviewedAt = new Date();
      const updated = await tx.refund.updateMany({
        where: {
          id: refund.id,
          status: RefundStatus.PENDING,
        },
        data: {
          status: RefundStatus.REJECTED,
          reviewedById: reviewer.id,
          reviewedAt,
          decisionNote,
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException(
          "Refund request is no longer pending review.",
        );
      }

      await tx.auditLog.create({
        data: {
          action: "REFUND_REJECTED",
          entityType: "refund",
          entityId: refund.id,
          payload: {
            paymentId: refund.paymentId,
            orderId: refund.payment.orderId,
            amount: refund.amount,
            reviewedById: reviewer.id,
            decisionNote,
          },
        },
      });

      const rejectedRefund = await tx.refund.findUnique({
        where: {
          id: refund.id,
        },
      });

      return {
        outcome: rejectedRefund?.status ?? RefundStatus.REJECTED,
        refund: rejectedRefund,
      };
    });
  }

  private async markRefundFailed(
    tx: Prisma.TransactionClient,
    refund: RefundReviewContext,
    reviewerId: string,
    decisionNote: string | undefined,
    remainingAmount: number,
  ) {
    const reviewedAt = new Date();
    const failureReason =
      "requested_amount_exceeds_remaining_refundable_amount";
    const failureNote =
      decisionNote?.trim() ||
      `Approval failed because only ${remainingAmount} remains refundable at decision time.`;

    const updated = await tx.refund.updateMany({
      where: {
        id: refund.id,
        status: RefundStatus.PENDING,
      },
      data: {
        status: RefundStatus.FAILED,
        reviewedById: reviewerId,
        reviewedAt,
        decisionNote: failureNote,
      },
    });

    if (updated.count !== 1) {
      throw new ConflictException(
        "Refund request is no longer pending review.",
      );
    }

    await tx.auditLog.create({
      data: {
        action: "REFUND_FAILED",
        entityType: "refund",
        entityId: refund.id,
        payload: {
          paymentId: refund.paymentId,
          orderId: refund.payment.orderId,
          amount: refund.amount,
          remainingAmount,
          reviewedById: reviewerId,
          decisionNote: decisionNote ?? null,
          failureReason,
        },
      },
    });

    const failedRefund = await tx.refund.findUnique({
      where: {
        id: refund.id,
      },
    });

    return failedRefund;
  }

  private getSettledRefundTotal(
    refunds: Array<{ id: string; amount: number; status: RefundStatus }>,
    excludeRefundId?: string,
  ) {
    return refunds.reduce((sum, refund) => {
      if (
        refund.id === excludeRefundId ||
        refund.status !== RefundStatus.SUCCEEDED
      ) {
        return sum;
      }

      return sum + refund.amount;
    }, 0);
  }

  private async getRefundReviewContext(
    client: Prisma.TransactionClient | PrismaService,
    refundId: string,
  ) {
    return client.refund.findUnique({
      where: {
        id: refundId,
      },
      include: {
        payment: {
          include: {
            order: {
              include: {
                tickets: true,
                reservation: true,
              },
            },
            refunds: true,
          },
        },
        reviewedBy: true,
      },
    });
  }

  private async ensureReviewer(adminUserId: string) {
    const reviewer = await this.prisma.user.findUnique({
      where: {
        id: adminUserId,
      },
    });

    if (!reviewer || reviewer.role !== UserRole.ADMIN) {
      throw new NotFoundException("Admin reviewer was not found.");
    }

    return reviewer;
  }
}
