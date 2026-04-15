import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";

export enum FilterType {
  WORD = "word",
  PHRASE = "phrase",
  REGEX = "regex",
}

export enum FilterAction {
  DELETE = "delete",
  TIMEOUT = "timeout",
  BLOCK = "block",
}

export class CreateFilterDto {
  @IsNotEmpty() @IsString() roomId!: string;
  @IsNotEmpty() @IsString() pattern!: string;
  @IsEnum(FilterType) type!: FilterType;
  @IsEnum(FilterAction) action!: FilterAction;
  @IsOptional() @IsNumber() timeoutDurationSeconds?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateFilterDto {
  @IsOptional() @IsString() pattern?: string;
  @IsOptional() @IsEnum(FilterType) type?: FilterType;
  @IsOptional() @IsEnum(FilterAction) action?: FilterAction;
  @IsOptional() @IsNumber() timeoutDurationSeconds?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
