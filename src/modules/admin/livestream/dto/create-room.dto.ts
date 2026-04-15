import { IsOptional, IsString, IsUUID } from "class-validator";

export class CreateRoomDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsUUID()
  eventId?: string;
}
