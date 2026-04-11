import { IsString } from 'class-validator';

export class IssueLivestreamTokenDto {
  @IsString()
  room_id!: string;

  @IsString()
  user_id!: string;

  @IsString()
  role!: string;
}
