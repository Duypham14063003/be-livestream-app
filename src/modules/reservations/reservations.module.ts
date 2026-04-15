import { Module } from '@nestjs/common';
import { SystemSettingsModule } from '../system-settings/system-settings.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [SystemSettingsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
