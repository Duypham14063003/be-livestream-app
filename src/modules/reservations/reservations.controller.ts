import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ConfirmReservationDto } from './dto/confirm-reservation.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ExpireReservationDto } from './dto/expire-reservation.dto';
import { ReservationsService } from './reservations.service';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  createHold(@Body() dto: CreateReservationDto) {
    return this.reservationsService.createHold(dto);
  }

  @Post(':id/confirm')
  confirmReservation(
    @Param('id') id: string,
    @Body() dto: ConfirmReservationDto,
  ) {
    return this.reservationsService.confirmReservation(id, dto);
  }

  @Post(':id/expire')
  expireReservation(@Param('id') id: string, @Body() dto: ExpireReservationDto) {
    return this.reservationsService.expireReservation(id, dto);
  }

  @Get(':id')
  getReservation(@Param('id') id: string) {
    return this.reservationsService.getReservation(id);
  }
}
