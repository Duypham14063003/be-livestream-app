import { IsInt, Min } from "class-validator";

export class UpdateManualPendingSettingDto {
  @IsInt()
  @Min(1)
  ttlMinutes!: number;
}

