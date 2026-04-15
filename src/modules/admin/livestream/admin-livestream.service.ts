import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { LiveParticipantRole, LiveRoomStatus, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { AuthUser } from "../../auth/interfaces/auth-user.interface";
import { LivestreamService } from "../../livestream/livestream.service";
import {
  buildAdminListMeta,
  normalizeAdminListQuery,
  type NormalizedAdminListQuery,
} from "../common/admin-listing";
import { AdminRoomListQueryDto } from "./dto/admin-room-list-query.dto";
import { AdminModerationMuteDto } from "./dto/admin-moderation-mute.dto";
import { AdminModerationPromoteDto } from "./dto/admin-moderation-promote.dto";
import { AdminModerationRemoveDto } from "./dto/admin-moderation-remove.dto";
import {
  ChatMode,
  UpdateChatConfigDto,
} from "./dto/chat-config.dto";
import {
  CreateFilterDto,
  FilterAction,
  FilterType,
  UpdateFilterDto,
} from "./dto/moderation-filter.dto";
import { ModerationFilter, ChatConfig } from "./dto/moderation.types";
import { TimeoutUserDto } from "./dto/chat-timeout.dto";

const ROOM_SORT_FIELDS = ["createdAt", "title", "status"] as const;
type RoomSortField = (typeof ROOM_SORT_FIELDS)[number];

@Injectable()
export class AdminLivestreamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livestreamService: LivestreamService,
  ) {}

  // ─── In-Memory Stores (Phase 1 — no Prisma persistence) ───────
  private readonly filterStore = new Map<string, ModerationFilter[]>();
  private readonly chatConfigStore = new Map<string, ChatConfig>();

  async getRooms(query: AdminRoomListQueryDto) {
    const listing = normalizeAdminListQuery(query, {
      allowedSortBy: ROOM_SORT_FIELDS,
      defaultSortBy: "createdAt",
      defaultSortOrder: "desc",
    });
    const where: Prisma.LiveRoomWhereInput = {
      status:
        query.status && this.isLiveRoomStatus(query.status)
          ? query.status
          : undefined,
      ...(query.search
        ? {
            OR: [
              {
                title: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                event: {
                  title: {
                    contains: query.search,
                    mode: "insensitive",
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [rooms, total] = await Promise.all([
      this.prisma.liveRoom.findMany({
        where,
        orderBy: this.buildRoomsOrderBy(listing),
        skip: listing.skip,
        take: listing.take,
        include: {
          event: true,
          _count: {
            select: {
              overlays: true,
              participants: true,
            },
          },
          participants: {
            where: {
              role: LiveParticipantRole.HOST,
            },
            take: 1,
            include: {
              user: true,
            },
          },
        },
      }),
      this.prisma.liveRoom.count({ where }),
    ]);

    const viewerGroups =
      rooms.length === 0
        ? []
        : await this.prisma.liveParticipant.groupBy({
            by: ["roomId"],
            where: {
              roomId: {
                in: rooms.map((room) => room.id),
              },
              leftAt: null,
              role: {
                in: [
                  LiveParticipantRole.HOST,
                  LiveParticipantRole.CO_HOST,
                  LiveParticipantRole.AUDIENCE,
                ],
              },
            },
            _count: {
              _all: true,
            },
          });

    const viewerMap = new Map(
      viewerGroups.map((item) => [item.roomId, item._count._all]),
    );

    return {
      data: rooms.map((room) => ({
        id: room.id,
        title: room.title ?? room.event?.title ?? room.id,
        eventTitle: room.event?.title ?? null,
        status: room.status,
        viewerCount: viewerMap.get(room.id) ?? 0,
        participantCount: room._count.participants,
        overlayCount: room._count.overlays,
        hostName:
          room.participants[0]?.user.displayName ??
          room.participants[0]?.user.email ??
          room.participants[0]?.user.id ??
          null,
        startedAt: room.startedAt?.toISOString() ?? null,
        endedAt: room.endedAt?.toISOString() ?? null,
      })),
      meta: buildAdminListMeta(total, listing),
    };
  }

  async getRoomDetail(roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
      include: {
        event: true,
        overlays: true,
      },
    });

    if (!room) {
      throw new NotFoundException("Livestream room was not found.");
    }

    const [activeParticipants, totalParticipants, timelineEvents] =
      await Promise.all([
        this.prisma.liveParticipant.count({
          where: {
            roomId,
            leftAt: null,
          },
        }),
        this.prisma.liveParticipant.count({
          where: {
            roomId,
          },
        }),
        this.prisma.liveTimelineEvent.count({
          where: {
            roomId,
          },
        }),
      ]);

    return {
      room: {
        id: room.id,
        title: room.title,
        agoraChannel: room.agoraChannel,
        status: room.status,
        startedAt: room.startedAt?.toISOString() ?? null,
        endedAt: room.endedAt?.toISOString() ?? null,
        createdAt: room.createdAt.toISOString(),
        event: room.event
          ? {
              id: room.event.id,
              title: room.event.title,
            }
          : null,
      },
      stats: {
        activeParticipants,
        totalParticipants,
        timelineEvents,
        overlays: room.overlays.length,
      },
      overlays: room.overlays.map((overlay) => ({
        id: overlay.id,
        type: overlay.type,
        isActive: overlay.isActive,
        updatedAt: overlay.updatedAt.toISOString(),
      })),
    };
  }

  async getRoomParticipants(roomId: string) {
    const room = await this.ensureRoom(roomId);

    const participants = await this.prisma.liveParticipant.findMany({
      where: {
        roomId,
      },
      orderBy: {
        joinedAt: "desc",
      },
      include: {
        user: true,
      },
    });

    return {
      room: {
        id: roomId,
        title: room.title,
      },
      data: participants.map((participant) => ({
        id: participant.id,
        userId: participant.userId,
        displayName: participant.user.displayName,
        email: participant.user.email,
        role: participant.role,
        joinedAt: participant.joinedAt.toISOString(),
        leftAt: participant.leftAt?.toISOString() ?? null,
        isActive: participant.leftAt === null,
      })),
      meta: {
        total: participants.length,
      },
    };
  }

  async getRoomTimeline(roomId: string) {
    const room = await this.ensureRoom(roomId);
    const timeline = await this.prisma.liveTimelineEvent.findMany({
      where: {
        roomId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        actor: true,
      },
    });

    return {
      room: {
        id: room.id,
        title: room.title,
      },
      data: timeline.map((event) => ({
        id: event.id,
        action: event.action,
        createdAt: event.createdAt.toISOString(),
        actorName:
          event.actor?.displayName ??
          event.actor?.email ??
          event.actor?.id ??
          null,
        metadata: event.metadata,
      })),
      meta: {
        total: timeline.length,
      },
    };
  }

  // ─── Room Lifecycle CRUD ────────────────────────────────────────────────────────

  async createRoom(dto: { title?: string; eventId?: string; description?: string; tags?: string }, authUser: AuthUser) {
    const agoraChannel = `live_${randomUUID()}`;
    const title = dto.title ?? `Admin Room`;

    const room = await this.prisma.liveRoom.create({
      data: {
        title,
        eventId: dto.eventId ?? undefined,
        agoraChannel,
        status: LiveRoomStatus.SCHEDULED,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_LIVESTREAM_ROOM_CREATED",
        entityType: "livestream_room",
        entityId: room.id,
        payload: { adminId: authUser.userId, title, eventId: dto.eventId ?? null },
      },
    });

    return {
      data: {
        id: room.id,
        title: room.title,
        agoraChannel: room.agoraChannel,
        status: room.status,
        eventId: room.eventId,
        createdAt: room.createdAt.toISOString(),
      },
    };
  }

  async updateRoom(roomId: string, dto: { title?: string; eventId?: string | null; description?: string; tags?: string }, authUser: AuthUser) {
    const room = await this.ensureRoom(roomId);

    const updated = await this.prisma.liveRoom.update({
      where: { id: roomId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.eventId !== undefined ? { eventId: dto.eventId } : {}),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_LIVESTREAM_ROOM_UPDATED",
        entityType: "livestream_room",
        entityId: roomId,
        payload: { adminId: authUser.userId, changes: dto },
      },
    });

    return { data: updated };
  }

  async deleteRoom(roomId: string, authUser: AuthUser) {
    const room = await this.ensureRoom(roomId);

    await this.prisma.liveRoom.delete({ where: { id: roomId } });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_LIVESTREAM_ROOM_DELETED",
        entityType: "livestream_room",
        entityId: roomId,
        payload: { adminId: authUser.userId, roomTitle: room.title },
      },
    });

    return { success: true, roomId };
  }

  async startRoom(roomId: string, authUser: AuthUser) {
    const room = await this.ensureRoom(roomId);

    if (room.status !== LiveRoomStatus.SCHEDULED) {
      throw new BadRequestException("Room must be in SCHEDULED status to start.");
    }

    const now = new Date();
    const updated = await this.prisma.liveRoom.update({
      where: { id: roomId },
      data: { status: LiveRoomStatus.LIVE, startedAt: now },
    });

    await this.prisma.liveTimelineEvent.create({
      data: {
        roomId,
        actorUserId: authUser.userId,
        action: "ROOM_STARTED_BY_ADMIN",
        metadata: { startedAt: now.toISOString() },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_LIVESTREAM_ROOM_START",
        entityType: "livestream_room",
        entityId: roomId,
        payload: { adminId: authUser.userId, startedAt: now.toISOString() },
      },
    });

    return { data: { id: updated.id, status: updated.status, startedAt: updated.startedAt?.toISOString() ?? null } };
  }

  async stopRoom(roomId: string, authUser: AuthUser) {
    const room = await this.ensureRoom(roomId);

    if (room.status !== LiveRoomStatus.LIVE) {
      throw new BadRequestException("Room must be in LIVE status to stop.");
    }

    const now = new Date();
    const duration = room.startedAt ? Math.floor((now.getTime() - room.startedAt.getTime()) / 1000) : 0;
    const updated = await this.prisma.liveRoom.update({
      where: { id: roomId },
      data: { status: LiveRoomStatus.ENDED, endedAt: now },
    });

    await this.prisma.liveTimelineEvent.create({
      data: {
        roomId,
        actorUserId: authUser.userId,
        action: "ROOM_STOPPED_BY_ADMIN",
        metadata: { endedAt: now.toISOString(), durationSeconds: duration },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_LIVESTREAM_ROOM_STOP",
        entityType: "livestream_room",
        entityId: roomId,
        payload: { adminId: authUser.userId, endedAt: now.toISOString(), durationSeconds: duration },
      },
    });

    return { data: { id: updated.id, status: updated.status, endedAt: updated.endedAt?.toISOString() ?? null, duration } };
  }

  // ─── Moderation ────────────────────────────────────────────────────────────────

  async muteParticipant(
    roomId: string,
    targetUserId: string,
    dto: AdminModerationMuteDto,
    authUser: AuthUser,
  ) {
    await this.livestreamService.muteParticipant(
      {
        room_id: roomId,
        target_user_id: targetUserId,
        reason: this.normalizeReason(dto.reason),
        duration_seconds: dto.durationSeconds,
      },
      authUser,
    );

    return this.buildModerationResponse("mute", roomId, targetUserId);
  }

  async removeParticipant(
    roomId: string,
    targetUserId: string,
    dto: AdminModerationRemoveDto,
    authUser: AuthUser,
  ) {
    await this.livestreamService.removeParticipant(
      {
        room_id: roomId,
        target_user_id: targetUserId,
        reason: this.normalizeReason(dto.reason),
      },
      authUser,
    );

    return this.buildModerationResponse("remove", roomId, targetUserId);
  }

  async promoteParticipant(
    roomId: string,
    targetUserId: string,
    dto: AdminModerationPromoteDto,
    authUser: AuthUser,
  ) {
    const response = await this.livestreamService.promoteParticipant(
      {
        room_id: roomId,
        target_user_id: targetUserId,
        role: dto.role,
      },
      authUser,
    );

    return this.buildModerationResponse("promote", roomId, targetUserId, {
      role: dto.role,
      participantId: response.data.participant_id,
    });
  }

  // ─── Moderation Filters ──────────────────────────────────────────────────────────

  async getFilters(roomId: string) {
    await this.ensureRoom(roomId);
    const filters = this.filterStore.get(roomId) ?? [];
    return { data: filters, meta: { total: filters.length } };
  }

  async createFilter(dto: CreateFilterDto, authUser: AuthUser) {
    await this.ensureRoom(dto.roomId);

    const filter: ModerationFilter = {
      id: randomUUID(),
      roomId: dto.roomId,
      pattern: dto.pattern,
      type: dto.type,
      action: dto.action,
      timeoutDurationSeconds: dto.timeoutDurationSeconds,
      enabled: dto.enabled ?? true,
      createdAt: new Date(),
    };

    const existing = this.filterStore.get(dto.roomId) ?? [];
    this.filterStore.set(dto.roomId, [...existing, filter]);

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_FILTER_CREATED",
        entityType: "moderation_filter",
        entityId: filter.id,
        payload: { adminId: authUser.userId, roomId: dto.roomId, pattern: dto.pattern },
      },
    });

    return { data: filter };
  }

  async updateFilter(filterId: string, dto: UpdateFilterDto, authUser: AuthUser) {
    // Find filter across all rooms
    for (const [roomId, filters] of this.filterStore.entries()) {
      const idx = filters.findIndex((f) => f.id === filterId);
      if (idx === -1) continue;

      const updated: ModerationFilter = {
        ...filters[idx],
        ...(dto.pattern !== undefined ? { pattern: dto.pattern } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.action !== undefined ? { action: dto.action } : {}),
        ...(dto.timeoutDurationSeconds !== undefined
          ? { timeoutDurationSeconds: dto.timeoutDurationSeconds }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      };

      const next = [...filters];
      next[idx] = updated;
      this.filterStore.set(roomId, next);

      await this.prisma.auditLog.create({
        data: {
          action: "ADMIN_FILTER_UPDATED",
          entityType: "moderation_filter",
          entityId: filterId,
          payload: { adminId: authUser.userId, roomId, changes: { ...dto } },
        },
      });

      return { data: updated };
    }

    throw new NotFoundException("Moderation filter was not found.");
  }

  async deleteFilter(filterId: string, authUser: AuthUser) {
    for (const [roomId, filters] of this.filterStore.entries()) {
      const idx = filters.findIndex((f) => f.id === filterId);
      if (idx === -1) continue;

      this.filterStore.set(
        roomId,
        filters.filter((f) => f.id !== filterId),
      );

      await this.prisma.auditLog.create({
        data: {
          action: "ADMIN_FILTER_DELETED",
          entityType: "moderation_filter",
          entityId: filterId,
          payload: { adminId: authUser.userId, roomId },
        },
      });

      return { success: true, filterId };
    }

    throw new NotFoundException("Moderation filter was not found.");
  }

  // ─── Chat Config ────────────────────────────────────────────────────────────────

  async getChatConfig(roomId: string) {
    await this.ensureRoom(roomId);
    const stored = this.chatConfigStore.get(roomId);
    const config: ChatConfig = stored ?? {
      mode: ChatMode.ALL,
      slowModeSeconds: 0,
      raidDefenseThreshold: 500,
    };
    return { data: config };
  }

  async updateChatConfig(roomId: string, dto: UpdateChatConfigDto, authUser: AuthUser) {
    await this.ensureRoom(roomId);

    const current: ChatConfig = this.chatConfigStore.get(roomId) ?? {
      mode: ChatMode.ALL,
      slowModeSeconds: 0,
      raidDefenseThreshold: 500,
    };

    const updated: ChatConfig = {
      mode: dto.mode ?? current.mode,
      slowModeSeconds: dto.slowModeSeconds ?? current.slowModeSeconds,
      raidDefenseThreshold: dto.raidDefenseThreshold ?? current.raidDefenseThreshold,
    };

    this.chatConfigStore.set(roomId, updated);

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_CHAT_CONFIG_UPDATED",
        entityType: "chat_config",
        entityId: roomId,
        payload: { adminId: authUser.userId, roomId, changes: { ...dto } },
      },
    });

    return { data: updated };
  }

  // ─── Chat Timeout ────────────────────────────────────────────────────────────────

  async timeoutUser(roomId: string, dto: TimeoutUserDto, authUser: AuthUser) {
    const room = await this.ensureRoom(roomId);

    if (room.status !== LiveRoomStatus.LIVE) {
      throw new BadRequestException("Room must be LIVE to timeout a user from chat.");
    }

    // Prevent timing out the room host
    const host = await this.prisma.liveParticipant.findFirst({
      where: { roomId, role: LiveParticipantRole.HOST },
    });
    if (host?.userId === dto.userId) {
      throw new ForbiddenException("Cannot timeout the room host.");
    }

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_CHAT_TIMEOUT",
        entityType: "chat_timeout",
        entityId: roomId,
        payload: {
          adminId: authUser.userId,
          roomId,
          targetUserId: dto.userId,
          durationSeconds: dto.durationSeconds,
          permanent: dto.permanent ?? false,
          reason: dto.reason ?? null,
        },
      },
    });

    return {
      data: {
        success: true,
        roomId,
        targetUserId: dto.userId,
        durationSeconds: dto.durationSeconds,
        permanent: dto.permanent ?? false,
      },
    };
  }

  private async ensureRoom(roomId: string) {
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException("Livestream room was not found.");
    }

    return room;
  }

  private buildModerationResponse(
    action: "mute" | "remove" | "promote",
    roomId: string,
    targetUserId: string,
    extras?: {
      role?: string;
      participantId?: string | null;
    },
  ) {
    return {
      data: {
        success: true,
        action,
        roomId,
        targetUserId,
        role: extras?.role ?? null,
        participantId: extras?.participantId ?? null,
      },
      message: this.buildModerationMessage(action, extras?.role),
    };
  }

  private buildModerationMessage(
    action: "mute" | "remove" | "promote",
    role?: string,
  ) {
    if (action === "promote") {
      return `Participant promoted to ${role ?? "the requested role"}.`;
    }

    return `Participant ${action} action completed.`;
  }

  private normalizeReason(reason?: string) {
    const normalized = reason?.trim();
    return normalized ? normalized : undefined;
  }

  private isLiveRoomStatus(status: string): status is LiveRoomStatus {
    return Object.values(LiveRoomStatus).includes(status as LiveRoomStatus);
  }

  private buildRoomsOrderBy(
    query: NormalizedAdminListQuery<RoomSortField>,
  ): Prisma.LiveRoomOrderByWithRelationInput[] {
    switch (query.sortBy) {
      case "title":
        return [
          { title: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      case "status":
        return [
          { status: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      default:
        return [{ createdAt: query.sortOrder }, { id: "desc" }];
    }
  }
}
