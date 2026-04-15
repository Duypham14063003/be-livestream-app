import { IsOptional, IsString } from "class-validator";

export class AdminExpireReservationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
