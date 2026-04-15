import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  LiveParticipantRole,
  LiveRoom,
  LiveRoomStatus,
  Prisma,
  ReservationStatus,
  UserRole,
} from '@prisma/client';
import { RtcTokenBuilder } from 'agora-token';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { REALTIME_TOPICS } from '../../common/constants/realtime-topics';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import {
  LIVESTREAM_ALLOWED_ROLES,
  LIVESTREAM_ROOM_STATUSES,
  LivestreamRequestedRole,
  LivestreamRoomStatus,
} from './constants/livestream.constants';
import { CreateRoomDto } from './dto/create-room.dto';
import { IssueLivestreamTokenDto } from './dto/issue-token.dto';
import { ModerationMuteDto } from './dto/moderation-mute.dto';
import { ModerationPromoteDto } from './dto/moderation-promote.dto';
import { ModerationRemoveDto } from './dto/moderation-remove.dto';

@Injectable()
export class LivestreamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createRoom(dto: CreateRoomDto, authUser: AuthUser) {
    const agoraChannel = `live_${randomUUID()}`;
    const title = dto.title ?? `Live của ${authUser.userId}`;

    const room = await this.prisma.$transaction(async (tx) => {
      const createdRoom = await tx.liveRoom.create({
        data: {
          title,
          agoraChannel,
          status: LiveRoomStatus.SCHEDULED,
        },
      });

      await tx.liveParticipant.upsert({
        where: {
          roomId_userId: {
            roomId: createdRoom.id,
            userId: authUser.userId,
          },
        },
        update: {
          role: LiveParticipantRole.HOST,
          leftAt: null,
        },
        create: {
          roomId: createdRoom.id,
          userId: authUser.userId,
          role: LiveParticipantRole.HOST,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'LIVESTREAM_ROOM_CREATED',
          entityType: 'livestream_room',
          entityId: createdRoom.id,
          payload: {
            host_user_id: authUser.userId,
            title,
            agora_channel: agoraChannel,
          },
        },
      });

      return createdRoom;
    });

    this.eventEmitter.emit(REALTIME_TOPICS.LIVE_ROOM_CREATED, {
      roomId: room.id,
      hostId: authUser.userId,
      title,
      agoraChannel: room.agoraChannel,
    });

