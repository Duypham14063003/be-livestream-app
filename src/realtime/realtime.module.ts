import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeEventsListener } from './realtime-events.listener';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET') ?? 'access-secret',
      }),
    }),
  ],
  providers: [RealtimeGateway, RealtimeEventsListener],
  exports: [RealtimeGateway, JwtModule],
})
export class RealtimeModule {}
