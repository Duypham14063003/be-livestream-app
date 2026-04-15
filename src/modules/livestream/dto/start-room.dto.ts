import { IsOptional, IsString } from 'class-validator';

export class StartRoomDto {
  @IsOptional()
  @IsString()
  title?: string;
}