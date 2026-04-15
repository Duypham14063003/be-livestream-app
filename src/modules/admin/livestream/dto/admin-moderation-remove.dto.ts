import { IsOptional, IsString } from "class-validator";

export class AdminModerationRemoveDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
