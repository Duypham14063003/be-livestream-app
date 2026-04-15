import { PaymentProvider } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class AdminConfirmReservationDto {
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @IsOptional()
  @IsString()
  providerRef?: string;
}
