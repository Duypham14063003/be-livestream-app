import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  buildAdminListMeta,
  normalizeAdminListQuery,
  type NormalizedAdminListQuery,
} from "../common/admin-listing";
import { AdminAuditLogsQueryDto } from "./dto/admin-audit-logs-query.dto";

const AUDIT_LOG_SORT_FIELDS = ["createdAt", "action", "entityType"] as const;
type AuditLogSortField = (typeof AUDIT_LOG_SORT_FIELDS)[number];

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async getAuditLogs(query: AdminAuditLogsQueryDto) {
    const listing = normalizeAdminListQuery(query, {
      allowedSortBy: AUDIT_LOG_SORT_FIELDS,
      defaultSortBy: "createdAt",
      defaultSortOrder: "desc",
    });
    const where: Prisma.AuditLogWhereInput = {
      action: query.action
        ? {
            contains: query.action,
            mode: "insensitive",
          }
        : undefined,
      entityType: query.entityType
        ? {
            equals: query.entityType,
            mode: "insensitive",
          }
        : undefined,
      entityId: query.entityId
        ? {
            contains: query.entityId,
          }
        : undefined,
      createdAt: this.buildDateFilter(query.from, query.to),
    };

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: this.buildAuditLogOrderBy(listing),
        skip: listing.skip,
        take: listing.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs.map((log) => {
        const payload = this.normalizePayload(log.payload);
        const link = this.resolveLink(log.entityType, log.entityId, payload);

        return {
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          createdAt: log.createdAt.toISOString(),
          payloadPreview: this.createPayloadPreview(payload),
          payload,
          linkPath: link?.path ?? null,
          linkLabel: link?.label ?? null,
        };
      }),
      meta: buildAdminListMeta(total, listing),
    };
  }

  private buildDateFilter(
    from?: string,
    to?: string,
  ): Prisma.DateTimeFilter | undefined {
    const fromDate = this.parseDate(from);
    const toDate = this.parseDate(to);

    if (!fromDate && !toDate) {
      return undefined;
    }

    return {
      gte: fromDate,
      lte: toDate,
    };
  }

  private parseDate(value?: string) {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return date;
  }

  private normalizePayload(
    payload: Prisma.JsonValue | null,
  ): Prisma.JsonValue | null {
    return payload ?? null;
  }

  private createPayloadPreview(payload: Prisma.JsonValue | null) {
    if (payload === null) {
      return "No payload recorded.";
    }

    const serialized = JSON.stringify(payload);
    if (!serialized) {
      return "No payload recorded.";
    }

    return serialized.length > 180
      ? `${serialized.slice(0, 177)}...`
      : serialized;
  }

  private resolveLink(
    entityType: string,
    entityId: string,
    payload: Prisma.JsonValue | null,
  ) {
    const payloadRecord =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;

    if (entityType === "livestream_room") {
      return {
        path: `/livestream/${entityId}`,
        label: "Open live room",
      };
    }

    if (entityType === "payment") {
      return {
        path: `/payments?${new URLSearchParams({ search: entityId }).toString()}`,
        label: "Open payment",
      };
    }

    if (entityType === "refund") {
      const orderId = this.readString(payloadRecord, "orderId");
      if (orderId) {
        return {
          path: `/orders/${orderId}`,
          label: "Open order",
        };
      }

      return {
        path: `/refunds?${new URLSearchParams({ search: entityId }).toString()}`,
        label: "Open refund",
      };
    }

    if (entityType === "reservation") {
      const orderId = this.readString(payloadRecord, "orderId");
      if (orderId) {
        return {
          path: `/orders/${orderId}`,
          label: "Open order",
        };
      }

      const eventId = this.readString(payloadRecord, "eventId");
      if (eventId) {
        return {
          path: `/events/${eventId}`,
          label: "Open event",
        };
      }
    }

    return null;
  }

  private readString(
    payloadRecord: Record<string, unknown> | null,
    key: string,
  ) {
    const value = payloadRecord?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private buildAuditLogOrderBy(
    query: NormalizedAdminListQuery<AuditLogSortField>,
  ): Prisma.AuditLogOrderByWithRelationInput[] {
    switch (query.sortBy) {
      case "action":
        return [
          { action: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      case "entityType":
        return [
          { entityType: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      default:
        return [{ createdAt: query.sortOrder }, { id: "desc" }];
    }
  }
}
