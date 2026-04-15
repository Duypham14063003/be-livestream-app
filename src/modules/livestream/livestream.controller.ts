import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { SendGiftDto } from './dto/send-gift.dto';
import { ToggleCommentsDto } from './dto/toggle-comments.dto';
import { EndRoomDto } from './dto/end-room.dto';
import { IssueLivestreamTokenDto } from './dto/issue-token.dto';
import { ModerationMuteDto } from './dto/moderation-mute.dto';
import { ModerationPromoteDto } from './dto/moderation-promote.dto';
import { ModerationRemoveDto } from './dto/moderation-remove.dto';
import { StartRoomDto } from './dto/start-room.dto';
import { LivestreamService } from './livestream.service';

@ApiTags('livestream')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('livestream')
export class LivestreamController {
  constructor(
    private readonly livestreamService: LivestreamService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  // ─── Room Management ────────────────────────────────────────────────

  @Post('rooms')
  createRoom(@Body() dto: CreateRoomDto, @CurrentUser() user: AuthUser) {
    return this.livestreamService.createRoom(dto, user);
  }

  @Get('rooms')
  getRooms() {
    return this.livestreamService.getRooms();
  }

  @Post('rooms/:id/start')
  startRoom(
    @Param('id') id: string,
    @Body() dto: StartRoomDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.livestreamService.startRoom(id, dto, user);
  }

  @Post('rooms/:id/end')
  endRoom(
    @Param('id') id: string,
    @Body() dto: EndRoomDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.livestreamService.endRoom(id, dto, user);
  }

  // ─── Comments ──────────────────────────────────────────────────────

  @Post('rooms/:roomId/comments')
  createComment(
    @Param('roomId') roomId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.livestreamService.createComment(roomId, dto, user);
  }

  @Get('rooms/:roomId/comments')
  getComments(
    @Param('roomId') roomId: string,
    @Query('limit') limit?: string,
  ) {
    return this.livestreamService.getComments(roomId, limit);
  }

  @Post('rooms/:roomId/comments/toggle')
  toggleComments(
    @Param('roomId') roomId: string,
    @Body() dto: ToggleCommentsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.livestreamService.toggleComments(roomId, dto, user);
  }

  // ─── Gifts ─────────────────────────────────────────────────────────

  @Post('rooms/:roomId/gifts')
  sendGift(
    @Param('roomId') roomId: string,
    @Body() dto: SendGiftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.livestreamService.sendGift(roomId, dto, user);
  }

  @Get('rooms/:roomId/gifts')
  getGifts(
    @Param('roomId') roomId: string,
    @Query('limit') limit?: string,
  ) {
    return this.livestreamService.getGifts(roomId, limit);
  }

  // ─── Token & Moderation ─────────────────────────────────────────────

  @Post('token')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  issueToken(
    @Body() dto: IssueLivestreamTokenDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.livestreamService.issueRtcToken(dto, user);
  }

  @Post('moderation/mute')
  mute(@Body() dto: ModerationMuteDto, @CurrentUser() user: AuthUser) {
    return this.livestreamService.muteParticipant(dto, user);
  }

  @Post('moderation/remove')
  remove(@Body() dto: ModerationRemoveDto, @CurrentUser() user: AuthUser) {
    return this.livestreamService.removeParticipant(dto, user);
  }

  @Post('moderation/promote')
  promote(@Body() dto: ModerationPromoteDto, @CurrentUser() user: AuthUser) {
    return this.livestreamService.promoteParticipant(dto, user);
  }
}
