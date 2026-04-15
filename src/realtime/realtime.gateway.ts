import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { LiveParticipantRole, LiveRoomStatus } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { REALTIME_TOPICS } from '../common/constants/realtime-topics';
import { AuthUser } from '../modules/auth/interfaces/auth-user.interface';
import { PrismaService } from '../prisma/prisma.service';

interface AuthenticatedSocket extends Socket {
  data: {
    user?: AuthUser;
    roomId?: string;
    topicSubscriptions?: Set<string>;
  };
}

@WebSocketGateway({
  namespace: /^\/($|ws|livestream|api\/v1\/livestream\/ws\/[^/]+)$/,
  cors: { origin: '*' },
  path: '/ws',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly roomSocketIds = new Map<string, Set<string>>();
  private readonly roomUserSocketIds = new Map<string, Map<string, Set<string>>>();
  private readonly socketIndex = new Map<string, AuthenticatedSocket>();

  private static readonly ROOM_NAMESPACE_PREFIX = '/api/v1/livestream/ws/';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const token = this.extractBearerToken(client);
    if (!token) {
      this.logger.warn(
        `[WS] Rejecting socket without token: ${JSON.stringify(this.socketLogContext(client))}`,
      );
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      client.data.user = {
        userId: payload.sub,
        role: payload.role,
      };

      this.socketIndex.set(client.id, client);
      this.attachSocketLifecycleDebuggers(client);

      const roomIdFromNamespace = this.extractRoomIdFromNamespace(client.nsp.name);
      if (roomIdFromNamespace) {
        await this.joinRoom(client, roomIdFromNamespace);
      }

      this.logger.log(
        `[WS] Client connected: ${JSON.stringify({
          ...this.socketLogContext(client),
          tokenSource: this.tokenSource(client),
          namespaceRoomId: roomIdFromNamespace,
        })}`,
      );
    } catch (error) {
      const message =
        error instanceof WsException ? error.message : 'Unauthorized: invalid token';
      this.logger.warn(
        `[WS] Connection rejected: ${JSON.stringify({
          ...this.socketLogContext(client),
          error: message,
        })}`,
      );
      client.emit('error', { message });
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    try {
      const { roomId } = client.data;
      if (roomId) {
        await this.leaveRoom(client, roomId);
      }
    } finally {
      this.socketIndex.delete(client.id);
    }

    this.logger.log(
      `[WS] Client disconnected: ${JSON.stringify(this.socketLogContext(client))}`,
    );
  }

  @SubscribeMessage('room.join')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.data.user) {
      throw new WsException('Unauthorized');
    }

    if (!data?.roomId) {
      throw new WsException('roomId is required');
    }

    await this.joinRoom(client, data.roomId);
  }

  @SubscribeMessage('room.leave')
  async handleLeaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.data.user) {
      throw new WsException('Unauthorized');
    }

    const roomId = data?.roomId ?? client.data.roomId;
    if (!roomId) {
      throw new WsException('roomId is required');
    }

    await this.leaveRoom(client, roomId);
  }

  @SubscribeMessage('livestream.subscribe')
  async handleSubscribeTopics(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topics?: string[]; topic?: string },
  ) {
    const topics = this.normalizeTopics(data);
    this.logger.log(
      `[WS] Subscribe request received: ${JSON.stringify({
        ...this.socketLogContext(client),
        requestedTopics: topics,
      })}`,
    );
    await this.subscribeTopics(client, topics);
  }

  @SubscribeMessage('livestream.unsubscribe')
  async handleUnsubscribeTopics(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { topics?: string[]; topic?: string },
  ) {
    const topics = this.normalizeTopics(data);
    this.logger.log(
      `[WS] Unsubscribe request received: ${JSON.stringify({
        ...this.socketLogContext(client),
        requestedTopics: topics,
      })}`,
    );
    await this.unsubscribeTopics(client, topics);
  }

  @SubscribeMessage('message')
  async handleGenericMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      type?: string;
      payload?: { topic?: string; topics?: string[] };
    },
  ) {
    const type = data?.type?.trim().toLowerCase();
    this.logger.debug(
      `[WS] Generic message received: ${JSON.stringify({
        ...this.socketLogContext(client),
        type,
        payload: data?.payload,
      })}`,
    );
    if (type === 'subscribe') {
      await this.subscribeTopics(client, this.normalizeTopics(data?.payload));
    }

    if (type === 'unsubscribe') {
      await this.unsubscribeTopics(client, this.normalizeTopics(data?.payload));
    }
  }

  toRoom<T>(roomId: string, event: string, payload: T) {
    const socketIds = this.roomSocketIds.get(roomId);
    if (!socketIds || socketIds.size === 0) {
      return;
    }

    for (const socketId of socketIds) {
      const socket = this.socketIndex.get(socketId);
      socket?.emit(event, payload);
    }
  }

  emitLivestreamRoomEvent<T>(roomId: string, event: string, data: T) {
    const envelope = {
      type: event,
      payload: {
        roomId,
        room_id: roomId,
        data,
      },
      timestamp: new Date().toISOString(),
    };

    const socketIds = this.roomSocketIds.get(roomId);
    if (!socketIds || socketIds.size === 0) {
      this.logger.warn(
        `[WS] Broadcast skipped: ${JSON.stringify({
          roomId,
          event,
          reason: 'no_active_sockets',
          envelope,
        })}`,
      );
      return;
    }

    const roomTopic = this.roomTopic(roomId);
    const eventTopic = this.eventTopic(roomId, event);
    const deliveredSocketIds: string[] = [];
    const skippedSockets: Array<{ socketId: string; reason: string; topics?: string[] }> = [];

    for (const socketId of socketIds) {
      const socket = this.socketIndex.get(socketId);
      if (!socket) {
        skippedSockets.push({ socketId, reason: 'socket_not_indexed' });
        continue;
      }

      const subscriptions = socket.data.topicSubscriptions;
      const allowAll = !subscriptions || subscriptions.size === 0;
      const allowByTopic =
        subscriptions?.has(roomTopic) || (eventTopic ? subscriptions?.has(eventTopic) : false);

      if (allowAll || allowByTopic) {
        deliveredSocketIds.push(socketId);
        socket.emit(event, envelope);
      } else {
        skippedSockets.push({
          socketId,
          reason: 'topic_not_subscribed',
          topics: Array.from(subscriptions),
        });
      }
    }

    this.logger.log(
      `[WS] Broadcast emitted: ${JSON.stringify({
        roomId,
        event,
        roomTopic,
        eventTopic,
        socketIds: Array.from(socketIds),
        deliveredSocketIds,
        skippedSockets,
        envelope,
      })}`,
    );
  }

  publish<T>(event: string, payload: T) {
    for (const socket of this.socketIndex.values()) {
      socket.emit(event, payload);
    }
  }

  getViewerCount(roomId: string): number {
    return this.roomSocketIds.get(roomId)?.size ?? 0;
  }

  getViewerCountSnapshot(roomIds: string[]): Map<string, number> {
    return new Map(roomIds.map((roomId) => [roomId, this.getViewerCount(roomId)]));
  }

  private async joinRoom(client: AuthenticatedSocket, roomId: string) {
    const user = client.data.user;
    if (!user) {
      throw new WsException('Unauthorized');
    }

    const room = await this.prisma.liveRoom.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new WsException('Room not found');
    }

    if (room.status === LiveRoomStatus.ENDED) {
      throw new WsException('Room has ended');
    }

    const participant = await this.prisma.liveParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: user.userId } },
    });

    if (participant?.role === LiveParticipantRole.BLOCKED) {
      throw new WsException('Forbidden: user is blocked in this room');
    }

    const prevRoom = client.data.roomId;
    if (prevRoom && prevRoom !== roomId) {
      await this.leaveRoom(client, prevRoom);
    }

    const isFirstActiveSocketForUser = !this.hasActiveUserInRoom(roomId, user.userId);
    const joinedAt = new Date();

    await client.join(roomId);

    if (!this.roomSocketIds.has(roomId)) {
      this.roomSocketIds.set(roomId, new Set());
    }
    this.roomSocketIds.get(roomId)!.add(client.id);

    this.addUserSocket(roomId, user.userId, client.id);

    if (isFirstActiveSocketForUser) {
      await this.prisma.liveParticipant.upsert({
        where: { roomId_userId: { roomId, userId: user.userId } },
        update: { leftAt: null, joinedAt },
        create: {
          roomId,
          userId: user.userId,
          role: LiveParticipantRole.AUDIENCE,
          joinedAt,
        },
      });

      const displayName = await this.resolveDisplayName(user.userId);
      const viewerCount = this.getViewerCount(roomId);
      this.emitLivestreamRoomEvent(roomId, REALTIME_TOPICS.LIVE_PARTICIPANT_JOINED, {
        roomId,
        room_id: roomId,
        userId: user.userId,
        user_id: user.userId,
        displayName,
        display_name: displayName,
        joinedAt: joinedAt.toISOString(),
        joined_at: joinedAt.toISOString(),
        viewerCount,
        viewer_count: viewerCount,
      });
    }

    client.data.roomId = roomId;

    await this.broadcastViewerCount(roomId);

    client.emit('room.joined', { roomId, userId: user.userId });
    this.logger.log(
      `[WS] Room join success: ${JSON.stringify({
        ...this.socketLogContext(client),
        roomId,
        previousRoomId: prevRoom,
        isFirstActiveSocketForUser,
        roomSocketIds: this.snapshotRoomSocketIds(roomId),
        roomUserSocketIds: this.snapshotRoomUserSocketIds(roomId),
      })}`,
    );
  }

  private async leaveRoom(client: AuthenticatedSocket, roomId: string) {
    const beforeRoomSocketIds = this.snapshotRoomSocketIds(roomId);
    const beforeRoomUserSocketIds = this.snapshotRoomUserSocketIds(roomId);
    await client.leave(roomId);

    const sockets = this.roomSocketIds.get(roomId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.roomSocketIds.delete(roomId);
      }
    }

    const user = client.data.user;
    if (user) {
      const userLeftRoom = this.removeUserSocket(roomId, user.userId, client.id);
      if (userLeftRoom) {
        const leftAt = new Date();
        await this.prisma.liveParticipant.updateMany({
          where: { roomId, userId: user.userId, leftAt: null },
          data: { leftAt },
        });

        const displayName = await this.resolveDisplayName(user.userId);
        const viewerCount = this.getViewerCount(roomId);
        this.emitLivestreamRoomEvent(roomId, REALTIME_TOPICS.LIVE_PARTICIPANT_LEFT, {
          roomId,
          room_id: roomId,
          userId: user.userId,
          user_id: user.userId,
          displayName,
          display_name: displayName,
          leftAt: leftAt.toISOString(),
          left_at: leftAt.toISOString(),
          viewerCount,
          viewer_count: viewerCount,
        });
      }
    }

    if (client.data.roomId === roomId) {
      client.data.roomId = undefined;
      client.data.topicSubscriptions = undefined;
    }

    await this.broadcastViewerCount(roomId);

    this.logger.log(
      `[WS] Room leave success: ${JSON.stringify({
        ...this.socketLogContext(client),
        roomId,
        beforeRoomSocketIds,
        beforeRoomUserSocketIds,
        afterRoomSocketIds: this.snapshotRoomSocketIds(roomId),
        afterRoomUserSocketIds: this.snapshotRoomUserSocketIds(roomId),
      })}`,
    );
  }

  private async broadcastViewerCount(roomId: string) {
    const viewerCount = this.getViewerCount(roomId);
    this.emitLivestreamRoomEvent(roomId, REALTIME_TOPICS.LIVE_VIEWER_COUNT_UPDATED, {
      roomId,
      room_id: roomId,
      viewerCount,
      viewer_count: viewerCount,
    });
  }

  private addUserSocket(roomId: string, userId: string, socketId: string) {
    if (!this.roomUserSocketIds.has(roomId)) {
      this.roomUserSocketIds.set(roomId, new Map());
    }

    const userSockets = this.roomUserSocketIds.get(roomId)!;
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }

    userSockets.get(userId)!.add(socketId);
  }

  private hasActiveUserInRoom(roomId: string, userId: string): boolean {
    const roomUsers = this.roomUserSocketIds.get(roomId);
    if (!roomUsers) {
      return false;
    }

    const sockets = roomUsers.get(userId);
    return Boolean(sockets && sockets.size > 0);
  }

  private async resolveDisplayName(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });

    const displayName = user?.displayName?.trim();
    return displayName && displayName.length > 0 ? displayName : userId;
  }

  private removeUserSocket(roomId: string, userId: string, socketId: string): boolean {
    const userSockets = this.roomUserSocketIds.get(roomId);
    if (!userSockets) {
      return true;
    }

    const sockets = userSockets.get(userId);
    if (!sockets) {
      return true;
    }

    sockets.delete(socketId);
    if (sockets.size === 0) {
      userSockets.delete(userId);
    }

    if (userSockets.size === 0) {
      this.roomUserSocketIds.delete(roomId);
    }

    return !userSockets.has(userId);
  }

  private extractRoomIdFromNamespace(namespace: string): string | null {
    if (!namespace.startsWith(RealtimeGateway.ROOM_NAMESPACE_PREFIX)) {
      return null;
    }

    const roomId = namespace.slice(RealtimeGateway.ROOM_NAMESPACE_PREFIX.length);
    if (!roomId || roomId.includes('/')) {
      return null;
    }

    return decodeURIComponent(roomId);
  }

  private extractBearerToken(client: Socket): string | null {
    const authValues = [
      client.handshake.headers.authorization,
      typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token
        : undefined,
      typeof client.handshake.query?.token === 'string'
        ? `Bearer ${client.handshake.query.token}`
        : undefined,
    ];

    for (const value of authValues) {
      if (!value || typeof value !== 'string') {
        continue;
      }

      const [type, token] = value.trim().split(/\s+/);
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    return null;
  }

  private roomTopic(roomId: string) {
    return `livestream.room.${roomId}`;
  }

  private normalizeTopics(data?: { topic?: string; topics?: string[] }) {
    const topics = new Set<string>();

    if (typeof data?.topic === 'string' && data.topic.trim() !== '') {
      topics.add(data.topic.trim());
    }

    if (Array.isArray(data?.topics)) {
      for (const topic of data.topics) {
        if (typeof topic === 'string' && topic.trim() !== '') {
          topics.add(topic.trim());
        }
      }
    }

    return Array.from(topics);
  }

  private async subscribeTopics(client: AuthenticatedSocket, topics: string[]) {
    if (!client.data.user) {
      throw new WsException('Unauthorized');
    }

    const roomIds = new Set(
      topics
        .map((topic) => this.roomIdFromTopic(topic))
        .filter((roomId): roomId is string => Boolean(roomId)),
    );

    if (roomIds.size > 1) {
      throw new WsException('Subscriptions must target a single room per connection');
    }

    const roomId = roomIds.values().next().value as string | undefined;
    if (roomId) {
      await this.joinRoom(client, roomId);
    }

    const activeRoomId = client.data.roomId;
    if (!activeRoomId) {
      throw new WsException('A room-scoped topic is required');
    }

    const allowedTopics = this.allowedTopics(activeRoomId);
    const acceptedTopics = topics.filter((topic) => allowedTopics.has(topic));

    if (!client.data.topicSubscriptions) {
      client.data.topicSubscriptions = new Set<string>();
    }

    for (const topic of acceptedTopics) {
      client.data.topicSubscriptions.add(topic);
    }

    client.emit('livestream.subscribed', {
      type: 'subscribed',
      payload: { topics: Array.from(client.data.topicSubscriptions) },
    });

    this.logger.log(
      `[WS] Subscribed ack emitted: ${JSON.stringify({
        ...this.socketLogContext(client),
        activeRoomId,
        requestedTopics: topics,
        acceptedTopics,
        topicSubscriptions: Array.from(client.data.topicSubscriptions),
        roomSocketIds: this.snapshotRoomSocketIds(activeRoomId),
        roomUserSocketIds: this.snapshotRoomUserSocketIds(activeRoomId),
      })}`,
    );
  }

  private async unsubscribeTopics(client: AuthenticatedSocket, topics: string[]) {
    if (!client.data.user) {
      throw new WsException('Unauthorized');
    }

    const current = client.data.topicSubscriptions;
    if (!current) {
      client.emit('livestream.unsubscribed', {
        type: 'unsubscribed',
        payload: { topics: [] },
      });
      return;
    }

    for (const topic of topics) {
      current.delete(topic);
    }

    client.emit('livestream.unsubscribed', {
      type: 'unsubscribed',
      payload: { topics: Array.from(current) },
    });

    this.logger.log(
      `[WS] Unsubscribed ack emitted: ${JSON.stringify({
        ...this.socketLogContext(client),
        requestedTopics: topics,
        topicSubscriptions: Array.from(current),
      })}`,
    );
  }

  private roomIdFromTopic(topic: string): string | null {
    const match =
      /^livestream\.room\.([^.:]+)(?:\.(comments|gifts|participants|commenting))?$/.exec(topic);

    return match?.[1] ?? null;
  }

  private eventTopic(roomId: string, event: string): string | null {
    const base = this.roomTopic(roomId);
    if (event === REALTIME_TOPICS.LIVE_COMMENT_CREATED) return `${base}.comments`;
    if (event === REALTIME_TOPICS.LIVE_GIFT_SENT) return `${base}.gifts`;
    if (
      event === REALTIME_TOPICS.LIVE_PARTICIPANT_JOINED ||
      event === REALTIME_TOPICS.LIVE_PARTICIPANT_LEFT ||
      event === REALTIME_TOPICS.LIVE_VIEWER_COUNT_UPDATED
    ) {
      return `${base}.participants`;
    }
    if (event === REALTIME_TOPICS.LIVE_COMMENTING_TOGGLED) return `${base}.commenting`;
    return null;
  }

  private allowedTopics(roomId: string) {
    const base = this.roomTopic(roomId);
    return new Set<string>([
      base,
      `${base}.comments`,
      `${base}.gifts`,
      `${base}.participants`,
      `${base}.commenting`,
    ]);
  }

  private attachSocketLifecycleDebuggers(client: AuthenticatedSocket) {
    client.on('disconnecting', (reason: string) => {
      this.logger.warn(
        `[WS] Socket disconnecting: ${JSON.stringify({
          ...this.socketLogContext(client),
          reason,
          joinedRooms: Array.from(client.rooms),
        })}`,
      );
    });

    client.conn.on('close', (reason: string) => {
      this.logger.warn(
        `[WS] Transport closed: ${JSON.stringify({
          ...this.socketLogContext(client),
          reason,
        })}`,
      );
    });
  }

  private socketLogContext(client: AuthenticatedSocket) {
    return {
      socketId: client.id,
      userId: client.data.user?.userId ?? 'unknown',
      namespace: client.nsp.name,
      roomId: client.data.roomId ?? null,
      topics: client.data.topicSubscriptions
        ? Array.from(client.data.topicSubscriptions)
        : [],
      handshake: {
        authKeys: Object.keys(client.handshake.auth ?? {}),
        hasQueryToken: typeof client.handshake.query?.token === 'string',
        hasAuthorizationHeader: typeof client.handshake.headers.authorization === 'string',
        queryRoomId:
          typeof client.handshake.query?.roomId === 'string' ? client.handshake.query.roomId : null,
      },
    };
  }

  private tokenSource(client: AuthenticatedSocket) {
    if (typeof client.handshake.headers.authorization === 'string') {
      return 'authorization_header';
    }

    if (typeof client.handshake.auth?.token === 'string') {
      return 'handshake_auth';
    }

    if (typeof client.handshake.query?.token === 'string') {
      return 'query_token';
    }

    return 'missing';
  }

  private snapshotRoomSocketIds(roomId: string) {
    return Array.from(this.roomSocketIds.get(roomId) ?? []);
  }

  private snapshotRoomUserSocketIds(roomId: string) {
    const roomUsers = this.roomUserSocketIds.get(roomId);
    if (!roomUsers) {
      return {};
    }

    return Object.fromEntries(
      Array.from(roomUsers.entries()).map(([userId, socketIds]) => [userId, Array.from(socketIds)]),
    );
  }
}
