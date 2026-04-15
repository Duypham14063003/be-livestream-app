import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class AdminModerationMuteDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationSeconds?: number;
}
