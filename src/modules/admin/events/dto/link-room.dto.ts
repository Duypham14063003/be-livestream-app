import { IsOptional, IsUUID } from "class-validator";
import { Transform } from "class-transformer";

export class LinkRoomDto {
  @IsOptional()
  @IsUUID()
  @Transform(({ value }) => (value === "" ? null : value))
  roomId?: string | null;
}
