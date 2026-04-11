import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { CreateRoomDto } from './dto/create-room.dto';
import { IssueLivestreamTokenDto } from './dto/issue-token.dto';
import { ModerationMuteDto } from './dto/moderation-mute.dto';
import { ModerationPromoteDto } from './dto/moderation-promote.dto';
import { ModerationRemoveDto } from './dto/moderation-remove.dto';
import { LivestreamService } from './livestream.service';

@ApiTags('livestream')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('livestream')
export class LivestreamController {
  constructor(private readonly livestreamService: LivestreamService) {}

  @Post('rooms')
  createRoom(@Body() dto: CreateRoomDto, @CurrentUser() user: AuthUser) {
    return this.livestreamService.createRoom(dto, user);
  }

  @Get('rooms')
  getRooms(@CurrentUser() user: AuthUser) {
    return this.livestreamService.getRooms(user);
  }

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
