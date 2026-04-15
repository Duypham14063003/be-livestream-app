import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from '../src/modules/auth/auth.service';

describe('AuthService', () => {
  const prismaMock: any = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const jwtServiceMock = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const configMock = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return 'access-secret';
      if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
      if (key === 'JWT_ACCESS_EXPIRES_IN') return '15m';
      if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
      if (key === 'BCRYPT_SALT_ROUNDS') return '4';
      return undefined;
    }),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      prismaMock as never,
      jwtServiceMock as never,
      configMock as never,
    );
  });

  it('rejects login for suspended users', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'user_001',
      role: UserRole.USER,
      password: null,
      suspendedAt: new Date('2026-04-15T03:45:00.000Z'),
      deletedAt: null,
    });

    await expect(
      service.login({
        email: 'user@example.com',
        otp: '1234',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects refresh for deleted users', async () => {
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: 'user_001',
      role: UserRole.USER,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user_001',
      role: UserRole.USER,
      suspendedAt: null,
      deletedAt: new Date('2026-04-15T03:45:00.000Z'),
    });

    await expect(
      service.refresh({
        userId: 'user_001',
        refreshToken: 'refresh-token',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
