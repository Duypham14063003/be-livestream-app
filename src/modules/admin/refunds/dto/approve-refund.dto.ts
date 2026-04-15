import { IsOptional, IsString } from "class-validator";

export class ApproveRefundDto {
  @IsOptional()
  @IsString()
  decisionNote?: string;
}
