import { IsEnum, IsOptional, IsString, IsDateString, IsBoolean } from 'class-validator';
import { PaymentProvider } from '@prisma/client';

export class CreatePaymentDto {
  @IsString()
  orderId!: string;

  @IsEnum(PaymentProvider, {
    message: 'provider must be one of: STRIPE, PAYPAL, APPLE_PAY, GOOGLE_PAY, CASH, BANK_TRANSFER, QR_CODE',
  })
  provider!: PaymentProvider;

  @IsOptional()
  @IsString()
  providerRef?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsBoolean()
  paid?: boolean = true;
}
