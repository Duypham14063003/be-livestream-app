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
  UserRole,
} from '@prisma/client';
import { RtcTokenBuilder } from 'agora-token';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { REALTIME_TOPICS } from '../../common/constants/realtime-topics';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import {
  LIVESTREAM_ALLOWED_ROLES,
  LIVESTREAM_ROOM_STATUSES,
  LivestreamRequestedRole,
  LivestreamRoomStatus,
} from './constants/livestream.constants';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { SendGiftDto } from './dto/send-gift.dto';
import { ToggleCommentsDto } from './dto/toggle-comments.dto';
import { IssueLivestreamTokenDto } from './dto/issue-token.dto';
import { ModerationMuteDto } from './dto/moderation-mute.dto';
import { ModerationPromoteDto } from './dto/moderation-promote.dto';
import { ModerationRemoveDto } from './dto/moderation-remove.dto';
import { StartRoomDto } from './dto/start-room.dto';
import { EndRoomDto } from './dto/end-room.dto';

@Injectable()
export class LivestreamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly realtimeGateway: RealtimeGateway,
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

  async startRoom(roomId: string, dto: StartRoomDto, authUser: AuthUser) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('Room không tồn tại');
    }

    const participant = await this.prisma.liveParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: authUser.userId } },
    });

    if (!participant || participant.role !== LiveParticipantRole.HOST) {
      if (!this.isAdmin(authUser)) {
        throw new ForbiddenException('Chỉ host mới có thể bắt đầu room');
      }
    }

    if (room.status === LiveRoomStatus.LIVE) {
      return { id: room.id, status: 'live', message: 'Room đã đang live' };
    }

    const updatedRoom = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.liveRoom.update({
        where: { id: roomId },
        data: {
          status: LiveRoomStatus.LIVE,
          startedAt: new Date(),
          ...(dto.title ? { title: dto.title } : {}),
        },
      });

      await tx.liveTimelineEvent.create({
        data: {
          roomId,
          actorUserId: authUser.userId,
          action: 'ROOM_STARTED',
          metadata: { title: dto.title ?? room.title },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'LIVESTREAM_ROOM_STARTED',
          entityType: 'livestream_room',
          entityId: roomId,
          payload: { userId: authUser.userId, title: dto.title ?? room.title },
        },
      });

      return updated;
    });

    this.eventEmitter.emit(REALTIME_TOPICS.LIVE_ROOM_UPDATED, {
      roomId,
      status: 'live',
      title: updatedRoom.title,
      startedAt: updatedRoom.startedAt,
    });

    return {
      id: updatedRoom.id,
      title: updatedRoom.title,
      status: this.mapRoomStatus(updatedRoom.status),
      started_at: updatedRoom.startedAt?.toISOString(),
    };
  }

  async endRoom(roomId: string, dto: EndRoomDto, authUser: AuthUser) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('Room không tồn tại');
    }

    const participant = await this.prisma.liveParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: authUser.userId } },
    });

    if (!participant || participant.role !== LiveParticipantRole.HOST) {
      if (!this.isAdmin(authUser)) {
        throw new ForbiddenException('Chỉ host mới có thể kết thúc room');
      }
    }

    if (room.status === LiveRoomStatus.ENDED) {
      return { id: room.id, status: 'ended', message: 'Room đã kết thúc' };
    }

    const updatedRoom = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.liveRoom.update({
        where: { id: roomId },
        data: { status: LiveRoomStatus.ENDED, endedAt: new Date() },
      });

      await tx.liveTimelineEvent.create({
        data: {
          roomId,
          actorUserId: authUser.userId,
          action: 'ROOM_ENDED',
          metadata: { reason: dto.reason ?? 'host_ended' },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'LIVESTREAM_ROOM_ENDED',
          entityType: 'livestream_room',
          entityId: roomId,
          payload: { userId: authUser.userId, reason: dto.reason ?? 'host_ended' },
        },
      });

      return updated;
    });

    this.eventEmitter.emit(REALTIME_TOPICS.LIVE_ROOM_UPDATED, {
      roomId,
      status: 'ended',
      endedAt: updatedRoom.endedAt,
    });

    return {
      id: updatedRoom.id,
      status: this.mapRoomStatus(updatedRoom.status),
      ended_at: updatedRoom.endedAt?.toISOString(),
    };
  }

  async getRooms() {
    const rooms = await this.prisma.liveRoom.findMany({
      where: {
        status: {
          in: [LiveRoomStatus.SCHEDULED, LiveRoomStatus.LIVE],
        },
      },
      include: {
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
    const viewerCountByRoom = this.realtimeGateway.getViewerCountSnapshot(roomIds);

    return {
      data: rooms.map((room) => ({
        id: room.id,
        title: room.title ?? null,
        agora_channel: room.agoraChannel,
        status: this.mapRoomStatus(room.status),
        viewer_count: viewerCountByRoom.get(room.id) ?? 0,
        viewerCount: viewerCountByRoom.get(room.id) ?? 0,
        host_id: room.participants[0]?.userId ?? null,
        started_at: (room.startedAt ?? room.createdAt).toISOString(),
      })),
    };
  }

  async issueRtcToken(dto: IssueLivestreamTokenDto, authUser: AuthUser) {
    const explicitChannel = this.resolveChannelName(dto);
    if (explicitChannel) {
      const requestedRole = this.parseContractRole(dto.role);
      if (!requestedRole) {
        throw new UnprocessableEntityException({
          code: 'invalid_role',
          message: 'role must be one of: host | audience',
        });
      }

      if (dto.uid === undefined) {
        throw new UnprocessableEntityException({
          code: 'invalid_uid',
          message: 'uid must be a positive integer',
        });
      }

      const { agoraAppId, agoraAppCertificate } = this.resolveAgoraCredentials();
      const ttlSeconds = this.resolveTokenTtl();
      const issuedAt = new Date();
      const expireAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
      const token = this.buildRtcToken({
        agoraAppId,
        agoraAppCertificate,
        channelName: explicitChannel,
        uid: dto.uid,
        ttlSeconds,
        isPublisher: requestedRole === 'host',
      });

      return {
        data: {
          token,
          app_id: agoraAppId,
          appId: agoraAppId,
          channel_name: explicitChannel,
          channelName: explicitChannel,
          uid: dto.uid,
          expire_at: expireAt.toISOString(),
        },
      };
    }

    if (!dto.roomId || !dto.userId) {
      throw new UnprocessableEntityException({
        code: 'invalid_payload',
        message: 'roomId and userId are required when channelName is not provided',
      });
    }

    const roomId = dto.roomId;
    const userId = dto.userId;

    const requestedRole = this.parseRequestedRole(dto.role);
    if (!requestedRole) {
      throw new UnprocessableEntityException({
        code: 'invalid_role',
        message: 'role must be one of: host | cohost | audience',
      });
    }

    if (!this.isAdmin(authUser) && authUser.userId !== userId) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'user_id must match authenticated user',
      });
    }

    const room = await this.prisma.liveRoom.findUnique({
      where: {
        id: roomId,
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
          userId,
        },
      },
    });

    if (participantAssignment?.role === LiveParticipantRole.BLOCKED) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'user is blocked in this room',
      });
    }

    const canAccessRoom = this.canAccessRoom(
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

    const { agoraAppId, agoraAppCertificate } = this.resolveAgoraCredentials();

    const ttlSeconds = this.resolveTokenTtl();
    const issuedAt = new Date();
    const expireAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
    const uid = this.stableAgoraUid(userId);
    const isPublisher = resolvedRole === 'host' || resolvedRole === 'cohost';

    const token = this.buildRtcToken({
      agoraAppId,
      agoraAppCertificate,
      channelName: room.agoraChannel,
      uid,
      ttlSeconds,
      isPublisher,
    });

    const persistedParticipantRole =
      participantAssignment?.role ?? LiveParticipantRole.AUDIENCE;

    await this.prisma.$transaction(async (tx) => {
      await tx.liveParticipant.upsert({
        where: {
          roomId_userId: {
            roomId,
            userId,
          },
        },
        update: {
          role: persistedParticipantRole,
          leftAt: null,
        },
        create: {
          roomId,
          userId,
          role: persistedParticipantRole,
          joinedAt: issuedAt,
        },
      });

      await tx.liveTimelineEvent.create({
        data: {
          roomId,
          actorUserId: userId,
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
          entityId: roomId,
          payload: {
            room_id: roomId,
            user_id: userId,
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
        token,
        app_id: agoraAppId,
        appId: agoraAppId,
        channel_name: room.agoraChannel,
        channelName: room.agoraChannel,
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

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.target_user_id },
      select: { displayName: true },
    });

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
      room_id: dto.room_id,
      userId: dto.target_user_id,
      user_id: dto.target_user_id,
      displayName: targetUser?.displayName ?? dto.target_user_id,
      display_name: targetUser?.displayName ?? dto.target_user_id,
      leftAt: now.toISOString(),
      left_at: now.toISOString(),
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

  private canAccessRoom(
    participant: { role: LiveParticipantRole } | null,
    isAdmin: boolean,
  ) {
    if (isAdmin) {
      return true;
    }

    if (participant && participant.role !== LiveParticipantRole.BLOCKED) {
      return true;
    }

    // không có event gắn kết → ai cũng có thể tham gia với vai trò audience
    return true;
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

  private parseContractRole(role: string): 'host' | 'audience' | null {
    const normalized = role.trim().toLowerCase();
    if (normalized === 'host' || normalized === 'audience') {
      return normalized;
    }

    return null;
  }

  private resolveChannelName(dto: IssueLivestreamTokenDto) {
    const fromCamelCase = dto.channelName?.trim();
    if (fromCamelCase) {
      return fromCamelCase;
    }

    const fromSnakeCase = dto.channel_name?.trim();
    if (fromSnakeCase) {
      return fromSnakeCase;
    }

    return null;
  }

  private resolveAgoraCredentials() {
    const agoraAppId = this.configService.get<string>('AGORA_APP_ID');
    const agoraAppCertificate = this.configService.get<string>(
      'AGORA_APP_CERTIFICATE',
    );

    if (!agoraAppId || !agoraAppCertificate) {
      throw new InternalServerErrorException({
        code: 'agora_token_failed',
        message: 'Cannot generate Agora token',
      });
    }

    return { agoraAppId, agoraAppCertificate };
  }

  private buildRtcToken(params: {
    agoraAppId: string;
    agoraAppCertificate: string;
    channelName: string;
    uid: number;
    ttlSeconds: number;
    isPublisher: boolean;
  }) {
    try {
      return RtcTokenBuilder.buildTokenWithUidAndPrivilege(
        params.agoraAppId,
        params.agoraAppCertificate,
        params.channelName,
        params.uid,
        params.ttlSeconds,
        params.ttlSeconds,
        params.isPublisher ? params.ttlSeconds : 0,
        params.isPublisher ? params.ttlSeconds : 0,
        params.isPublisher ? params.ttlSeconds : 0,
      );
    } catch {
      throw new InternalServerErrorException({
        code: 'agora_token_failed',
        message: 'Cannot generate Agora token',
      });
    }
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

  // ─── Comments & Gifts ────────────────────────────────────────────────

  async createComment(roomId: string, dto: CreateCommentDto, authUser: AuthUser) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('Room không tồn tại');
    }

    const participant = await this.prisma.liveParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: authUser.userId } },
    });

    if (participant?.role === LiveParticipantRole.BLOCKED) {
      throw new ForbiddenException('Bạn đã bị chặn trong room này');
    }

    const isHostOrCohost =
      participant?.role === LiveParticipantRole.HOST ||
      participant?.role === LiveParticipantRole.CO_HOST ||
      this.isAdmin(authUser);

    // Nếu comments bị tắt, chỉ host/cohost được gửi
    if (!room.commentsEnabled && !isHostOrCohost) {
      throw new ForbiddenException('Room đã tắt bình luận');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.userId },
      select: { displayName: true },
    });

    const comment = await this.prisma.liveComment.create({
      data: {
        roomId,
        userId: authUser.userId,
        message: dto.message,
        isHost: participant?.role === LiveParticipantRole.HOST || false,
      },
    });

    const payload = this.buildCommentPayload({
      id: comment.id,
      roomId: comment.roomId,
      userId: comment.userId,
      displayName: user?.displayName ?? authUser.userId,
      message: comment.message,
      createdAt: comment.createdAt.toISOString(),
      isHost: comment.isHost,
    });

    // Broadcast via WebSocket
    this.realtimeGateway.emitLivestreamRoomEvent(
      roomId,
      REALTIME_TOPICS.LIVE_COMMENT_CREATED,
      payload,
    );

    return { data: payload };
  }

  async getComments(roomId: string, limit?: string) {
    const parsedLimit = Number(limit);
    const take =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.floor(parsedLimit), 200)
        : 50;
    const comments = await this.prisma.liveComment.findMany({
      where: { roomId },
      include: {
        user: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take,
    });

    return {
      data: comments.map((c) => ({
        ...this.buildCommentPayload({
          id: c.id,
          roomId: c.roomId,
          userId: c.userId,
          displayName: c.user.displayName ?? c.userId,
          message: c.message,
          createdAt: c.createdAt.toISOString(),
          isHost: c.isHost,
        }),
      })),
    };
  }

  async toggleComments(roomId: string, dto: ToggleCommentsDto, authUser: AuthUser) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('Room không tồn tại');
    }

    await this.assertCanModerate(roomId, authUser, false);

    const updated = await this.prisma.liveRoom.update({
      where: { id: roomId },
      data: { commentsEnabled: dto.enabled },
    });

    const payload = {
      roomId,
      room_id: roomId,
      enabled: updated.commentsEnabled,
      updatedBy: authUser.userId,
      updated_by: authUser.userId,
    };

    this.realtimeGateway.emitLivestreamRoomEvent(
      roomId,
      REALTIME_TOPICS.LIVE_COMMENTING_TOGGLED,
      payload,
    );

    return { data: payload };
  }

  async sendGift(roomId: string, dto: SendGiftDto, authUser: AuthUser) {
    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('Room không tồn tại');
    }

    const participant = await this.prisma.liveParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: authUser.userId } },
    });

    if (participant?.role === LiveParticipantRole.BLOCKED) {
      throw new ForbiddenException('Bạn đã bị chặn trong room này');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.userId },
      select: { displayName: true },
    });

    // Convert lowercase DTO value to uppercase Prisma enum
    const giftTypeDb = dto.giftType.toUpperCase() as import('@prisma/client').LiveGiftType;
    const giftMeta = this.getGiftMeta(giftTypeDb);

    const gift = await this.prisma.liveGift.create({
      data: {
        roomId,
        userId: authUser.userId,
        giftType: giftTypeDb,
      },
    });

    const payload = this.buildGiftPayload({
      id: gift.id,
      roomId: gift.roomId,
      userId: gift.userId,
      displayName: user?.displayName ?? authUser.userId,
      giftType: dto.giftType.toLowerCase(),
      giftName: giftMeta.name,
      giftEmoji: giftMeta.emoji,
      createdAt: gift.createdAt.toISOString(),
    });

    this.realtimeGateway.emitLivestreamRoomEvent(
      roomId,
      REALTIME_TOPICS.LIVE_GIFT_SENT,
      payload,
    );

    return { data: payload };
  }

  async getGifts(roomId: string, limit?: string) {
    const parsedLimit = Number(limit);
    const take =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.floor(parsedLimit), 100)
        : 20;
    const gifts = await this.prisma.liveGift.findMany({
      where: { roomId },
      include: {
        user: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take,
    });

    return {
      data: gifts.map((g) => {
        const meta = this.getGiftMeta(g.giftType);
        return this.buildGiftPayload({
          id: g.id,
          roomId: g.roomId,
          userId: g.userId,
          displayName: g.user.displayName ?? g.userId,
          giftType: g.giftType.toLowerCase(),
          giftName: meta.name,
          giftEmoji: meta.emoji,
          createdAt: g.createdAt.toISOString(),
        });
      }),
    };
  }

  private buildCommentPayload(input: {
    id: string;
    roomId: string;
    userId: string;
    displayName: string;
    message: string;
    createdAt: string;
    isHost: boolean;
  }) {
    return {
      id: input.id,
      roomId: input.roomId,
      room_id: input.roomId,
      userId: input.userId,
      user_id: input.userId,
      displayName: input.displayName,
      display_name: input.displayName,
      message: input.message,
      createdAt: input.createdAt,
      created_at: input.createdAt,
      isHost: input.isHost,
      is_host: input.isHost,
    };
  }

  private buildGiftPayload(input: {
    id: string;
    roomId: string;
    userId: string;
    displayName: string;
    giftType: string;
    giftName: string;
    giftEmoji: string;
    createdAt: string;
  }) {
    return {
      id: input.id,
      roomId: input.roomId,
      room_id: input.roomId,
      userId: input.userId,
      user_id: input.userId,
      displayName: input.displayName,
      display_name: input.displayName,
      giftType: input.giftType,
      gift_type: input.giftType,
      giftName: input.giftName,
      gift_name: input.giftName,
      giftEmoji: input.giftEmoji,
      gift_emoji: input.giftEmoji,
      createdAt: input.createdAt,
      created_at: input.createdAt,
    };
  }

  private getGiftMeta(giftType: string) {
    const map: Record<string, { name: string; emoji: string }> = {
      HEART: { name: 'Heart', emoji: '❤️' },
      ROSE: { name: 'Rose', emoji: '🌹' },
      STAR: { name: 'Star', emoji: '⭐' },
      ROCKET: { name: 'Rocket', emoji: '🚀' },
      CROWN: { name: 'Crown', emoji: '👑' },
      DIAMOND: { name: 'Diamond', emoji: '💎' },
    };
    return map[giftType] ?? { name: giftType, emoji: '🎁' };
  }
}
