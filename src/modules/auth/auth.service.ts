import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isAccountDeleted, isAccountSuspended } from './account-state';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email or phone is required.');
    }

    const existingEmail = dto.email
      ? await this.prisma.user.findUnique({ where: { email: dto.email } })
      : null;
    if (existingEmail) {
      throw new ConflictException('Email is already in use.');
    }

    const existingPhone = dto.phone
      ? await this.prisma.user.findUnique({ where: { phone: dto.phone } })
      : null;
    if (existingPhone) {
      throw new ConflictException('Phone number is already in use.');
    }

    const saltRounds = Number(
      this.configService.get<string>('BCRYPT_SALT_ROUNDS') ?? 10,
    );
    const hashedPassword = await bcrypt.hash(dto.password, saltRounds);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        password: hashedPassword,
        displayName: dto.displayName,
        trustedDevice: dto.deviceId,
        role: UserRole.USER,
      },
    });

    const tokens = await this.signTokens(user.id, user.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
        role: user.role,
        createdAt: user.createdAt,
      },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email or phone is required.');
    }

    const user = await this.prisma.user.findFirst({
      where: dto.email ? { email: dto.email } : { phone: dto.phone },
    });

    if (!user) {
      throw new BadRequestException('Account does not exist.');
    }

    if (isAccountDeleted(user)) {
      throw new UnauthorizedException('Account is not available.');
    }

    if (isAccountSuspended(user)) {
      throw new UnauthorizedException('Account is suspended.');
    }

    if (user.password) {
      const isPasswordValid = await bcrypt.compare(dto.otp, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Password or OTP is incorrect.');
      }
    } else if (dto.otp.length < 4) {
      throw new BadRequestException('OTP must contain at least 4 characters.');
    }

    const tokens = await this.signTokens(user.id, user.role);

    return {
      user,
      ...tokens,
    };
  }

  async refresh(dto: RefreshDto) {
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; role: UserRole }>(
        dto.refreshToken,
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        },
      );

      if (payload.sub !== dto.userId) {
        throw new UnauthorizedException('Refresh token is invalid.');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
      });

      if (!user || isAccountDeleted(user) || isAccountSuspended(user)) {
        throw new UnauthorizedException('User is not available.');
      }

      return this.signTokens(user.id, user.role);
    } catch {
      throw new UnauthorizedException('Refresh token is invalid.');
    }
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
}
