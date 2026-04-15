import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TicketStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

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
        createdAt: "desc",
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
      throw new NotFoundException("Ticket khong ton tai");
    }

    return ticket;
  }

  async getTicketPdf(id: string) {
    const document = await this.resolveTicketDocument(id);

    return {
      ticketId: document.ticketId,
      pdfUrl: document.documentUrl,
    };
  }

  async resolveTicketDocument(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        pdfUrl: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException("Ticket khong ton tai");
    }

    const hasStoredDocument = Boolean(ticket.pdfUrl);
    const documentUrl =
      ticket.pdfUrl ?? `https://cdn.example.com/tickets/${ticket.id}.pdf`;

    return {
      ticketId: ticket.id,
      documentUrl,
      source: hasStoredDocument ? "stored_pdf" : "canonical_fallback",
      hasStoredDocument,
      fileName: `ticket-${ticket.id}.pdf`,
    };
  }
}
