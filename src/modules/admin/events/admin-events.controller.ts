import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { AuthUser } from "../../auth/interfaces/auth-user.interface";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { AdminAccessGuard } from "../common/admin-access.guard";
import { AdminEventsQueryDto } from "./dto/admin-events-query.dto";
import { CreateEventDto } from "./dto/create-event.dto";
import { UpdateEventDto } from "./dto/update-event.dto";
import { CreateSeatDto } from "./dto/create-seat.dto";
import { LinkRoomDto } from "./dto/link-room.dto";
import { AdminEventsService } from "./admin-events.service";

@Controller("admin/events")
@UseGuards(JwtAuthGuard, AdminAccessGuard)
export class AdminEventsController {
  constructor(private readonly adminEventsService: AdminEventsService) {}

  @Get()
  getEvents(@Query() query: AdminEventsQueryDto) {
    return this.adminEventsService.getEvents(query);
  }

  @Get(":id")
  getEventDetail(@Param("id") id: string) {
    return this.adminEventsService.getEventDetail(id);
  }

  @Get(":id/seats")
  getEventSeats(
    @Param("id") id: string,
    @Query("status") status?: string,
    @Query("zone") zone?: string,
  ) {
    return this.adminEventsService.getEventSeats(id, status, zone);
  }

  @Post()
  createEvent(@Body() dto: CreateEventDto, @CurrentUser() user: AuthUser) {
    return this.adminEventsService.createEvent(dto, user);
  }

  @Put(":id")
  updateEvent(
    @Param("id") id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminEventsService.updateEvent(id, dto, user);
  }

  @Delete(":id")
  deleteEvent(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.adminEventsService.softDeleteEvent(id, user);
  }

  @Delete(":eventId/seats/:seatId")
  deleteSeat(
    @Param("eventId") eventId: string,
    @Param("seatId") seatId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminEventsService.deleteSeat(eventId, seatId, user);
  }

  @Post(":eventId/seats")
  createSeat(
    @Param("eventId") eventId: string,
    @Body() dto: CreateSeatDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminEventsService.createSeat(eventId, dto, user);
  }

  @Put(":eventId/link-room")
  linkRoom(
    @Param("eventId") eventId: string,
    @Body() dto: LinkRoomDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminEventsService.linkRoom(eventId, dto, user);
  }
}
