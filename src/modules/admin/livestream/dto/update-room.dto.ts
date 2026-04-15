import { IsOptional, IsString, IsUUID } from "class-validator";

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsUUID()
  eventId?: string | null;
}
