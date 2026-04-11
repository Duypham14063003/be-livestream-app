import { IsOptional, IsString } from 'class-validator';

export class ModerationRemoveDto {
  @IsString()
  room_id!: string;

  @IsString()
  target_user_id!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
