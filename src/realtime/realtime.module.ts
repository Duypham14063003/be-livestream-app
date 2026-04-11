import { Module } from '@nestjs/common';
import { RealtimeEventsListener } from './realtime-events.listener';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  providers: [RealtimeGateway, RealtimeEventsListener],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
