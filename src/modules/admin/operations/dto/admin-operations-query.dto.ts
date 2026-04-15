import { IsOptional, IsString } from "class-validator";
import { AdminListQueryDto } from "../../common/admin-listing";

export class AdminOrdersQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class AdminPaymentsQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class AdminRefundsQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class AdminTicketsQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
