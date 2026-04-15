import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Observable } from 'rxjs';
import { Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const token = this.extractToken(client);

    if (!token) {
      throw new WsException('Unauthorized: missing token');
    }

    try {
      const payload = this.jwtService.verify(token);
      client.data.user = {
        userId: payload.sub,
        role: payload.role,
      };
      return true;
    } catch {
      throw new WsException('Unauthorized: invalid token');
    }
  }

  private extractToken(client: Socket): string | null {
    const authHeader =
      client.handshake.headers.authorization ??
      client.handshake.auth?.token;
    if (!authHeader) return null;

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) return null;
    return token;
  }
}