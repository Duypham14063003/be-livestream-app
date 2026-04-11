import { IsOptional, IsString } from 'class-validator';

export class ExpireReservationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
