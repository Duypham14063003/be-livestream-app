import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AdminAuthService } from '../src/modules/admin/auth/admin-auth.service';

describe('AdminAuthService', () => {
  const prismaMock: any = {
    user: {
      findUnique: jest.fn(),
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
      return undefined;
    }),
  };

  let service: AdminAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminAuthService(
      prismaMock as never,
      jwtServiceMock as never,
      configMock as never,
    );
  });

  it('rejects login for suspended admin accounts', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'admin_001',
      email: 'admin@example.com',
      displayName: 'Admin Demo',
      password: 'hashed-password',
      role: UserRole.ADMIN,
      suspendedAt: new Date('2026-04-15T03:45:00.000Z'),
      deletedAt: null,
    });

    await expect(
      service.login({
        email: 'admin@example.com',
        password: 'secret',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects refresh for deleted admin accounts', async () => {
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: 'admin_001',
      role: UserRole.ADMIN,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'admin_001',
      email: 'admin@example.com',
      displayName: 'Admin Demo',
      password: 'hashed-password',
      role: UserRole.ADMIN,
      suspendedAt: null,
      deletedAt: new Date('2026-04-15T03:45:00.000Z'),
    });

    await expect(
      service.refresh({
        refreshToken: 'refresh-token',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
