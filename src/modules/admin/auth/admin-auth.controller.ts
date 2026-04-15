import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthUser } from '../../auth/interfaces/auth-user.interface';
import { AdminAccessGuard } from '../common/admin-access.guard';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminRefreshDto } from './dto/admin-refresh.dto';
import { AdminAuthService } from './admin-auth.service';

@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuthService.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: AdminRefreshDto) {
    return this.adminAuthService.refresh(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, AdminAccessGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.adminAuthService.getProfile(user.userId);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard, AdminAccessGuard)
  logout() {
    return this.adminAuthService.logout();
  }
}
