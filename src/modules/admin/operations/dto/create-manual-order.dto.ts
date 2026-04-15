import { ArrayMinSize, IsArray, IsOptional, IsString } from "class-validator";

export class CreateManualOrderDto {
  @IsString()
  userId!: string;

  @IsString()
  eventId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  seatIds!: string[];

  @IsOptional()
  @IsString()
  adminNote?: string;
}

