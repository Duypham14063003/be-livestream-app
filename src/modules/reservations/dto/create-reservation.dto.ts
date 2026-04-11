import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class CreateReservationDto {
  @IsString()
  userId!: string;

  @IsString()
  eventId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  seatIds!: string[];
}
