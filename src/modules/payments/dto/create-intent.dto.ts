import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsString, MinLength } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsString()
  reservationId!: string;

  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
