import { IsString } from 'class-validator';

export class ModerationPromoteDto {
  @IsString()
  room_id!: string;

  @IsString()
  target_user_id!: string;

  @IsString()
  role!: string;
}
