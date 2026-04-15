import { IsOptional, IsString } from "class-validator";
import { AdminListQueryDto } from "../../common/admin-listing";

export class AdminUsersQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
