import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { VenueType } from "@prisma/client";

export class CreateEventDto {
  @IsNotEmpty()
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsEnum(VenueType)
  venueType!: VenueType;

  @IsNotEmpty()
  startAt!: string; // ISO8601

  @IsNotEmpty()
  endAt!: string; // ISO8601
}
