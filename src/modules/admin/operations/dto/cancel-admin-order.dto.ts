import { IsOptional, IsString } from "class-validator";

export class CancelAdminOrderDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

