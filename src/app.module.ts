import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { EventsModule } from './modules/events/events.module';
import { LivestreamModule } from './modules/livestream/livestream.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReservationExpiryJob } from './jobs/reservation-expiry.job';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    RealtimeModule,
    AuthModule,
    EventsModule,
    ReservationsModule,
    PaymentsModule,
    TicketsModule,
    LivestreamModule,
    WebhooksModule,
  ],
  providers: [ReservationExpiryJob],
})
export class AppModule {}
