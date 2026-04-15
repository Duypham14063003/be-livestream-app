import { NotFoundException } from "@nestjs/common";
import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ReservationStatus,
  SeatStatus,
  TicketStatus,
} from "@prisma/client";
import { AdminReservationsService } from "../src/modules/admin/reservations/admin-reservations.service";

describe("AdminReservationsService", () => {
  const prismaMock: any = {
    reservation: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const reservationsServiceMock = {
    confirmReservation: jest.fn(),
    expireReservation: jest.fn(),
  };

  let service: AdminReservationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .useFakeTimers()
      .setSystemTime(Date.parse("2026-04-11T08:00:00.000Z"));
    service = new AdminReservationsService(
      prismaMock as never,
      reservationsServiceMock as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("maps held, confirmed, expired, and cancelled reservations for the admin list", async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      buildReservation({
        id: "res_held",
        status: ReservationStatus.HELD,
        expiresAt: new Date("2026-04-11T08:05:00.000Z"),
      }),
      buildReservation({
        id: "res_confirmed",
        status: ReservationStatus.CONFIRMED,
        expiresAt: new Date("2026-04-11T07:55:00.000Z"),
        order: buildOrder(),
      }),
      buildReservation({
        id: "res_expired",
        status: ReservationStatus.EXPIRED,
        expiresAt: new Date("2026-04-11T07:00:00.000Z"),
      }),
      buildReservation({
        id: "res_cancelled",
        status: ReservationStatus.CANCELLED,
        expiresAt: new Date("2026-04-11T07:30:00.000Z"),
      }),
    ]);
    prismaMock.reservation.count.mockResolvedValue(4);

    const response = await service.getReservations({
      page: 1,
      pageSize: 20,
      sortBy: "createdAt",
      sortOrder: "desc",
    });

    expect(response.data.map((item) => item.status)).toEqual([
      "HELD",
      "CONFIRMED",
      "EXPIRED",
      "CANCELLED",
    ]);
    expect(response.data[0]).toMatchObject({
      id: "res_held",
      seatCount: 2,
      seatSummary: "A-1-01 +1 more",
      orderId: null,
      paymentStatus: null,
      expiredByClock: false,
    });
    expect(response.data[1]).toMatchObject({
      id: "res_confirmed",
      orderStatus: "PAID",
      paymentStatus: "PAID",
    });
    expect(response.data[2].expiredByClock).toBe(true);
    expect(response.meta.total).toBe(4);
  });

  it("maps reservation detail with seat and control context", async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(
      buildReservation({
        id: "res_detail",
        status: ReservationStatus.HELD,
        expiresAt: new Date("2026-04-11T08:15:00.000Z"),
        order: buildOrder({
          tickets: [
            {
              id: "ticket_001",
              seatId: "seat_001",
              status: TicketStatus.ACTIVE,
              pdfUrl: "https://cdn.example.com/tickets/ticket_001.pdf",
            },
          ],
        }),
      }),
    );

    const response = await service.getReservationDetail("res_detail");

    expect(response.reservation.controls).toEqual({
      canConfirm: true,
      canExpire: true,
      confirmMessage: null,
      expireMessage: null,
    });
    expect(response.reservation.order?.tickets).toHaveLength(1);
    expect(response.reservation.seats[0]).toMatchObject({
      id: "seat_001",
      ticketId: "ticket_001",
      ticketStatus: "ACTIVE",
    });
  });

  it("disables admin actions for cancelled reservations", async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(
      buildReservation({
        id: "res_cancelled",
        status: ReservationStatus.CANCELLED,
      }),
    );

    const response = await service.getReservationDetail("res_cancelled");

    expect(response.reservation.controls.canConfirm).toBe(false);
    expect(response.reservation.controls.canExpire).toBe(false);
    expect(response.reservation.controls.confirmMessage).toBe(
      "Only held reservations can be confirmed.",
    );
  });

  it("throws when reservation detail cannot be found", async () => {
    prismaMock.reservation.findUnique.mockResolvedValue(null);

    await expect(service.getReservationDetail("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("delegates confirm to the shared reservation service with stable admin defaults", async () => {
    reservationsServiceMock.confirmReservation.mockResolvedValue({
      id: "order_001",
    });

    await service.confirmReservation("res_001", "admin_001", {});

    expect(reservationsServiceMock.confirmReservation).toHaveBeenCalledWith(
      "res_001",
      {
        provider: PaymentProvider.STRIPE,
        providerRef: "admin-confirm:admin_001",
        idempotencyKey: "admin_confirm_res_001",
      },
    );
  });

  it("delegates expire to the shared reservation service with an admin reason", async () => {
    reservationsServiceMock.expireReservation.mockResolvedValue({
      id: "res_001",
      status: ReservationStatus.EXPIRED,
    });

    await service.expireReservation("res_001", "admin_001", {});

    expect(reservationsServiceMock.expireReservation).toHaveBeenCalledWith(
      "res_001",
      {
        reason: "admin_manual_expire:admin_001",
      },
    );
  });
});

function buildReservation(overrides: Partial<any> = {}) {
  return {
    id: "res_001",
    userId: "user_001",
    eventId: "event_001",
    status: ReservationStatus.HELD,
    createdAt: new Date("2026-04-11T07:30:00.000Z"),
    updatedAt: new Date("2026-04-11T07:40:00.000Z"),
    expiresAt: new Date("2026-04-11T08:10:00.000Z"),
    user: {
      id: "user_001",
      displayName: "Customer Demo",
      email: "customer@demo.local",
    },
    event: {
      id: "event_001",
      title: "Tech Broadcast Summit 2026",
      startAt: new Date("2026-04-12T10:00:00.000Z"),
    },
    reservationSeats: [
      buildReservationSeat({
        seatId: "seat_001",
        seat: {
          id: "seat_001",
          zone: "A",
          row: "1",
          number: "01",
          status: SeatStatus.HELD,
        },
      }),
      buildReservationSeat({
        seatId: "seat_002",
        seat: {
          id: "seat_002",
          zone: "A",
          row: "1",
          number: "02",
          status: SeatStatus.HELD,
        },
      }),
    ],
    order: null,
    ...overrides,
  };
}

function buildReservationSeat(overrides: Partial<any> = {}) {
  return {
    id: "rs_001",
    reservationId: "res_001",
    seatId: "seat_001",
    price: 15000,
    seat: {
      id: "seat_001",
      zone: "A",
      row: "1",
      number: "01",
      status: SeatStatus.HELD,
    },
    ...overrides,
  };
}

function buildOrder(overrides: Partial<any> = {}) {
  return {
    id: "order_001",
    status: OrderStatus.PAID,
    amount: 30000,
    currency: "USD",
    createdAt: new Date("2026-04-11T07:45:00.000Z"),
    payment: {
      id: "payment_001",
      provider: PaymentProvider.STRIPE,
      status: PaymentStatus.PAID,
      paidAt: new Date("2026-04-11T07:46:00.000Z"),
      providerRef: "admin-confirm:admin_001",
    },
    tickets: [],
    ...overrides,
  };
}
