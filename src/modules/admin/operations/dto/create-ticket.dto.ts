import { IsString, IsNotEmpty } from "class-validator";

export class CreateTicketDto {
  @IsString()
  @IsNotEmpty({ message: "orderId is required." })
  orderId!: string;

  @IsString()
  @IsNotEmpty({ message: "userId is required." })
  userId!: string;

  @IsString()
  @IsNotEmpty({ message: "eventId is required." })
  eventId!: string;

  @IsString()
  @IsNotEmpty({ message: "seatId is required." })
  seatId!: string;
}
