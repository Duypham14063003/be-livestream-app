import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
      throw new BadRequestException('email hoặc phone là bắt buộc');
    }

    // Check unique email/phone
    const existingEmail = dto.email
      ? await this.prisma.user.findUnique({ where: { email: dto.email } })
      : null;
    if (existingEmail) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const existingPhone = dto.phone
      ? await this.prisma.user.findUnique({ where: { phone: dto.phone } })
      : null;
    if (existingPhone) {
      throw new ConflictException('Số điện thoại đã được sử dụng');
    }

    // Hash password
    const saltRounds = Number(this.configService.get<string>('BCRYPT_SALT_ROUNDS') ?? 10);
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
      throw new BadRequestException('email hoặc phone là bắt buộc');
    }

    // Find user by email or phone
    const user = await this.prisma.user.findFirst({
      where: dto.email ? { email: dto.email } : { phone: dto.phone },
    });

    if (!user) {
      throw new BadRequestException('Tài khoản không tồn tại. Vui lòng đăng ký trước.');
    }

    // If user has a password (registered via /auth/register), verify it
    if (user.password) {
      // OTP is used as password in mock OTP flow
      const isPasswordValid = await bcrypt.compare(dto.otp, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Mật khẩu / OTP không đúng');
      }
    } else {
      // Legacy: OTP-based login without password (mock OTP — any string >=4 chars works)
      if (dto.otp.length < 4) {
        throw new BadRequestException('OTP phải có ít nhất 4 ký tự');
      }
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
        throw new UnauthorizedException('refresh token không hợp lệ');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
      });

      if (!user) {
        throw new UnauthorizedException('user không tồn tại');
      }

      return this.signTokens(user.id, user.role);
    } catch {
      throw new UnauthorizedException('refresh token không hợp lệ');
    }
  }

  logout() {
    return {
      success: true,
      message: 'Đăng xuất thành công',
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
