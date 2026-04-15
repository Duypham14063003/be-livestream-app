import {
  OrderStatus,
  ReservationSource,
  ReservationStatus,
  SeatStatus,
} from "@prisma/client";
import { ReservationsService } from "../src/modules/reservations/reservations.service";

describe("ReservationsService", () => {
  const transactionMock: any = {
    reservation: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    seat: {
      updateMany: jest.fn(),
    },
    order: {
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const prismaMock: any = {
    $transaction: jest.fn((callback: (tx: any) => unknown) => callback(transactionMock)),
    reservation: {
      findMany: jest.fn(),
    },
  };

  const configMock = {
    get: jest.fn((key: string) => {
      if (key === "DEFAULT_CURRENCY") return "USD";
      return undefined;
    }),
  };

  const eventEmitterMock = {
    emit: jest.fn(),
  };

  const systemSettingsServiceMock = {
    getSeatHoldFallbackMinutes: jest.fn(() => 10),
    getManualPendingOrderTtlSetting: jest.fn(),
    buildManualPendingOrderExpiry: jest.fn(),
  };

  let service: ReservationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(Date.parse("2026-04-15T04:00:00.000Z"));
    service = new ReservationsService(
      prismaMock as never,
      configMock as never,
      eventEmitterMock as never,
      systemSettingsServiceMock as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("expires a manual pending reservation and cancels the linked order", async () => {
    transactionMock.reservation.findUnique.mockResolvedValue(
      buildManualPendingReservation(),
    );
    transactionMock.reservation.update.mockResolvedValue(
      buildManualPendingReservation({
        status: ReservationStatus.EXPIRED,
      }),
    );
    transactionMock.order.update.mockResolvedValue({
      id: "order_manual",
      status: OrderStatus.CANCELLED,
    });

    const response = await service.expireReservation("res_manual", {
      reason: "admin_manual_expire:admin_001",
    });

    expect(response).toMatchObject({
      id: "res_manual",
      status: ReservationStatus.EXPIRED,
      linkedOrderStatus: OrderStatus.CANCELLED,
      usedManualPendingResolver: true,
    });
    expect(transactionMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_manual" },
        data: { status: OrderStatus.CANCELLED },
      }),
    );
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      "reservation.expired",
      expect.objectContaining({
        reservationId: "res_manual",
        linkedOrderStatus: OrderStatus.CANCELLED,
      }),
    );
  });

  it("reconciles stale manual pending reservations through the expiry job path", async () => {
    prismaMock.reservation.findMany.mockResolvedValue([
      buildManualPendingReservation(),
    ]);
    transactionMock.reservation.findUnique.mockResolvedValue(
      buildManualPendingReservation(),
    );
    transactionMock.reservation.update.mockResolvedValue(
      buildManualPendingReservation({
        status: ReservationStatus.EXPIRED,
      }),
    );
    transactionMock.order.update.mockResolvedValue({
      id: "order_manual",
      status: OrderStatus.CANCELLED,
    });

    const response = await service.expireStaleReservations();

    expect(response).toEqual({
      expiredCount: 1,
      releasedSeats: ["seat_001", "seat_002"],
    });
    expect(transactionMock.order.update).toHaveBeenCalled();
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      "seat.updated",
      expect.objectContaining({
        seatIds: ["seat_001", "seat_002"],
        status: SeatStatus.AVAILABLE,
      }),
    );
  });
});

function buildManualPendingReservation(overrides: Partial<any> = {}) {
  return {
    id: "res_manual",
    eventId: "event_001",
    userId: "user_001",
    status: ReservationStatus.HELD,
    source: ReservationSource.ADMIN_MANUAL_ORDER,
    expiresAt: new Date("2026-04-15T03:55:00.000Z"),
    reservationSeats: [
      { seatId: "seat_001" },
      { seatId: "seat_002" },
    ],
    order: {
      id: "order_manual",
      status: OrderStatus.PENDING,
      payment: null,
      tickets: [],
    },
    ...overrides,
  };
}
