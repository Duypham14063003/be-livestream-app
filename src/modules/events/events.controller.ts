import { Controller, Get, Param, Query } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  getEvents(@Query('search') search?: string) {
    return this.eventsService.getEvents(search);
  }

  @Get(':id')
  getEventDetail(@Param('id') id: string) {
    return this.eventsService.getEventDetail(id);
  }

  @Get(':id/seats')
  getEventSeats(@Param('id') id: string) {
    return this.eventsService.getEventSeats(id);
  }
}
