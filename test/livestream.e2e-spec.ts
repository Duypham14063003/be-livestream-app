import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { LivestreamController } from '../src/modules/livestream/livestream.controller';
import { LivestreamService } from '../src/modules/livestream/livestream.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';

const authUser = {
  userId: 'user_001',
  role: UserRole.USER,
};

describe('LivestreamController (integration)', () => {
  let controller: LivestreamController;

  const livestreamServiceMock = {
    getRooms: jest.fn().mockResolvedValue({
      data: [
        {
          id: 'room_001',
          event_id: 'evt_001',
          title: 'Demo Room',
          agora_channel: 'room_001',
          status: 'live',
          viewer_count: 12,
          host_id: 'host_001',
          started_at: new Date().toISOString(),
        },
      ],
    }),
    issueRtcToken: jest.fn().mockResolvedValue({
      data: {
        app_id: 'app-id',
        channel_name: 'room_001',
        token: '007eJx_mock',
        uid: 10001,
        expire_at: new Date().toISOString(),
      },
    }),
    muteParticipant: jest.fn().mockResolvedValue({ data: { success: true } }),
    removeParticipant: jest.fn().mockResolvedValue({ data: { success: true } }),
    promoteParticipant: jest.fn().mockResolvedValue({ data: { success: true } }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            ttl: 60_000,
            limit: 100,
          },
        ]),
      ],
      controllers: [LivestreamController],
      providers: [
        { provide: LivestreamService, useValue: livestreamServiceMock },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: () => true },
        },
      ],
    }).compile();

    controller = moduleFixture.get(LivestreamController);
  });

  it('getRooms should return accessible rooms', async () => {
    const response = await controller.getRooms(authUser);
    expect(response.data).toHaveLength(1);
    expect(response.data[0].id).toBe('room_001');
  });

  it('issueToken should return rtc token payload', async () => {
    const response = await controller.issueToken(
      {
        room_id: 'room_001',
        user_id: 'user_001',
        role: 'audience',
      },
      authUser,
    );

    expect(response.data.channel_name).toBe('room_001');
    expect(response.data.token).toContain('007');
  });
});
