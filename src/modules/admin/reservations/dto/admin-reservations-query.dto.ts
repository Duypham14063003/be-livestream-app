import { IsOptional, IsString } from "class-validator";
import { AdminListQueryDto } from "../../common/admin-listing";

export class AdminReservationsQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
