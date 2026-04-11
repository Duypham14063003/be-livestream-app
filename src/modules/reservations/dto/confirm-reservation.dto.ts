import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class ConfirmReservationDto {
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  providerRef?: string;
}
