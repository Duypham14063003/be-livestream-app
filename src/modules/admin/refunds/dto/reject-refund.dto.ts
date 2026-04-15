import { IsString, MinLength } from "class-validator";

export class RejectRefundDto {
  @IsString()
  @MinLength(3)
  decisionNote!: string;
}
