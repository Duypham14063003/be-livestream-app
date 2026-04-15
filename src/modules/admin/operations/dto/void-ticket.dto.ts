import { IsOptional, IsString, IsBoolean } from "class-validator";

export class VoidTicketDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  releaseSeat?: boolean = true;
}