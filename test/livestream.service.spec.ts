import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { LivestreamService } from '../src/modules/livestream/livestream.service';
import { AuthUser } from '../src/modules/auth/interfaces/auth-user.interface';

const baseUser: AuthUser = {
  userId: 'user_001',
  role: UserRole.USER,
};

describe('LivestreamService', () => {
  const prismaMock: any = {
    liveRoom: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    liveParticipant: {
      findUnique: jest.fn(),
      groupBy: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    reservation: {
      findFirst: jest.fn(),
    },
    liveTimelineEvent: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
      callback(prismaMock as unknown as never),
    ),
  };

  const configMock = {
    get: jest.fn((key: string) => {
      if (key === 'AGORA_APP_ID') return 'test-app-id';
      if (key === 'AGORA_APP_CERTIFICATE') return 'test-app-cert';
      if (key === 'AGORA_RTC_TOKEN_TTL_SECONDS') return '1200';
      return undefined;
    }),
  };

  const eventEmitterMock = {
    emit: jest.fn(),
  };

  const realtimeGatewayMock = {
    toRoom: jest.fn(),
    getViewerCountSnapshot: jest.fn(() => new Map<string, number>()),
  };

  let service: LivestreamService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LivestreamService(
      prismaMock as never,
      configMock as never,
      eventEmitterMock as never,
      realtimeGatewayMock as never,
    );
  });

  it('throws 422 when role is invalid', async () => {
    await expect(
      service.issueRtcToken(
        {
          roomId: 'room_001',
          userId: 'user_001',
          role: 'invalid-role',
        },
        baseUser,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 403 when request user_id mismatches auth user', async () => {
    await expect(
      service.issueRtcToken(
        {
          roomId: 'room_001',
          userId: 'user_002',
          role: 'audience',
        },
        baseUser,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws 404 when room is not found', async () => {
    prismaMock.liveRoom.findUnique.mockResolvedValue(null);

    await expect(
      service.issueRtcToken(
        {
          roomId: 'room_not_exist',
          userId: 'user_001',
          role: 'audience',
        },
        baseUser,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('issues token from direct channel contract', async () => {
    const response = await service.issueRtcToken(
      {
        channelName: 'event-live-001',
        uid: 1001,
        role: 'host',
      },
      baseUser,
    );

    expect(response.data.token).toBeDefined();
    expect(response.data.app_id).toBe('test-app-id');
    expect(response.data.appId).toBe('test-app-id');
    expect(response.data.channel_name).toBe('event-live-001');
    expect(response.data.channelName).toBe('event-live-001');
    expect(response.data.uid).toBe(1001);
  });

  it('rejects unsupported role in direct channel contract', async () => {
    await expect(
      service.issueRtcToken(
        {
          channelName: 'event-live-001',
          uid: 1001,
          role: 'cohost',
        },
        baseUser,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
