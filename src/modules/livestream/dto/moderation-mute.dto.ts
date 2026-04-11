import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ModerationMuteDto {
  @IsString()
  room_id!: string;

  @IsString()
  target_user_id!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  duration_seconds?: number;
}
