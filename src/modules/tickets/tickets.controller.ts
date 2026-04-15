import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TicketStatus } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { TicketsService } from './tickets.service';

@ApiTags('tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  getTickets(@CurrentUser() user: AuthUser, @Query('status') status?: TicketStatus) {
    return this.ticketsService.getTickets(user.userId, status);
  }

  @Get(':id')
  getTicketById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.getTicketById(id, user.userId);
  }

  @Get(':id/pdf')
  getTicketPdf(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.ticketsService.getTicketPdf(id, user.userId);
  }
}
