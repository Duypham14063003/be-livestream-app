import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class IssueLivestreamTokenDto {
  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  channelName?: string;

  @IsOptional()
  @IsString()
  channel_name?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      return Number(value);
    }

    return value;
  })
  @IsInt()
  @IsPositive()
  uid?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  role!: string;
}
