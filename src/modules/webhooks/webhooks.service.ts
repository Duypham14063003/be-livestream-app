import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  async handleStripeWebhook(signature: string | undefined, payload: Record<string, unknown>) {
    if (!signature) {
      throw new UnauthorizedException('Thiếu stripe-signature');
    }

    const configuredSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (configuredSecret && configuredSecret.length > 0 && signature.length < 10) {
      throw new UnauthorizedException('stripe-signature không hợp lệ');
    }

    const eventType = typeof payload.type === 'string' ? payload.type : 'unknown';
    const object = this.extractObject(payload);

    if (eventType === 'payment_intent.succeeded' && typeof object.metadata?.paymentId === 'string') {
      await this.paymentsService.confirmPayment({
        paymentId: object.metadata.paymentId,
        paid: true,
        providerRef: typeof object.id === 'string' ? object.id : undefined,
      });
    }

    if (eventType === 'payment_intent.payment_failed' && typeof object.metadata?.paymentId === 'string') {
      await this.paymentsService.confirmPayment({
        paymentId: object.metadata.paymentId,
        paid: false,
        providerRef: typeof object.id === 'string' ? object.id : undefined,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        action: 'STRIPE_WEBHOOK_RECEIVED',
        entityType: 'webhook',
        entityId: typeof object.id === 'string' ? object.id : 'unknown',
        payload: payload as Prisma.InputJsonValue,
      },
    });

    return {
      received: true,
      provider: 'stripe',
      eventType,
    };
  }

  async handlePaypalWebhook(webhookId: string | undefined, payload: Record<string, unknown>) {
    if (!webhookId) {
      throw new UnauthorizedException('Thiếu paypal-transmission-id');
    }

    const configuredWebhookId = this.configService.get<string>('PAYPAL_WEBHOOK_ID');
    if (configuredWebhookId && configuredWebhookId.length > 0 && webhookId.length < 6) {
      throw new UnauthorizedException('paypal-transmission-id không hợp lệ');
    }

    const eventType = typeof payload.event_type === 'string' ? payload.event_type : 'unknown';
    const resource =
      payload.resource && typeof payload.resource === 'object'
        ? (payload.resource as Record<string, unknown>)
        : {};

    if (
      eventType === 'PAYMENT.CAPTURE.COMPLETED' &&
      resource.custom_id &&
      typeof resource.custom_id === 'string'
    ) {
      await this.paymentsService.confirmPayment({
        paymentId: resource.custom_id,
        paid: true,
        providerRef: typeof resource.id === 'string' ? resource.id : undefined,
      });
    }

    if (
      eventType === 'PAYMENT.CAPTURE.DENIED' &&
      resource.custom_id &&
      typeof resource.custom_id === 'string'
    ) {
      await this.paymentsService.confirmPayment({
        paymentId: resource.custom_id,
        paid: false,
        providerRef: typeof resource.id === 'string' ? resource.id : undefined,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        action: 'PAYPAL_WEBHOOK_RECEIVED',
        entityType: 'webhook',
        entityId: typeof resource.id === 'string' ? resource.id : 'unknown',
        payload: payload as Prisma.InputJsonValue,
      },
    });

    return {
      received: true,
      provider: 'paypal',
      eventType,
    };
  }

  private extractObject(payload: Record<string, unknown>) {
    const data =
      payload.data && typeof payload.data === 'object'
        ? (payload.data as Record<string, unknown>)
        : {};

    return data.object && typeof data.object === 'object'
      ? (data.object as Record<string, unknown> & {
          metadata?: Record<string, string>;
        })
      : {};
  }
}
