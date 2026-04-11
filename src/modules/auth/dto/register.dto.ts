import { IsEmail, IsOptional, IsPhoneNumber, IsString, MinLength } from 'class-validator';

/**
 * DTO cho endpoint Đăng ký tài khoản (POST /auth/register)
 *
 * Mobile app sẽ gọi endpoint này trước khi login.
 * Sau khi đăng ký thành công, app nên tự động gọi login
 * để lấy accessToken + refreshToken.
 *
 * Hoặc: app có thể chỉ dùng mỗi register và server trả về luôn tokens.
 * Quyết định thiết kế: TRẢ VỀ LUÔN TOKENS để tiết kiệm 1 round-trip.
 */
export class RegisterDto {
  /** Email của user. Bắt buộc nếu không cung cấp phone */
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Số điện thoại theo format quốc tế (e.g. +84912345678). Bắt buộc nếu không cung cấp email */
  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  /** Mật khẩu, tối thiểu 8 ký tự */
  @IsString()
  @MinLength(8)
  password!: string;

  /** Tên hiển thị của user (optional) */
  @IsOptional()
  @IsString()
  displayName?: string;

  /** Device ID để ghi nhận thiết bị đáng tin cậy (optional) */
  @IsOptional()
  @IsString()
  deviceId?: string;
}
