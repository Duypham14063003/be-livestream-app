import { IsEnum, IsOptional, IsString } from "class-validator";
import { VenueType } from "@prisma/client";

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(VenueType)
  venueType?: VenueType;

  @IsOptional()
  @IsString()
  startAt?: string; // ISO8601

  @IsOptional()
  @IsString()
  endAt?: string; // ISO8601
}
