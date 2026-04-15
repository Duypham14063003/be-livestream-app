import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  getTickets(userId: string, status?: TicketStatus) {
    return this.prisma.ticket.findMany({
      where: {
        status,
        order: {
          userId,
        },
      },
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

  async getTicketById(id: string, userId: string) {
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

    if (ticket.order.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền xem ticket này');
    }

    return ticket;
  }

  async getTicketPdf(id: string, userId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        order: true,
        select: {
          id: true,
          pdfUrl: true,
          order: {
            select: {
              userId: true,
            },
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket không tồn tại');
    }

    if (ticket.order.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền tải ticket này');
    }

    return {
      ticketId: ticket.id,
      pdfUrl: ticket.pdfUrl ?? `https://cdn.example.com/tickets/${ticket.id}.pdf`,
    };
  }
}
