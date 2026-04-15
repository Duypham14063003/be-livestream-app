import { IsIn } from "class-validator";

export class AdminModerationPromoteDto {
  @IsIn(["host", "cohost"])
  role!: "host" | "cohost";
}
