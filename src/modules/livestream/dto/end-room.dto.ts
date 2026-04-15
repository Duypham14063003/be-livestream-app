import { IsOptional, IsString } from 'class-validator';

export class EndRoomDto {
  @IsOptional()
  @IsString()
  reason?: string;
}