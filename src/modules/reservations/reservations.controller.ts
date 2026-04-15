import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { ConfirmReservationDto } from './dto/confirm-reservation.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ExpireReservationDto } from './dto/expire-reservation.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('reservations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  createHold(@Body() dto: CreateReservationDto, @CurrentUser() user: AuthUser) {
    return this.reservationsService.createHold(dto, user);
  }

  @Post(':id/confirm')
  confirmReservation(
    @Param('id') id: string,
    @Body() dto: ConfirmReservationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reservationsService.confirmReservation(id, dto, user);
  }

  @Post(':id/expire')
  expireReservation(@Param('id') id: string, @Body() dto: ExpireReservationDto) {
    return this.reservationsService.expireReservation(id, dto);
  }

  @Get(':id')
  getReservation(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reservationsService.getReservation(id, user);
  }
}
