import { IsEnum, IsNumber, IsOptional } from "class-validator";

export enum ChatMode {
  ALL = "all",
  FOLLOWERS = "followers",
  SUBSCRIBERS = "subscribers",
}

export class UpdateChatConfigDto {
  @IsOptional() @IsEnum(ChatMode) mode?: ChatMode;
  @IsOptional() @IsNumber() slowModeSeconds?: number;
  @IsOptional() @IsNumber() raidDefenseThreshold?: number;
}
