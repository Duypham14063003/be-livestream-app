import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, PaymentStatus, RefundStatus, TicketStatus } from '@prisma/client';
import { REALTIME_TOPICS } from '../../common/constants/realtime-topics';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { CreatePaymentIntentDto } from './dto/create-intent.dto';
import { CreateRefundDto } from './dto/create-refund.dto';

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
      throw new NotFoundException('Reservation không tồn tại');
    }

    if (reservation.reservationSeats.length === 0) {
      throw new BadRequestException('Reservation không có ghế để thanh toán');
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

    const amount = reservation.reservationSeats.reduce((sum, item) => sum + item.price, 0);
    const currency = this.configService.get<string>('DEFAULT_CURRENCY') ?? 'USD';

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
          action: 'PAYMENT_INTENT_CREATED',
          entityType: 'payment',
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
      throw new NotFoundException('Payment không tồn tại');
    }

    if (dto.paid && payment.status === PaymentStatus.PAID) {
      return {
        payment,
        idempotent: true,
      };
    }

    const updatedPayment = await this.prisma.$transaction(async (tx) => {
      const finalPaymentStatus = dto.paid ? PaymentStatus.PAID : PaymentStatus.FAILED;
      const finalOrderStatus = dto.paid ? OrderStatus.PAID : OrderStatus.CANCELLED;

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
          action: dto.paid ? 'PAYMENT_CONFIRMED' : 'PAYMENT_FAILED',
          entityType: 'payment',
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
      throw new NotFoundException('Payment không tồn tại');
    }

    if (payment.status !== PaymentStatus.PAID && payment.status !== PaymentStatus.REFUNDED) {
      throw new BadRequestException('Payment chưa ở trạng thái có thể refund');
    }

    const duplicatedRefund = await this.prisma.refund.findUnique({
      where: {
        idempotencyKey: dto.idempotencyKey,
      },
    });

    if (duplicatedRefund) {
      return duplicatedRefund;
    }

    const totalRefunded = payment.refunds.reduce((sum, item) => sum + item.amount, 0);
    const remainingAmount = payment.order.amount - totalRefunded;
    const amount = dto.amount ?? remainingAmount;

    if (amount <= 0 || amount > remainingAmount) {
      throw new ConflictException('Số tiền refund không hợp lệ');
    }

    const refund = await this.prisma.$transaction(async (tx) => {
      const createdRefund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amount,
          reason: dto.reason,
          status: RefundStatus.SUCCEEDED,
          idempotencyKey: dto.idempotencyKey,
        },
      });

      const afterTotalRefunded = totalRefunded + amount;
      const fullRefund = afterTotalRefunded >= payment.order.amount;

      await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status: fullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PAID,
        },
      });

      await tx.order.update({
        where: {
          id: payment.orderId,
        },
        data: {
          status: fullRefund ? OrderStatus.REFUNDED : OrderStatus.REFUND_PENDING,
        },
      });

      if (fullRefund) {
        await tx.ticket.updateMany({
          where: {
            orderId: payment.orderId,
          },
          data: {
            status: TicketStatus.REFUNDED,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'PAYMENT_REFUNDED',
          entityType: 'payment',
          entityId: payment.id,
          payload: {
            refundId: createdRefund.id,
            amount,
            fullRefund,
          },
        },
      });

      return createdRefund;
    });

    return refund;
  }
}
