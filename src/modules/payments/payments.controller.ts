import { Body, Controller, Post } from '@nestjs/common';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { CreatePaymentIntentDto } from './dto/create-intent.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('intents')
  createIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentsService.createIntent(dto);
  }

  @Post('confirm')
  confirm(@Body() dto: ConfirmPaymentDto) {
    return this.paymentsService.confirmPayment(dto);
  }

  @Post('refunds')
  createRefund(@Body() dto: CreateRefundDto) {
    return this.paymentsService.createRefund(dto);
  }
}
