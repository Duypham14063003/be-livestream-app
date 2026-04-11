import { Body, Controller, Headers, Post } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('stripe')
  stripe(
    @Headers('stripe-signature') signature: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.webhooksService.handleStripeWebhook(signature, payload);
  }

  @Post('paypal')
  paypal(
    @Headers('paypal-transmission-id') webhookId: string | undefined,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.webhooksService.handlePaypalWebhook(webhookId, payload);
  }
}
