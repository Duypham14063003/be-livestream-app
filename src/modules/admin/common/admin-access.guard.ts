import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../../auth/interfaces/auth-user.interface';

@Injectable()
export class AdminAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication is required.');
    }

    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access is required.');
    }

    return true;
  }
}
