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
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { AuthUser } from "../../auth/interfaces/auth-user.interface";
import { AdminAccessGuard } from "../common/admin-access.guard";
import { AdminRoomListQueryDto } from "./dto/admin-room-list-query.dto";
import { AdminModerationMuteDto } from "./dto/admin-moderation-mute.dto";
import { AdminModerationPromoteDto } from "./dto/admin-moderation-promote.dto";
import { AdminModerationRemoveDto } from "./dto/admin-moderation-remove.dto";
import { AdminLivestreamService } from "./admin-livestream.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";
import { StartRoomDto } from "./dto/start-room.dto";
import { StopRoomDto } from "./dto/stop-room.dto";
import { CreateFilterDto, UpdateFilterDto } from "./dto/moderation-filter.dto";
import { UpdateChatConfigDto } from "./dto/chat-config.dto";
import { TimeoutUserDto } from "./dto/chat-timeout.dto";

@Controller("admin/livestream")
@UseGuards(JwtAuthGuard, AdminAccessGuard)
export class AdminLivestreamController {
  constructor(
    private readonly adminLivestreamService: AdminLivestreamService,
  ) {}

  // ─── Room Lifecycle CRUD ────────────────────────────────────────

  @Post("rooms")
  createRoom(
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.createRoom(dto, user);
  }

  @Get("rooms")
  getRooms(@Query() query: AdminRoomListQueryDto) {
    return this.adminLivestreamService.getRooms(query);
  }

  @Put("rooms/:id")
  updateRoom(
    @Param("id") id: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.updateRoom(id, dto, user);
  }

  @Delete("rooms/:id")
  deleteRoom(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.deleteRoom(id, user);
  }

  @Post("rooms/:id/start")
  startRoom(
    @Param("id") id: string,
    @Body() _dto: StartRoomDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.startRoom(id, user);
  }

  @Post("rooms/:id/stop")
  stopRoom(
    @Param("id") id: string,
    @Body() _dto: StopRoomDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.stopRoom(id, user);
  }

  @Get("rooms/:id")
  getRoomDetail(@Param("id") id: string) {
    return this.adminLivestreamService.getRoomDetail(id);
  }

  @Get("rooms/:id/participants")
  getRoomParticipants(@Param("id") id: string) {
    return this.adminLivestreamService.getRoomParticipants(id);
  }

  @Get("rooms/:id/timeline")
  getRoomTimeline(@Param("id") id: string) {
    return this.adminLivestreamService.getRoomTimeline(id);
  }

  @Post("rooms/:roomId/participants/:targetUserId/mute")
  muteParticipant(
    @Param("roomId") roomId: string,
    @Param("targetUserId") targetUserId: string,
    @Body() dto: AdminModerationMuteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.muteParticipant(
      roomId,
      targetUserId,
      dto,
      user,
    );
  }

  @Post("rooms/:roomId/participants/:targetUserId/remove")
  removeParticipant(
    @Param("roomId") roomId: string,
    @Param("targetUserId") targetUserId: string,
    @Body() dto: AdminModerationRemoveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.removeParticipant(
      roomId,
      targetUserId,
      dto,
      user,
    );
  }

  @Post("rooms/:roomId/participants/:targetUserId/promote")
  promoteParticipant(
    @Param("roomId") roomId: string,
    @Param("targetUserId") targetUserId: string,
    @Body() dto: AdminModerationPromoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.promoteParticipant(
      roomId,
      targetUserId,
      dto,
      user,
    );
  }

  // ─── Moderation Filters ──────────────────────────────────────────────

  @Get("moderation/filters")
  getFilters(@Query("roomId") roomId: string) {
    return this.adminLivestreamService.getFilters(roomId);
  }

  @Post("moderation/filters")
  createFilter(
    @Body() dto: CreateFilterDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.createFilter(dto, user);
  }

  @Put("moderation/filters/:filterId")
  updateFilter(
    @Param("filterId") filterId: string,
    @Body() dto: UpdateFilterDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.updateFilter(filterId, dto, user);
  }

  @Delete("moderation/filters/:filterId")
  deleteFilter(
    @Param("filterId") filterId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.deleteFilter(filterId, user);
  }

  // ─── Chat Config ──────────────────────────────────────────────────────

  @Get("rooms/:id/chat-config")
  getChatConfig(@Param("id") roomId: string) {
    return this.adminLivestreamService.getChatConfig(roomId);
  }

  @Put("rooms/:id/chat-config")
  updateChatConfig(
    @Param("id") roomId: string,
    @Body() dto: UpdateChatConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.updateChatConfig(roomId, dto, user);
  }

  @Post("rooms/:id/chat/timeout")
  timeoutUser(
    @Param("id") roomId: string,
    @Body() dto: TimeoutUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminLivestreamService.timeoutUser(roomId, dto, user);
  }
}
