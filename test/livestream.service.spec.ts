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

  let service: LivestreamService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LivestreamService(
      prismaMock as never,
      configMock as never,
      eventEmitterMock as never,
    );
  });

  it('throws 422 when role is invalid', async () => {
    await expect(
      service.issueRtcToken(
        {
          room_id: 'room_001',
          user_id: 'user_001',
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
          room_id: 'room_001',
          user_id: 'user_002',
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
          room_id: 'room_not_exist',
          user_id: 'user_001',
          role: 'audience',
        },
        baseUser,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
