import { IsEnum } from 'class-validator';
import { PaymentStatus } from '@prisma/client';

export class UpdatePaymentStatusDto {
  @IsEnum(PaymentStatus, {
    message: 'status must be one of: PENDING, PAID, FAILED, REFUNDED',
  })
  status!: PaymentStatus;
}
