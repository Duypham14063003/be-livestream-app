import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReservationsService } from '../modules/reservations/reservations.service';

@Injectable()
export class ReservationExpiryJob {
  private readonly logger = new Logger(ReservationExpiryJob.name);

  constructor(private readonly reservationsService: ReservationsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredReservations() {
    const result = await this.reservationsService.expireStaleReservations();

    if (result.expiredCount > 0) {
      this.logger.log(
        `Expired ${result.expiredCount} reservations and released ${result.releasedSeats.length} seats`,
      );
    }
  }
}
