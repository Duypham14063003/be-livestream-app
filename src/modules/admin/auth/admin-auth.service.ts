import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { isAccountDeleted, isAccountSuspended } from '../../auth/account-state';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminRefreshDto } from './dto/admin-refresh.dto';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: AdminLoginDto) {
    const admin = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (
      !admin ||
      admin.role !== UserRole.ADMIN ||
      !admin.password ||
      isAccountDeleted(admin) ||
      isAccountSuspended(admin)
    ) {
      throw new UnauthorizedException('Invalid admin credentials.');
    }

    const isValidPassword = await bcrypt.compare(dto.password, admin.password);

    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid admin credentials.');
    }

    const tokens = await this.signTokens(admin.id, admin.role);

    return {
      admin: this.toAdminProfile(admin),
      ...tokens,
    };
  }

  async refresh(dto: AdminRefreshDto) {
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; role: UserRole }>(
        dto.refreshToken,
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        },
      );

      if (payload.role !== UserRole.ADMIN) {
        throw new UnauthorizedException('Invalid admin refresh token.');
      }

      const admin = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (
        !admin ||
        admin.role !== UserRole.ADMIN ||
        isAccountDeleted(admin) ||
        isAccountSuspended(admin)
      ) {
        throw new UnauthorizedException('Admin account was not found.');
      }

      return this.signTokens(admin.id, admin.role);
    } catch {
      throw new UnauthorizedException('Invalid admin refresh token.');
    }
  }

  async getProfile(userId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new UnauthorizedException('Admin account was not found.');
    }

    return this.toAdminProfile(admin);
  }

  logout() {
    return {
      success: true,
      message: 'Signed out successfully.',
    };
  }

  private async signTokens(userId: string, role: UserRole) {
    const payload = {
      sub: userId,
      role,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as never,
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as never,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  private toAdminProfile(admin: User) {
    return {
      id: admin.id,
      email: admin.email ?? '',
      displayName: admin.displayName,
      role: admin.role,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    };
  }
}
