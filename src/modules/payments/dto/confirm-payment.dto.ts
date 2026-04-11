import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ConfirmPaymentDto {
  @IsString()
  paymentId!: string;

  @IsBoolean()
  paid!: boolean;

  @IsOptional()
  @IsString()
  providerRef?: string;
}
