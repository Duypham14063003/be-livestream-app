import { IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";
import { AdminListQueryDto } from "../../common/admin-listing";

export class AdminEventsQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  venueType?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  })
  excludeCancelled?: boolean;
}
