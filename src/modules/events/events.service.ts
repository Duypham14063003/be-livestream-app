import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  getEvents(search?: string) {
    return this.prisma.event.findMany({
      where: search
        ? {
            OR: [
              {
                title: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                description: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : undefined,
      orderBy: {
        startAt: 'asc',
      },
      include: {
        _count: {
          select: {
            seats: true,
          },
        },
      },
    });
  }

  async getEventDetail(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        liveRoom: true,
        _count: {
          select: {
            seats: true,
            reservations: true,
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException('Không tìm thấy sự kiện');
    }

    const seatStats = await this.prisma.seat.groupBy({
      by: ['status'],
      where: { eventId: id },
      _count: {
        _all: true,
      },
    });

    return {
      ...event,
      seatStats,
    };
  }

  async getEventSeats(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } });

    if (!event) {
      throw new NotFoundException('Không tìm thấy sự kiện');
    }

    return this.prisma.seat.findMany({
      where: {
        eventId: id,
      },
      orderBy: [{ zone: 'asc' }, { row: 'asc' }, { number: 'asc' }],
    });
  }
}
