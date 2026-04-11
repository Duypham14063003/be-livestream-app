import { Controller, Get, Param, Query } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  getTickets(@Query('userId') userId?: string, @Query('status') status?: TicketStatus) {
    return this.ticketsService.getTickets(userId, status);
  }

  @Get(':id')
  getTicketById(@Param('id') id: string) {
    return this.ticketsService.getTicketById(id);
  }

  @Get(':id/pdf')
  getTicketPdf(@Param('id') id: string) {
    return this.ticketsService.getTicketPdf(id);
  }
}
