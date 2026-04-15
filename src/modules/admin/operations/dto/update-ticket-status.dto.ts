import { IsEnum } from "class-validator";
import { TicketStatus } from "@prisma/client";

export class UpdateTicketStatusDto {
  @IsEnum(TicketStatus, {
    message: "status must be one of: ACTIVE, USED, REFUNDED, EXPIRED",
  })
  status!: TicketStatus;
}