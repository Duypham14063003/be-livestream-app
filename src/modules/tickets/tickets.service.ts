import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  getTickets(userId?: string, status?: TicketStatus) {
    const where: Prisma.TicketWhereInput = {
      status,
      order: userId
        ? {
            userId,
          }
        : undefined,
    };

    return this.prisma.ticket.findMany({
      where,
      include: {
        seat: true,
        order: {
          include: {
            reservation: {
              include: {
                event: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getTicketById(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        seat: true,
        order: {
          include: {
            reservation: {
              include: {
                event: true,
              },
            },
            payment: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket không tồn tại');
    }

    return ticket;
  }

  async getTicketPdf(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        pdfUrl: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket không tồn tại');
    }

    return {
      ticketId: ticket.id,
      pdfUrl: ticket.pdfUrl ?? `https://cdn.example.com/tickets/${ticket.id}.pdf`,
    };
  }
}
