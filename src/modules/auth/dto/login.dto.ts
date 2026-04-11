import { IsEmail, IsOptional, IsPhoneNumber, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @IsString()
  @MinLength(4)
  otp!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}
