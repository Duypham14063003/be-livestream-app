import { Injectable, NotFoundException } from "@nestjs/common";
import { PaymentProvider, Prisma, ReservationStatus } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { ReservationsService } from "../../reservations/reservations.service";
import {
  buildAdminListMeta,
  normalizeAdminListQuery,
  type NormalizedAdminListQuery,
} from "../common/admin-listing";
import { AdminConfirmReservationDto } from "./dto/admin-confirm-reservation.dto";
import { AdminReservationsQueryDto } from "./dto/admin-reservations-query.dto";
import { AdminExpireReservationDto } from "./dto/admin-expire-reservation.dto";

const RESERVATION_SORT_FIELDS = ["createdAt", "expiresAt", "status"] as const;

type ReservationSortField = (typeof RESERVATION_SORT_FIELDS)[number];

type ReservationRecord = Prisma.ReservationGetPayload<{
  include: {
    user: true;
    event: true;
    reservationSeats: {
      include: {
        seat: true;
      };
    };
    order: {
      include: {
        payment: true;
        tickets: true;
      };
    };
  };
}>;

@Injectable()
export class AdminReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservationsService: ReservationsService,
  ) {}

  async getReservations(query: AdminReservationsQueryDto) {
    const listing = normalizeAdminListQuery(query, {
      allowedSortBy: RESERVATION_SORT_FIELDS,
      defaultSortBy: "createdAt",
      defaultSortOrder: "desc",
    });
    const where: Prisma.ReservationWhereInput = {
      status:
        query.status && this.isReservationStatus(query.status)
          ? query.status
          : undefined,
      ...(query.search
        ? {
            OR: [
              {
                id: {
                  contains: query.search,
                },
              },
              {
                userId: {
                  contains: query.search,
                },
              },
              {
                eventId: {
                  contains: query.search,
                },
              },
              {
                user: {
                  displayName: {
                    contains: query.search,
                    mode: "insensitive",
                  },
                },
              },
              {
                user: {
                  email: {
                    contains: query.search,
                    mode: "insensitive",
                  },
                },
              },
              {
                event: {
                  title: {
                    contains: query.search,
                    mode: "insensitive",
                  },
                },
              },
              {
                order: {
                  id: {
                    contains: query.search,
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [reservations, total] = await Promise.all([
      this.prisma.reservation.findMany({
        where,
        orderBy: this.buildReservationsOrderBy(listing),
        skip: listing.skip,
        take: listing.take,
        include: {
          user: true,
          event: true,
          reservationSeats: {
            include: {
              seat: true,
            },
          },
          order: {
            include: {
              payment: true,
              tickets: true,
            },
          },
        },
      }),
      this.prisma.reservation.count({ where }),
    ]);

    return {
      data: reservations.map((reservation) => ({
        id: reservation.id,
        status: reservation.status,
        createdAt: reservation.createdAt.toISOString(),
        expiresAt: reservation.expiresAt.toISOString(),
        expiredByClock: reservation.expiresAt.getTime() <= Date.now(),
        eventTitle: reservation.event.title,
        userName:
          reservation.user.displayName ??
          reservation.user.email ??
          reservation.user.id,
        seatCount: reservation.reservationSeats.length,
        seatSummary: this.buildSeatSummary(reservation.reservationSeats),
        orderId: reservation.order?.id ?? null,
        orderStatus: reservation.order?.status ?? null,
        paymentStatus: reservation.order?.payment?.status ?? null,
      })),
      meta: buildAdminListMeta(total, listing),
    };
  }

  async getReservationDetail(reservationId: string) {
    const reservation = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        user: true,
        event: true,
        reservationSeats: {
          include: {
            seat: true,
          },
        },
        order: {
          include: {
            payment: true,
            tickets: true,
          },
        },
      },
    });

    if (!reservation) {
      throw new NotFoundException("Reservation was not found.");
    }

    const controls = this.buildReservationControls(
      reservation.status,
      reservation.expiresAt,
    );
    const ticketBySeatId = new Map(
      (reservation.order?.tickets ?? []).map((ticket) => [ticket.seatId, ticket]),
    );

    return {
      reservation: {
        id: reservation.id,
        status: reservation.status,
        createdAt: reservation.createdAt.toISOString(),
        updatedAt: reservation.updatedAt.toISOString(),
        expiresAt: reservation.expiresAt.toISOString(),
        expiredByClock: controls.expiredByClock,
        user: {
          id: reservation.user.id,
          displayName: reservation.user.displayName,
          email: reservation.user.email,
        },
        event: {
          id: reservation.event.id,
          title: reservation.event.title,
          startAt: reservation.event.startAt.toISOString(),
        },
        order: reservation.order
          ? {
              id: reservation.order.id,
              status: reservation.order.status,
              amount: reservation.order.amount,
              currency: reservation.order.currency,
              createdAt: reservation.order.createdAt.toISOString(),
              payment: reservation.order.payment
                ? {
                    id: reservation.order.payment.id,
                    provider: reservation.order.payment.provider,
                    status: reservation.order.payment.status,
                    paidAt: reservation.order.payment.paidAt?.toISOString() ?? null,
                    providerRef: reservation.order.payment.providerRef,
                  }
                : null,
              tickets: reservation.order.tickets.map((ticket) => ({
                id: ticket.id,
                seatId: ticket.seatId,
                status: ticket.status,
                pdfUrl: ticket.pdfUrl,
              })),
            }
          : null,
        seats: reservation.reservationSeats.map((item) => ({
          id: item.seat.id,
          label: `${item.seat.zone}-${item.seat.row}-${item.seat.number}`,
          status: item.seat.status,
          price: item.price,
          ticketId: ticketBySeatId.get(item.seat.id)?.id ?? null,
          ticketStatus: ticketBySeatId.get(item.seat.id)?.status ?? null,
        })),
        controls: {
          canConfirm: controls.canConfirm,
          canExpire: controls.canExpire,
          confirmMessage: controls.confirmMessage,
          expireMessage: controls.expireMessage,
        },
      },
    };
  }

  confirmReservation(
    reservationId: string,
    adminUserId: string,
    dto: AdminConfirmReservationDto,
  ) {
    const provider = dto.provider ?? PaymentProvider.STRIPE;
    const providerRef =
      dto.providerRef?.trim() || `admin-confirm:${adminUserId}`;

    return this.reservationsService.confirmReservation(reservationId, {
      provider,
      providerRef,
      idempotencyKey: `admin_confirm_${reservationId}`,
    });
  }

  expireReservation(
    reservationId: string,
    adminUserId: string,
    dto: AdminExpireReservationDto,
  ) {
    return this.reservationsService.expireReservation(reservationId, {
      reason: dto.reason?.trim() || `admin_manual_expire:${adminUserId}`,
    });
  }

  private isReservationStatus(status: string): status is ReservationStatus {
    return Object.values(ReservationStatus).includes(
      status as ReservationStatus,
    );
  }

  private buildReservationsOrderBy(
    query: NormalizedAdminListQuery<ReservationSortField>,
  ): Prisma.ReservationOrderByWithRelationInput[] {
    switch (query.sortBy) {
      case "expiresAt":
        return [
          { expiresAt: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      case "status":
        return [
          { status: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      default:
        return [{ createdAt: query.sortOrder }, { id: "desc" }];
    }
  }

  private buildSeatSummary(
    seats: ReservationRecord["reservationSeats"],
  ) {
    if (seats.length === 0) {
      return "No seats";
    }

    const labels = seats.map(
      (item) => `${item.seat.zone}-${item.seat.row}-${item.seat.number}`,
    );

    if (labels.length === 1) {
      return labels[0];
    }

    return `${labels[0]} +${labels.length - 1} more`;
  }

  private buildReservationControls(
    status: ReservationStatus,
    expiresAt: Date,
  ) {
    const expiredByClock = expiresAt.getTime() <= Date.now();
    const canConfirm = status === ReservationStatus.HELD && !expiredByClock;
    const canExpire = status === ReservationStatus.HELD;

    return {
      expiredByClock,
      canConfirm,
      canExpire,
      confirmMessage:
        status !== ReservationStatus.HELD
          ? "Only held reservations can be confirmed."
          : expiredByClock
            ? "Expired holds must be recreated before confirmation."
            : null,
      expireMessage:
        status !== ReservationStatus.HELD
          ? "Only held reservations can be expired."
          : null,
    };
  }
}
