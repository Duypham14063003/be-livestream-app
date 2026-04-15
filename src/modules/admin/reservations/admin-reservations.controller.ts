import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { AuthUser } from "../../auth/interfaces/auth-user.interface";
import { AdminAccessGuard } from "../common/admin-access.guard";
import { AdminReservationsService } from "./admin-reservations.service";
import { AdminConfirmReservationDto } from "./dto/admin-confirm-reservation.dto";
import { AdminReservationsQueryDto } from "./dto/admin-reservations-query.dto";
import { AdminExpireReservationDto } from "./dto/admin-expire-reservation.dto";

@Controller("admin/reservations")
@UseGuards(JwtAuthGuard, AdminAccessGuard)
export class AdminReservationsController {
  constructor(
    private readonly adminReservationsService: AdminReservationsService,
  ) {}

  @Get()
  getReservations(@Query() query: AdminReservationsQueryDto) {
    return this.adminReservationsService.getReservations(query);
  }

  @Get(":id")
  getReservationDetail(@Param("id") reservationId: string) {
    return this.adminReservationsService.getReservationDetail(reservationId);
  }

  @Post(":id/confirm")
  confirmReservation(
    @Param("id") reservationId: string,
    @Body() dto: AdminConfirmReservationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminReservationsService.confirmReservation(
      reservationId,
      user.userId,
      dto,
    );
  }

  @Post(":id/expire")
  expireReservation(
    @Param("id") reservationId: string,
    @Body() dto: AdminExpireReservationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminReservationsService.expireReservation(
      reservationId,
      user.userId,
      dto,
    );
  }
}
