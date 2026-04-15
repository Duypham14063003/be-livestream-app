import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class TimeoutUserDto {
  @IsNotEmpty() @IsString() userId!: string;
  @IsNumber() @Min(0) durationSeconds!: number;
  @IsOptional() @IsBoolean() permanent?: boolean;
  @IsOptional() @IsString() reason?: string;
}