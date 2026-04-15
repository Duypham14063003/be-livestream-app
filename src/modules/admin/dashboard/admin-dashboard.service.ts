import { Injectable } from '@nestjs/common';
import {
  LiveParticipantRole,
  LiveRoomStatus,
  PaymentStatus,
  ReservationStatus,
  SeatStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const nextThirtyMinutes = new Date(now.getTime() + 30 * 60 * 1000);

    const [
      liveRoomsNow,
      currentViewers,
      upcomingEvents,
      ticketsSoldToday,
      expiringReservations,
      failedPayments,
      pendingRefunds,
      todayPayments,
      recentPayments,
      seatGroups,
      roomGroups,
      recentEvents,
      recentOrders,
      recentTickets,
      alertReservations,
      alertFailedPayments,
      alertRefunds,
    ] = await Promise.all([
      this.prisma.liveRoom.count({
        where: {
          status: LiveRoomStatus.LIVE,
        },
      }),
      this.prisma.liveParticipant.count({
        where: {
          leftAt: null,
          role: {
            in: [LiveParticipantRole.HOST, LiveParticipantRole.CO_HOST, LiveParticipantRole.AUDIENCE],
          },
          room: {
            status: LiveRoomStatus.LIVE,
          },
        },
      }),
      this.prisma.event.count({
        where: {
          startAt: {
            gte: now,
          },
        },
      }),
      this.prisma.ticket.count({
        where: {
          createdAt: {
            gte: startOfToday,
          },
        },
      }),
      this.prisma.reservation.count({
        where: {
          status: ReservationStatus.HELD,
          expiresAt: {
            gte: now,
            lte: nextThirtyMinutes,
          },
        },
      }),
      this.prisma.payment.count({
        where: {
          status: PaymentStatus.FAILED,
        },
      }),
      this.prisma.refund.count({
        where: {
          status: 'PENDING',
        },
      }),
      this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PAID,
          paidAt: {
            gte: startOfToday,
          },
        },
        include: {
          order: true,
        },
      }),
      this.prisma.payment.findMany({
        where: {
          status: PaymentStatus.PAID,
          paidAt: {
            gte: sevenDaysAgo,
          },
        },
        include: {
          order: true,
        },
        orderBy: {
          paidAt: 'asc',
        },
      }),
      this.prisma.seat.groupBy({
        by: ['status'],
        _count: {
          _all: true,
        },
      }),
      this.prisma.liveRoom.groupBy({
        by: ['status'],
        _count: {
          _all: true,
        },
      }),
      this.prisma.event.findMany({
        take: 5,
        orderBy: {
          startAt: 'asc',
        },
      }),
      this.prisma.order.findMany({
        take: 5,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          user: true,
          payment: true,
          reservation: {
            include: {
              event: true,
            },
          },
        },
      }),
      this.prisma.ticket.findMany({
        take: 5,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          seat: true,
          order: {
            include: {
              user: true,
              reservation: {
                include: {
                  event: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.reservation.findMany({
        take: 2,
        where: {
          status: ReservationStatus.HELD,
          expiresAt: {
            gte: now,
            lte: nextThirtyMinutes,
          },
        },
        orderBy: {
          expiresAt: 'asc',
        },
        include: {
          event: true,
        },
      }),
      this.prisma.payment.findMany({
        take: 2,
        where: {
          status: PaymentStatus.FAILED,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        include: {
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
      }),
      this.prisma.refund.findMany({
        take: 2,
        where: {
          status: 'PENDING',
        },
        orderBy: {
          updatedAt: 'desc',
        },
        include: {
          payment: {
            include: {
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
          },
        },
      }),
    ]);

    const revenueToday = todayPayments.reduce((sum, payment) => sum + payment.order.amount, 0);
    const revenueTrend = this.buildRevenueTrend(sevenDaysAgo, recentPayments);

    return {
      summary: {
        liveRoomsNow,
        currentViewers,
        upcomingEvents,
        ticketsSoldToday,
        revenueToday,
        expiringReservations,
        failedPayments,
        pendingRefunds,
      },
      revenueTrend,
      seatStatusBreakdown: this.ensureBreakdown(
        ['AVAILABLE', 'HELD', 'BOOKED', 'CHECKED_IN'],
        seatGroups.map((item) => ({ label: item.status, value: item._count._all })),
      ),
      liveRoomStatusBreakdown: this.ensureBreakdown(
        ['SCHEDULED', 'LIVE', 'ENDED'],
        roomGroups.map((item) => ({ label: item.status, value: item._count._all })),
      ),
      alerts: [
        ...alertReservations.map((reservation) => ({
          id: `reservation-${reservation.id}`,
          title: 'Reservation hold is expiring soon',
          description: `${reservation.event.title} will release seats at ${reservation.expiresAt.toISOString()}.`,
          link: `/events/${reservation.eventId}/seats`,
        })),
        ...alertFailedPayments.map((payment) => ({
          id: `payment-${payment.id}`,
          title: 'Payment failed',
          description: `${payment.order.reservation.event.title} has a failed payment that needs review.`,
          link: `/orders/${payment.orderId}`,
        })),
        ...alertRefunds.map((refund) => ({
          id: `refund-${refund.id}`,
          title: 'Refund is pending',
          description: `${refund.payment.order.reservation.event.title} still has a refund waiting for resolution.`,
          link: `/orders/${refund.payment.orderId}`,
        })),
      ],
      recentEvents: recentEvents.map((event) => ({
        id: event.id,
        title: event.title,
        status: this.deriveEventStatus(event.startAt, event.endAt, now),
        startAt: event.startAt.toISOString(),
        venueType: event.venueType,
      })),
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        eventTitle: order.reservation.event.title,
        userName: order.user.displayName ?? order.user.email ?? order.user.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        paymentStatus: order.payment?.status ?? null,
        createdAt: order.createdAt.toISOString(),
      })),
      recentTickets: recentTickets.map((ticket) => ({
        id: ticket.id,
        eventTitle: ticket.order.reservation.event.title,
        userName: ticket.order.user.displayName ?? ticket.order.user.email ?? ticket.order.user.id,
        seatLabel: `${ticket.seat.zone}-${ticket.seat.row}-${ticket.seat.number}`,
        status: ticket.status,
        createdAt: ticket.createdAt.toISOString(),
      })),
    };
  }

  private buildRevenueTrend(
    startDate: Date,
    payments: Array<{ paidAt: Date | null; order: { amount: number } }>,
  ) {
    const buckets = new Map<string, number>();

    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + dayOffset);
      const label = currentDate.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      });
      buckets.set(label, 0);
    }

    payments.forEach((payment) => {
      if (!payment.paidAt) {
        return;
      }

      const label = payment.paidAt.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      });
      buckets.set(label, (buckets.get(label) ?? 0) + payment.order.amount);
    });

    return [...buckets.entries()].map(([label, value]) => ({
      label,
      value,
    }));
  }

  private ensureBreakdown(labels: string[], current: Array<{ label: string; value: number }>) {
    const currentMap = new Map(current.map((item) => [item.label, item.value]));

    return labels.map((label) => ({
      label,
      value: currentMap.get(label) ?? 0,
    }));
  }

  private deriveEventStatus(startAt: Date, endAt: Date, now: Date) {
    if (startAt > now) {
      return 'UPCOMING';
    }

    if (endAt < now) {
      return 'ENDED';
    }

    return 'LIVE';
  }
}