    return {
      id: room.id,
      title,
      agora_channel: room.agoraChannel,
      status: this.mapRoomStatus(room.status),
      host_id: authUser.userId,
      created_at: room.createdAt.toISOString(),
    };
  }

  async getRooms(authUser: AuthUser) {
    const where: Prisma.LiveRoomWhereInput = {
      status: {
        in: [LiveRoomStatus.SCHEDULED, LiveRoomStatus.LIVE],
      },
      ...(this.isAdmin(authUser)
        ? {}
        : {
            OR: [
              {
                participants: {
                  some: {
                    userId: authUser.userId,
                    role: {
                      in: [
                        LiveParticipantRole.HOST,
                        LiveParticipantRole.CO_HOST,
                        LiveParticipantRole.AUDIENCE,
                      ],
                    },
                  },
                },
              },
              {
                event: {
                  reservations: {
                    some: {
                      userId: authUser.userId,
                      status: ReservationStatus.CONFIRMED,
                    },
                  },
                },
              },
            ],
          }),
    };

    const rooms = await this.prisma.liveRoom.findMany({
      where,
      include: {
        event: true,
        participants: {
          where: {
            role: LiveParticipantRole.HOST,
          },
          take: 1,
          orderBy: {
            joinedAt: 'asc',
          },
        },
      },
      orderBy: [{ status: 'asc' }, { startedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const roomIds = rooms.map((room) => room.id);

    const groupedCounts =
      roomIds.length === 0
        ? []
        : await this.prisma.liveParticipant.groupBy({
            by: ['roomId'],
            where: {
              roomId: {
                in: roomIds,
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

    const viewerCountByRoom = new Map(groupedCounts.map((item) => [item.roomId, item._count._all]));

    return {
      data: rooms.map((room) => ({
        id: room.id,
        event_id: room.eventId,
        title: room.title ?? room.event?.title ?? null,
        agora_channel: room.agoraChannel,
        status: this.mapRoomStatus(room.status),
        viewer_count: viewerCountByRoom.get(room.id) ?? 0,
        host_id: room.participants[0]?.userId ?? null,
        started_at: (room.startedAt ?? room.createdAt).toISOString(),
      })),
    };
  }

  async issueRtcToken(dto: IssueLivestreamTokenDto, authUser: AuthUser) {
    const requestedRole = this.parseRequestedRole(dto.role);
    if (!requestedRole) {
      throw new UnprocessableEntityException({
        code: 'invalid_role',
        message: 'role must be one of: host | cohost | audience',
      });
    }

    if (!this.isAdmin(authUser) && authUser.userId !== dto.user_id) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'user_id must match authenticated user',
      });
    }

    const room = await this.prisma.liveRoom.findUnique({
      where: {
        id: dto.room_id,
      },
    });

    if (!room) {
      throw new NotFoundException({
        code: 'room_not_found',
        message: 'livestream room not found',
      });
    }

    const participantAssignment = await this.prisma.liveParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: dto.user_id,
        },
      },
    });

    if (participantAssignment?.role === LiveParticipantRole.BLOCKED) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'user is blocked in this room',
      });
    }

    const canAccessRoom = await this.canAccessRoom(
      room,
      dto.user_id,
      participantAssignment,
      this.isAdmin(authUser),
    );

    if (!canAccessRoom) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'user does not have permission to access this room',
      });
    }

    const resolvedRole = this.resolveTokenRole(requestedRole, participantAssignment?.role);

    const agoraAppId = this.configService.get<string>('AGORA_APP_ID');
    const agoraAppCertificate = this.configService.get<string>('AGORA_APP_CERTIFICATE');

    if (!agoraAppId || !agoraAppCertificate) {
      throw new InternalServerErrorException({
        code: 'token_generation_failed',
        message: 'Agora credentials are not configured on server',
      });
    }

    const ttlSeconds = this.resolveTokenTtl();
    const issuedAt = new Date();
    const expireAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
    const uid = this.stableAgoraUid(dto.user_id);
    const isPublisher = resolvedRole === 'host' || resolvedRole === 'cohost';

    let token: string;
    try {
      token = RtcTokenBuilder.buildTokenWithUidAndPrivilege(
        agoraAppId,
        agoraAppCertificate,
        room.agoraChannel,
        uid,
        ttlSeconds,
        ttlSeconds,
        isPublisher ? ttlSeconds : 0,
        isPublisher ? ttlSeconds : 0,
        isPublisher ? ttlSeconds : 0,
      );
    } catch {
      throw new InternalServerErrorException({
        code: 'token_generation_failed',
        message: 'failed to generate agora rtc token',
      });
    }

    const persistedParticipantRole =
      participantAssignment?.role ?? LiveParticipantRole.AUDIENCE;

    await this.prisma.$transaction(async (tx) => {
      await tx.liveParticipant.upsert({
        where: {
          roomId_userId: {
            roomId: dto.room_id,
            userId: dto.user_id,
          },
        },
        update: {
          role: persistedParticipantRole,
          leftAt: null,
        },
        create: {
          roomId: dto.room_id,
          userId: dto.user_id,
          role: persistedParticipantRole,
          joinedAt: issuedAt,
        },
      });

      await tx.liveTimelineEvent.create({
        data: {
          roomId: dto.room_id,
          actorUserId: dto.user_id,
          action: 'RTC_TOKEN_ISSUED',
          metadata: {
            role: resolvedRole,
            issuedAt,
            expireAt,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'LIVESTREAM_TOKEN_ISSUED',
          entityType: 'livestream_room',
          entityId: dto.room_id,
          payload: {
            room_id: dto.room_id,
            user_id: dto.user_id,
            role: resolvedRole,
            issued_at: issuedAt.toISOString(),
            expire_at: expireAt.toISOString(),
            uid,
          },
        },
      });
    });

    return {
      data: {
        app_id: agoraAppId,
        channel_name: room.agoraChannel,
        token,
        uid,
        expire_at: expireAt.toISOString(),
      },
    };
  }

  async muteParticipant(dto: ModerationMuteDto, authUser: AuthUser) {
    await this.assertCanModerate(dto.room_id, authUser, false);
    await this.ensureSupportedModerationTarget(dto.room_id, dto.target_user_id);

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.liveTimelineEvent.create({
        data: {
          roomId: dto.room_id,
          actorUserId: authUser.userId,
          action: 'PARTICIPANT_MUTED',
          metadata: {
            targetUserId: dto.target_user_id,
            reason: dto.reason ?? 'moderator_action',
            durationSeconds: dto.duration_seconds ?? null,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'LIVESTREAM_MODERATION_MUTE',
          entityType: 'livestream_room',
          entityId: dto.room_id,
          payload: {
            room_id: dto.room_id,
            actor_user_id: authUser.userId,
            target_user_id: dto.target_user_id,
            reason: dto.reason ?? null,
            duration_seconds: dto.duration_seconds ?? null,
            at: now.toISOString(),
          },
        },
      });
    });

    this.eventEmitter.emit(REALTIME_TOPICS.LIVE_MODERATION_ACTION, {
      roomId: dto.room_id,
      action: 'mute',
      actorUserId: authUser.userId,
      targetUserId: dto.target_user_id,
      reason: dto.reason ?? null,
      durationSeconds: dto.duration_seconds ?? null,
    });

    return {
      data: {
        success: true,
        room_id: dto.room_id,
        target_user_id: dto.target_user_id,
        action: 'mute',
      },
    };
  }

  async removeParticipant(dto: ModerationRemoveDto, authUser: AuthUser) {
    await this.assertCanModerate(dto.room_id, authUser, false);
    await this.ensureSupportedModerationTarget(dto.room_id, dto.target_user_id);

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.liveParticipant.updateMany({
        where: {
          roomId: dto.room_id,
          userId: dto.target_user_id,
          leftAt: null,
        },
        data: {
          leftAt: now,
        },
      });

      await tx.liveTimelineEvent.create({
        data: {
          roomId: dto.room_id,
          actorUserId: authUser.userId,
          action: 'PARTICIPANT_REMOVED',
          metadata: {
            targetUserId: dto.target_user_id,
            reason: dto.reason ?? 'moderator_action',
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'LIVESTREAM_MODERATION_REMOVE',
          entityType: 'livestream_room',
          entityId: dto.room_id,
          payload: {
            room_id: dto.room_id,
            actor_user_id: authUser.userId,
            target_user_id: dto.target_user_id,
            reason: dto.reason ?? null,
            at: now.toISOString(),
          },
        },
      });
    });

    this.eventEmitter.emit(REALTIME_TOPICS.LIVE_PARTICIPANT_LEFT, {
      roomId: dto.room_id,
      userId: dto.target_user_id,
      removedBy: authUser.userId,
    });

    this.eventEmitter.emit(REALTIME_TOPICS.LIVE_MODERATION_ACTION, {
      roomId: dto.room_id,
      action: 'remove',
      actorUserId: authUser.userId,
      targetUserId: dto.target_user_id,
      reason: dto.reason ?? null,
    });

    return {
      data: {
        success: true,
        room_id: dto.room_id,
        target_user_id: dto.target_user_id,
        action: 'remove',
      },
    };
  }

  async promoteParticipant(dto: ModerationPromoteDto, authUser: AuthUser) {
    const requestedRole = this.parseRequestedRole(dto.role);
    if (!requestedRole || requestedRole === 'audience') {
      throw new UnprocessableEntityException({
        code: 'invalid_role',
        message: 'role must be host or cohost for promotion',
      });
    }

    const promoteToHost = requestedRole === 'host';
    await this.assertCanModerate(dto.room_id, authUser, promoteToHost);
    const existingParticipant = await this.ensureSupportedModerationTarget(
      dto.room_id,
      dto.target_user_id,
    );

    const roleToPersist =
      requestedRole === 'host' ? LiveParticipantRole.HOST : LiveParticipantRole.CO_HOST;

    if (existingParticipant.role === roleToPersist) {
      throw new UnprocessableEntityException({
        code: 'participant_already_has_role',
        message: `participant is already ${requestedRole}`,
      });
    }

    const participant = await this.prisma.$transaction(async (tx) => {
      const updatedParticipant = await tx.liveParticipant.update({
        where: {
          id: existingParticipant.id,
        },
        data: {
          role: roleToPersist,
          leftAt: null,
        },
      });

      await tx.liveTimelineEvent.create({
        data: {
          roomId: dto.room_id,
          actorUserId: authUser.userId,
          action: 'PARTICIPANT_PROMOTED',
          metadata: {
            targetUserId: dto.target_user_id,
            role: requestedRole,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'LIVESTREAM_MODERATION_PROMOTE',
          entityType: 'livestream_room',
          entityId: dto.room_id,
          payload: {
            room_id: dto.room_id,
            actor_user_id: authUser.userId,
            target_user_id: dto.target_user_id,
            role: requestedRole,
            at: new Date().toISOString(),
          },
        },
      });

      return updatedParticipant;
    });

    this.eventEmitter.emit(REALTIME_TOPICS.LIVE_MODERATION_ACTION, {
      roomId: dto.room_id,
      action: 'promote',
      actorUserId: authUser.userId,
      targetUserId: dto.target_user_id,
      role: requestedRole,
    });

    return {
      data: {
        room_id: dto.room_id,
        target_user_id: dto.target_user_id,
        role: requestedRole,
        participant_id: participant.id,
      },
    };
  }

  private async canAccessRoom(
    room: LiveRoom,
    userId: string,
    participant: { role: LiveParticipantRole } | null,
    isAdmin: boolean,
  ) {
    if (isAdmin) {
      return true;
    }

    if (
      participant &&
      participant.role !== LiveParticipantRole.BLOCKED
    ) {
      return true;
    }

    const reservation = await this.prisma.reservation.findFirst({
      where: {
        userId,
        eventId: room.eventId ?? undefined,
        status: ReservationStatus.CONFIRMED,
      },
      select: {
        id: true,
      },
    });

    return Boolean(reservation);
  }

  private resolveTokenRole(
    requestedRole: LivestreamRequestedRole,
    participantRole?: LiveParticipantRole,
  ): LivestreamRequestedRole {
    if (requestedRole === 'audience') {
      return 'audience';
    }

    if (requestedRole === 'host' && participantRole !== LiveParticipantRole.HOST) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'host role must be granted by backend',
      });
    }

    if (
      requestedRole === 'cohost' &&
      participantRole !== LiveParticipantRole.CO_HOST &&
      participantRole !== LiveParticipantRole.HOST
    ) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'cohost role must be granted by backend',
      });
    }

    if (participantRole === LiveParticipantRole.HOST) {
      return 'host';
    }

    return requestedRole;
  }

  private mapRoomStatus(status: LiveRoomStatus): LivestreamRoomStatus {
    if (status === LiveRoomStatus.LIVE) {
      return LIVESTREAM_ROOM_STATUSES.LIVE;
    }

    if (status === LiveRoomStatus.ENDED) {
      return LIVESTREAM_ROOM_STATUSES.ENDED;
    }

    return LIVESTREAM_ROOM_STATUSES.OFFLINE;
  }

  private parseRequestedRole(role: string): LivestreamRequestedRole | null {
    const normalized = role.trim().toLowerCase();

    if (
      LIVESTREAM_ALLOWED_ROLES.includes(normalized as LivestreamRequestedRole)
    ) {
      return normalized as LivestreamRequestedRole;
    }

    return null;
  }

  private resolveTokenTtl() {
    const configuredTtl = Number(
      this.configService.get<string>('AGORA_RTC_TOKEN_TTL_SECONDS') ?? 1200,
    );

    if (!Number.isFinite(configuredTtl)) {
      return 1200;
    }

    // keep token short-lived in 10-30 minutes range
    return Math.min(1800, Math.max(600, configuredTtl));
  }

  private stableAgoraUid(userId: string) {
    const hash = createHash('sha256').update(userId).digest();
    const raw = hash.readUInt32BE(0);

    // valid Agora uid range: 1...(2^32-1)
    return (raw % 4294967294) + 1;
  }

  private async assertCanModerate(
    roomId: string,
    authUser: AuthUser,
    requireHostLevel: boolean,
  ) {
    if (this.isAdmin(authUser)) {
      return;
    }

    const participant = await this.prisma.liveParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId: authUser.userId,
        },
      },
      select: {
        role: true,
      },
    });

    if (!participant) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'moderator permission required',
      });
    }

    if (participant.role === LiveParticipantRole.BLOCKED) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'blocked user cannot moderate',
      });
    }

    if (requireHostLevel && participant.role !== LiveParticipantRole.HOST) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'host permission required',
      });
    }

    if (
      !requireHostLevel &&
      participant.role !== LiveParticipantRole.HOST &&
      participant.role !== LiveParticipantRole.CO_HOST
    ) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'host/cohost permission required',
      });
    }
  }

  private async ensureSupportedModerationTarget(roomId: string, userId: string) {
    const room = await this.prisma.liveRoom.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException({
        code: 'room_not_found',
        message: 'livestream room not found',
      });
    }

    if (room.status !== LiveRoomStatus.LIVE) {
      throw new UnprocessableEntityException({
        code: 'unsupported_room_state',
        message: 'moderation actions are only available while the room is live',
      });
    }

    const participant = await this.prisma.liveParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    });

    if (!participant || participant.leftAt) {
      throw new NotFoundException({
        code: 'participant_not_active',
        message: 'active participant not found in this room',
      });
    }

    if (participant.role === LiveParticipantRole.BLOCKED) {
      throw new UnprocessableEntityException({
        code: 'participant_not_moderatable',
        message: 'blocked participants cannot be moderated from this workflow',
      });
    }

    return participant;
  }

  private isAdmin(authUser: AuthUser) {
    return authUser.role === UserRole.ADMIN;
  }
}
