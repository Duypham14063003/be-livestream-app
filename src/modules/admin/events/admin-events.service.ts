import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OrderStatus, Prisma, SeatStatus, VenueType } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  buildAdminListMeta,
  normalizeAdminListQuery,
  type NormalizedAdminListQuery,
} from "../common/admin-listing";
import { AdminEventsQueryDto } from "./dto/admin-events-query.dto";
import { CreateEventDto } from "./dto/create-event.dto";
import { UpdateEventDto } from "./dto/update-event.dto";
import { CreateSeatDto } from "./dto/create-seat.dto";
import { LinkRoomDto } from "./dto/link-room.dto";
import { AuthUser } from "../../auth/interfaces/auth-user.interface";

const EVENTS_SORT_FIELDS = ["startAt", "title", "createdAt"] as const;
type EventsSortField = (typeof EVENTS_SORT_FIELDS)[number];

@Injectable()
export class AdminEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async getEvents(query: AdminEventsQueryDto) {
    const now = new Date();
    const listing = normalizeAdminListQuery(query, {
      allowedSortBy: EVENTS_SORT_FIELDS,
      defaultSortBy: "startAt",
      defaultSortOrder: "asc",
    });
    const where: Prisma.EventWhereInput = {
      venueType:
        query.venueType && this.isVenueType(query.venueType)
          ? query.venueType
          : undefined,
      ...(query.search
        ? {
            OR: [
              {
                title: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                description: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
      ...(query.excludeCancelled !== false
        ? { cancelledAt: null }
        : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        orderBy: this.buildEventsOrderBy(listing),
        skip: listing.skip,
        take: listing.take,
        select: {
          id: true,
          title: true,
          venueType: true,
          startAt: true,
          endAt: true,
          cancelledAt: true,
          liveRoom: true,
          _count: {
            select: {
              reservations: true,
            },
          },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    const seatGroups =
      events.length === 0
        ? []
        : await this.prisma.seat.groupBy({
            by: ["eventId", "status"],
            where: {
              eventId: {
                in: events.map((event) => event.id),
              },
            },
            _count: {
              _all: true,
            },
          });

    return {
      data: events.map((event) => {
        const groupedSeats = seatGroups.filter(
          (item) => item.eventId === event.id,
        );
        const totalSeats = groupedSeats.reduce(
          (sum, item) => sum + item._count._all,
          0,
        );
        const heldSeats =
          groupedSeats.find((item) => item.status === SeatStatus.HELD)?._count
            ._all ?? 0;
        const bookedSeats =
          groupedSeats.find((item) => item.status === SeatStatus.BOOKED)?._count
            ._all ?? 0;

        return {
          id: event.id,
          title: event.title,
          venueType: event.venueType,
          startAt: event.startAt.toISOString(),
          endAt: event.endAt.toISOString(),
          status: this.deriveEventStatus(event.startAt, event.endAt, now, event.cancelledAt),
          cancelledAt: event.cancelledAt ? event.cancelledAt.toISOString() : null,
          totalSeats,
          heldSeats,
          bookedSeats,
          reservationsCount: event._count.reservations,
          liveRoomStatus: event.liveRoom?.status ?? null,
        };
      }),
      meta: buildAdminListMeta(total, listing),
    };
  }

  async getEventDetail(eventId: string) {
    const now = new Date();
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        description: true,
        venueType: true,
        startAt: true,
        endAt: true,
        cancelledAt: true,
        liveRoom: true,
      },
    });

    if (!event) {
      throw new NotFoundException("Event was not found.");
    }

    const [
      seatGroups,
      reservationsCount,
      ordersAggregate,
      ticketsCount,
      recentOrders,
      recentTickets,
    ] = await Promise.all([
      this.prisma.seat.groupBy({
        by: ["status"],
        where: {
          eventId,
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.reservation.count({
        where: {
          eventId,
        },
      }),
      this.prisma.order.aggregate({
        where: {
          reservation: {
            eventId,
          },
        },
        _count: {
          _all: true,
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.ticket.count({
        where: {
          order: {
            reservation: {
              eventId,
            },
          },
        },
      }),
      this.prisma.order.findMany({
        where: {
          reservation: {
            eventId,
          },
        },
        take: 5,
        orderBy: {
          createdAt: "desc",
        },
        include: {
          user: true,
        },
      }),
      this.prisma.ticket.findMany({
        where: {
          order: {
            reservation: {
              eventId,
            },
          },
        },
        take: 5,
        orderBy: {
          createdAt: "desc",
        },
        include: {
          seat: true,
          order: {
            include: {
              user: true,
            },
          },
        },
      }),
    ]);

    const availableSeats =
      seatGroups.find((item) => item.status === SeatStatus.AVAILABLE)?._count
        ._all ?? 0;
    const heldSeats =
      seatGroups.find((item) => item.status === SeatStatus.HELD)?._count._all ??
      0;
    const bookedSeats =
      seatGroups.find((item) => item.status === SeatStatus.BOOKED)?._count
        ._all ?? 0;
    const checkedInSeats =
      seatGroups.find((item) => item.status === SeatStatus.CHECKED_IN)?._count
        ._all ?? 0;

    return {
      event: {
        id: event.id,
        title: event.title,
        description: event.description,
        venueType: event.venueType,
        startAt: event.startAt.toISOString(),
        endAt: event.endAt.toISOString(),
        status: this.deriveEventStatus(event.startAt, event.endAt, now, event.cancelledAt),
        cancelledAt: event.cancelledAt ? event.cancelledAt.toISOString() : null,
        liveRoom: event.liveRoom
          ? {
              id: event.liveRoom.id,
              status: event.liveRoom.status,
              title: event.liveRoom.title,
              agoraChannel: event.liveRoom.agoraChannel,
            }
          : null,
      },
      stats: {
        totalSeats: availableSeats + heldSeats + bookedSeats + checkedInSeats,
        availableSeats,
        heldSeats,
        bookedSeats,
        checkedInSeats,
        reservationsCount,
        ordersCount: ordersAggregate._count._all,
        ticketsCount,
        revenue: ordersAggregate._sum.amount ?? 0,
      },
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        userName: order.user.displayName ?? order.user.email ?? order.user.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
      })),
      recentTickets: recentTickets.map((ticket) => ({
        id: ticket.id,
        userName:
          ticket.order.user.displayName ??
          ticket.order.user.email ??
          ticket.order.user.id,
        seatLabel: `${ticket.seat.zone}-${ticket.seat.row}-${ticket.seat.number}`,
        status: ticket.status,
        createdAt: ticket.createdAt.toISOString(),
      })),
    };
  }

  async getEventSeats(eventId: string, status?: string, zone?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        venueType: true,
      },
    });

    if (!event) {
      throw new NotFoundException("Event was not found.");
    }

    const where: Prisma.SeatWhereInput = {
      eventId,
      status: status && this.isSeatStatus(status) ? status : undefined,
      zone: zone || undefined,
    };

    const [seats, seatGroups, zones] = await Promise.all([
      this.prisma.seat.findMany({
        where,
        orderBy: [{ zone: "asc" }, { row: "asc" }, { number: "asc" }],
      }),
      this.prisma.seat.groupBy({
        by: ["status"],
        where: {
          eventId,
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.seat.findMany({
        where: {
          eventId,
        },
        distinct: ["zone"],
        select: {
          zone: true,
        },
        orderBy: {
          zone: "asc",
        },
      }),
    ]);

    return {
      event,
      summary: {
        total: seatGroups.reduce((sum, item) => sum + item._count._all, 0),
        available:
          seatGroups.find((item) => item.status === SeatStatus.AVAILABLE)
            ?._count._all ?? 0,
        held:
          seatGroups.find((item) => item.status === SeatStatus.HELD)?._count
            ._all ?? 0,
        booked:
          seatGroups.find((item) => item.status === SeatStatus.BOOKED)?._count
            ._all ?? 0,
        checkedIn:
          seatGroups.find((item) => item.status === SeatStatus.CHECKED_IN)
            ?._count._all ?? 0,
        zones: zones.map((item) => item.zone),
      },
      data: seats.map((seat) => ({
        id: seat.id,
        zone: seat.zone,
        row: seat.row,
        number: seat.number,
        price: seat.price,
        status: seat.status,
      })),
    };
  }

  async createEvent(dto: CreateEventDto, authUser: AuthUser) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);

    if (endAt <= startAt) {
      throw new BadRequestException("End date must be after start date.");
    }

    const event = await this.prisma.event.create({
      data: {
        title: dto.title,
        description: dto.description,
        venueType: dto.venueType,
        startAt,
        endAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_EVENT_CREATED",
        entityType: "event",
        entityId: event.id,
        payload: { adminId: authUser.userId, title: event.title },
      },
    });

    return { data: event };
  }

  async updateEvent(eventId: string, dto: UpdateEventDto, authUser: AuthUser) {
    const existing = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, cancelledAt: true },
    });

    if (!existing) {
      throw new NotFoundException("Event was not found.");
    }

    if (existing.cancelledAt) {
      throw new BadRequestException("This event is cancelled and cannot be edited.");
    }

    const updateData: Prisma.EventUpdateInput = { ...dto };
    if (dto.startAt) {
      (updateData as Record<string, unknown>).startAt = new Date(dto.startAt);
    }
    if (dto.endAt) {
      (updateData as Record<string, unknown>).endAt = new Date(dto.endAt);
    }

    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: updateData,
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_EVENT_UPDATED",
        entityType: "event",
        entityId: eventId,
        payload: { adminId: authUser.userId, changes: { ...dto } },
      },
    });

    return { data: event };
  }

  async softDeleteEvent(eventId: string, authUser: AuthUser) {
    const existing = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, cancelledAt: true },
    });

    if (!existing) {
      throw new NotFoundException("Event was not found.");
    }

    if (existing.cancelledAt) {
      throw new BadRequestException("This event is already cancelled.");
    }

    const paidOrdersCount = await this.prisma.order.count({
      where: {
        reservation: { eventId },
        status: OrderStatus.PAID,
      },
    });

    if (paidOrdersCount > 0) {
      throw new BadRequestException(
        "Cannot cancel event with paid orders. Contact support.",
      );
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: { cancelledAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_EVENT_CANCELLED",
        entityType: "event",
        entityId: eventId,
        payload: { adminId: authUser.userId },
      },
    });

    return { success: true, eventId };
  }

  async createSeat(eventId: string, dto: CreateSeatDto, authUser: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });

    if (!event) {
      throw new NotFoundException("Event was not found.");
    }

    const existingSeat = await this.prisma.seat.findUnique({
      where: {
        eventId_zone_row_number: {
          eventId,
          zone: dto.zone,
          row: dto.row,
          number: dto.number,
        },
      },
    });

    if (existingSeat) {
      throw new ConflictException(
        `Seat ${dto.zone}-${dto.row}-${dto.number} already exists for this event.`,
      );
    }

    const seat = await this.prisma.seat.create({
      data: {
        eventId,
        zone: dto.zone,
        row: dto.row,
        number: dto.number,
        price: dto.price,
        status: SeatStatus.AVAILABLE,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_SEAT_CREATED",
        entityType: "seat",
        entityId: seat.id,
        payload: { adminId: authUser.userId, eventId, seatLabel: `${dto.zone}-${dto.row}-${dto.number}`, price: dto.price },
      },
    });

    return { data: seat };
  }

  async deleteSeat(eventId: string, seatId: string, authUser: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });

    if (!event) {
      throw new NotFoundException("Event was not found.");
    }

    const seat = await this.prisma.seat.findUnique({
      where: { id: seatId },
    });

    if (!seat) {
      throw new NotFoundException("Seat was not found.");
    }

    if (seat.eventId !== eventId) {
      throw new NotFoundException("Seat was not found for this event.");
    }

    await this.prisma.seat.delete({ where: { id: seatId } });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_SEAT_DELETED",
        entityType: "seat",
        entityId: seatId,
        payload: {
          adminId: authUser.userId,
          eventId,
          seatLabel: `${seat.zone}-${seat.row}-${seat.number}`,
        },
      },
    });

    return { success: true };
  }

  async linkRoom(eventId: string, dto: LinkRoomDto, authUser: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });

    if (!event) {
      throw new NotFoundException("Event was not found.");
    }

    if (dto.roomId !== null && dto.roomId !== undefined) {
      const room = await this.prisma.liveRoom.findUnique({
        where: { id: dto.roomId },
        select: { id: true, eventId: true },
      });

      if (!room) {
        throw new NotFoundException("LiveRoom was not found.");
      }

      if (room.eventId && room.eventId !== eventId) {
        throw new BadRequestException(
          "This room is already linked to another event.",
        );
      }

      await this.prisma.liveRoom.update({
        where: { id: dto.roomId },
        data: { eventId },
      });

      await this.prisma.auditLog.create({
        data: {
          action: "ADMIN_EVENT_ROOM_LINKED",
          entityType: "event",
          entityId: eventId,
          payload: { adminId: authUser.userId, roomId: dto.roomId },
        },
      });
    } else {
      await this.prisma.liveRoom.updateMany({
        where: { eventId },
        data: { eventId: null },
      });

      await this.prisma.auditLog.create({
        data: {
          action: "ADMIN_EVENT_ROOM_UNLINKED",
          entityType: "event",
          entityId: eventId,
          payload: { adminId: authUser.userId },
        },
      });
    }

    return { success: true };
  }

  private deriveEventStatus(
    startAt: Date,
    endAt: Date,
    now: Date,
    cancelledAt?: Date | null,
  ) {
    if (cancelledAt) {
      return "CANCELLED";
    }
    if (startAt > now) {
      return "UPCOMING";
    }
    if (endAt < now) {
      return "ENDED";
    }
    return "LIVE";
  }

  private isSeatStatus(status: string): status is SeatStatus {
    return Object.values(SeatStatus).includes(status as SeatStatus);
  }

  private isVenueType(venueType: string): venueType is VenueType {
    return Object.values(VenueType).includes(venueType as VenueType);
  }

  private buildEventsOrderBy(
    query: NormalizedAdminListQuery<EventsSortField>,
  ): Prisma.EventOrderByWithRelationInput[] {
    switch (query.sortBy) {
      case "title":
        return [{ title: query.sortOrder }, { startAt: "asc" }, { id: "desc" }];
      case "createdAt":
        return [{ createdAt: query.sortOrder }, { id: "desc" }];
      default:
        return [
          { startAt: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
    }
  }
}
