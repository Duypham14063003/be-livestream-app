import { ArrayMinSize, IsArray, IsString } from "class-validator";

export class ReplaceManualOrderSeatsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  seatIds!: string[];
}

