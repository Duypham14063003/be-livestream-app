import { IsOptional, IsString } from "class-validator";
import { AdminListQueryDto } from "../../common/admin-listing";

export class AdminAuditLogsQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
