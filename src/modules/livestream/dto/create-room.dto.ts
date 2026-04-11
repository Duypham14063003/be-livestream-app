import { IsOptional, IsString } from 'class-validator';

export class CreateRoomDto {
  /** Tiêu đề phòng livestream (optional). Mặc định: "Live của {userName}" */
  @IsOptional()
  @IsString()
  title?: string;
}
