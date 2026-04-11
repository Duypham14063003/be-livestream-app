import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateRefundDto {
  @IsString()
  paymentId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
