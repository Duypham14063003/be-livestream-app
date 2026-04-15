import { Prisma } from "@prisma/client";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export const ADMIN_LIST_DEFAULT_PAGE = 1;
export const ADMIN_LIST_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_LIST_MAX_PAGE_SIZE = 50;
export const ADMIN_LIST_SORT_ORDERS = ["asc", "desc"] as const;

export type AdminListSortOrder = (typeof ADMIN_LIST_SORT_ORDERS)[number];

export class AdminListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(ADMIN_LIST_SORT_ORDERS)
  sortOrder?: AdminListSortOrder;
}

export interface NormalizedAdminListQuery<SortBy extends string> {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  sortBy: SortBy;
  sortOrder: Prisma.SortOrder;
}

interface NormalizeAdminListQueryOptions<SortBy extends string> {
  allowedSortBy: readonly SortBy[];
  defaultSortBy: SortBy;
  defaultSortOrder?: Prisma.SortOrder;
  defaultPageSize?: number;
  maxPageSize?: number;
}

export function normalizeAdminListQuery<SortBy extends string>(
  query: AdminListQueryDto,
  options: NormalizeAdminListQueryOptions<SortBy>,
): NormalizedAdminListQuery<SortBy> {
  const page =
    query.page && query.page > 0 ? query.page : ADMIN_LIST_DEFAULT_PAGE;
  const maxPageSize = options.maxPageSize ?? ADMIN_LIST_MAX_PAGE_SIZE;
  const defaultPageSize =
    options.defaultPageSize ?? ADMIN_LIST_DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(
    query.pageSize && query.pageSize > 0 ? query.pageSize : defaultPageSize,
    maxPageSize,
  );
  const defaultSortOrder = options.defaultSortOrder ?? "desc";
  const sortBy = options.allowedSortBy.includes(query.sortBy as SortBy)
    ? (query.sortBy as SortBy)
    : options.defaultSortBy;
  const sortOrder = query.sortOrder === "asc" ? "asc" : defaultSortOrder;

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    sortBy,
    sortOrder,
  };
}

export function buildAdminListMeta<SortBy extends string>(
  total: number,
  query: NormalizedAdminListQuery<SortBy>,
) {
  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };
}
