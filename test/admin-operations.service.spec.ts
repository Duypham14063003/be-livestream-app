import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  RefundStatus,
  ReservationSource,
  ReservationStatus,
  SeatStatus,
  TicketStatus,
} from "@prisma/client";
import { AdminOperationsService } from "../src/modules/admin/operations/admin-operations.service";

describe("AdminOperationsService", () => {
  // Single shared transaction mock object — individual fn implementations are
  // reset and reconfigured in beforeEach so every test starts clean.
  const transactionMock: any = {
    order: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ticket: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    seat: {
      updateMany: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    reservationSeat: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const prismaMock: any = {
    $transaction: jest.fn((callback: (tx: any) => unknown) => callback(transactionMock)),
    order: {
      findUnique: jest.fn(),
    },
    payment: {
      findUnique: jest.fn(),
    },
    ticket: {
      findUnique: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const configMock = {
    get: jest.fn((key: string) => {
      if (key === "DEFAULT_CURRENCY") {
        return "USD";
      }

      return undefined;
    }),
  };

  const eventEmitterMock = {
    emit: jest.fn(),
  };

  const ticketsServiceMock = {
    resolveTicketDocument: jest.fn(),
  };

  const paymentsServiceMock = {
    createRefund: jest.fn(),
  };

  const reservationsServiceMock = {
    createManualPendingHold: jest.fn(),
    resolvePendingManualOrderCleanup: jest.fn(),
    emitReservationExpiredEvents: jest.fn(),
  };

  const systemSettingsServiceMock = {
    getManualPendingOrderTtlSetting: jest.fn(),
    updateManualPendingOrderTtlMinutes: jest.fn(),
  };

  let service: AdminOperationsService;

  beforeEach(() => {
    // Reset ALL mock call history and implementations so every test starts clean.
    // This is the single most important pattern for avoiding cross-test bleed.
    jest.resetAllMocks();
    // Restore the $transaction binding (resetAllMocks clears it)
    prismaMock.$transaction = jest.fn((callback: (tx: any) => unknown) =>
      callback(transactionMock),
    );
    // Recreate non-transaction prisma mock bindings
    prismaMock.order.findUnique = jest.fn();
    prismaMock.payment.findUnique = jest.fn();

    // Reset external service mocks
    eventEmitterMock.emit.mockReset();
    paymentsServiceMock.createRefund.mockReset();
    reservationsServiceMock.createManualPendingHold.mockReset();
    reservationsServiceMock.resolvePendingManualOrderCleanup.mockReset();
    reservationsServiceMock.emitReservationExpiredEvents.mockReset();
    systemSettingsServiceMock.getManualPendingOrderTtlSetting.mockReset();
    systemSettingsServiceMock.updateManualPendingOrderTtlMinutes.mockReset();

    jest.useFakeTimers().setSystemTime(Date.parse("2026-04-15T04:00:00.000Z"));
    service = new AdminOperationsService(
      prismaMock as never,
      configMock as never,
      eventEmitterMock as never,
      ticketsServiceMock as never,
      paymentsServiceMock as never,
      reservationsServiceMock as never,
      systemSettingsServiceMock as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("creates a manual pending order from a shared reservation hold", async () => {
    reservationsServiceMock.createManualPendingHold.mockResolvedValue({
      id: "res_manual",
      eventId: "event_001",
      expiresAt: new Date("2026-04-15T04:30:00.000Z"),
      reservationSeats: [
        { seatId: "seat_001", price: 12000 },
        { seatId: "seat_002", price: 18000 },
      ],
    });
    transactionMock.order.create.mockResolvedValue({ id: "order_manual" });

    const response = await service.createManualOrder(
      {
        userId: "user_001",
        eventId: "event_001",
        seatIds: ["seat_001", "seat_002"],
        adminNote: "VIP desk payment pending",
      },
      "admin_001",
    );

    expect(response).toEqual({
      data: {
        id: "order_manual",
      },
    });
    expect(reservationsServiceMock.createManualPendingHold).toHaveBeenCalledWith(
      transactionMock,
      {
        userId: "user_001",
        eventId: "event_001",
        seatIds: ["seat_001", "seat_002"],
      },
    );
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      "seat.updated",
      expect.objectContaining({
        eventId: "event_001",
        reservationId: "res_manual",
        seatIds: ["seat_001", "seat_002"],
        status: SeatStatus.HELD,
      }),
    );
  });

  it("replaces the seat set for an eligible manual pending order", async () => {
    transactionMock.order.findUnique.mockResolvedValue(
      buildEditableManualOrder(),
    );
    transactionMock.seat.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    transactionMock.seat.findMany.mockResolvedValue([
      { id: "seat_003", price: 20000 },
    ]);
    transactionMock.reservationSeat.findMany.mockResolvedValue([
      { seatId: "seat_001", price: 12000 },
      { seatId: "seat_003", price: 20000 },
    ]);

    await service.replaceManualOrderSeats(
      "order_manual",
      {
        seatIds: ["seat_001", "seat_003"],
      },
      "admin_001",
    );

    expect(transactionMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_manual" },
        data: { amount: 32000 },
      }),
    );
    expect(eventEmitterMock.emit).toHaveBeenNthCalledWith(
      1,
      "seat.updated",
      expect.objectContaining({
        seatIds: ["seat_003"],
        status: SeatStatus.HELD,
      }),
    );
    expect(eventEmitterMock.emit).toHaveBeenNthCalledWith(
      2,
      "seat.updated",
      expect.objectContaining({
        seatIds: ["seat_002"],
        status: SeatStatus.AVAILABLE,
      }),
    );
  });

  it("cancels an unpaid manual pending order through the shared cleanup resolver", async () => {
    prismaMock.order.findUnique.mockResolvedValue(buildEditableManualOrder());
    reservationsServiceMock.resolvePendingManualOrderCleanup.mockResolvedValue({
      id: "res_manual",
      eventId: "event_001",
      status: ReservationStatus.EXPIRED,
      seatIds: ["seat_001", "seat_002"],
      linkedOrderId: "order_manual",
      linkedOrderStatus: OrderStatus.CANCELLED,
      usedManualPendingResolver: true,
    });

    const response = await service.cancelOrder("order_manual", {}, "admin_001");

    expect(response.data.mode).toBe("release_hold");
    expect(reservationsServiceMock.resolvePendingManualOrderCleanup).toHaveBeenCalledWith(
      transactionMock,
      "res_manual",
      {
        reason: "admin_order_cancel:admin_001",
        orderAction: "cancel",
      },
    );
    expect(reservationsServiceMock.emitReservationExpiredEvents).toHaveBeenCalled();
  });

  it("creates a refund request only when cancelling a paid order", async () => {
    prismaMock.order.findUnique.mockResolvedValue(
      buildEditableManualOrder({
        status: OrderStatus.PAID,
        reservation: {
          source: ReservationSource.CHECKOUT,
          status: ReservationStatus.CONFIRMED,
          expiresAt: new Date("2026-04-15T03:30:00.000Z"),
          eventId: "event_001",
          event: {
            id: "event_001",
            title: "Offline Summit",
          },
          reservationSeats: [],
        },
        payment: {
          id: "payment_001",
          status: PaymentStatus.PAID,
          refunds: [],
        },
      }),
    );
    paymentsServiceMock.createRefund.mockResolvedValue({ id: "refund_001" });

    const response = await service.cancelOrder(
      "order_manual",
      { reason: "Customer requested refund" },
      "admin_001",
    );

    expect(response.data.mode).toBe("refund_request_only");
    expect(paymentsServiceMock.createRefund).toHaveBeenCalledWith({
      paymentId: "payment_001",
      reason: "Customer requested refund",
      idempotencyKey: "admin_order_cancel_order_manual",
    });
    expect(reservationsServiceMock.resolvePendingManualOrderCleanup).not.toHaveBeenCalled();
  });

  it("deletes an eligible pending manual order and releases its hold", async () => {
    prismaMock.order.findUnique.mockResolvedValue(buildEditableManualOrder());
    reservationsServiceMock.resolvePendingManualOrderCleanup.mockResolvedValue({
      id: "res_manual",
      eventId: "event_001",
      status: ReservationStatus.EXPIRED,
      seatIds: ["seat_001", "seat_002"],
      linkedOrderId: "order_manual",
      linkedOrderStatus: null,
      usedManualPendingResolver: true,
    });

    const response = await service.deletePendingOrder(
      "order_manual",
      "admin_001",
    );

    expect(response).toEqual({
      success: true,
      orderId: "order_manual",
      seatsReleased: 2,
    });
    expect(reservationsServiceMock.resolvePendingManualOrderCleanup).toHaveBeenCalledWith(
      transactionMock,
      "res_manual",
      {
        reason: "admin_order_delete:admin_001",
        orderAction: "delete",
      },
    );
  });

  it("updates the manual pending setting and audits the change", async () => {
    systemSettingsServiceMock.getManualPendingOrderTtlSetting.mockResolvedValue({
      ttlMinutes: 10,
      fallbackTtlMinutes: 10,
      isPersisted: false,
      updatedAt: null,
    });
    systemSettingsServiceMock.updateManualPendingOrderTtlMinutes.mockResolvedValue({
      ttlMinutes: 20,
      fallbackTtlMinutes: 10,
      isPersisted: true,
      updatedAt: "2026-04-15T04:00:00.000Z",
    });

    const response = await service.updateManualPendingSetting(
      { ttlMinutes: 20 },
      "admin_001",
    );

    expect(response.setting.ttlMinutes).toBe(20);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ADMIN_MANUAL_PENDING_TTL_UPDATED",
          entityType: "system_setting",
        }),
      }),
    );
  });

  // ========== Payment CRUD tests ==========

  function buildPaymentOrder(overrides: Partial<any> = {}) {
    return {
      id: "order_001",
      amount: 100000,
      status: OrderStatus.PENDING,
      user: { id: "user_001", displayName: "Test User", email: "test@example.com" },
      reservation: null,
      payment: null,
      tickets: [],
      ...overrides,
    };
  }

  it("createManualPayment — success, auto-confirms order when paid=true", async () => {
    transactionMock.order.findUnique.mockResolvedValue(buildPaymentOrder());
    transactionMock.payment.create.mockResolvedValue({
      id: "payment_new",
      status: PaymentStatus.PAID,
      provider: PaymentProvider.CASH,
    });

    const response = await service.createManualPayment(
      { orderId: "order_001", provider: PaymentProvider.CASH, paid: true },
      "admin_001",
    );

    expect(response.payment.id).toBe("payment_new");
    expect(transactionMock.order.update).toHaveBeenCalledWith({
      where: { id: "order_001" },
      data: { status: OrderStatus.PAID },
    });
    expect(transactionMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ADMIN_PAYMENT_RECORDED",
          entityType: "payment",
        }),
      }),
    );
  });

  it("createManualPayment — throws ConflictException when order already has a paid payment", async () => {
    transactionMock.order.findUnique.mockResolvedValue(
      buildPaymentOrder({ payment: { id: "payment_existing", status: PaymentStatus.PAID } }),
    );

    await expect(
      service.createManualPayment(
        { orderId: "order_001", provider: PaymentProvider.CASH, paid: true },
        "admin_001",
      ),
    ).rejects.toThrow("Order already has a paid payment.");
  });

  it("createManualPayment — throws NotFoundException when order not found", async () => {
    transactionMock.order.findUnique.mockResolvedValue(null);

    await expect(
      service.createManualPayment(
        { orderId: "nonexistent", provider: PaymentProvider.CASH, paid: true },
        "admin_001",
      ),
    ).rejects.toThrow("Order not found.");
  });

  it("updatePaymentStatus — success, updates both payment and order status", async () => {
    const mockPayment = {
      id: "payment_001",
      orderId: "order_001",
      status: PaymentStatus.PENDING,
      paidAt: null,
    };
    prismaMock.payment.findUnique.mockResolvedValue(mockPayment);
    transactionMock.payment.update.mockResolvedValue({
      ...mockPayment,
      status: PaymentStatus.PAID,
    });

    const response = await service.updatePaymentStatus(
      "payment_001",
      { status: PaymentStatus.PAID },
      "admin_001",
    );

    expect(response.payment.status).toBe(PaymentStatus.PAID);
    expect(response.idempotent).toBe(false);
    expect(transactionMock.order.update).toHaveBeenCalledWith({
      where: { id: "order_001" },
      data: { status: OrderStatus.PAID },
    });
  });

  it("updatePaymentStatus — idempotent when status is already set", async () => {
    const mockPayment = {
      id: "payment_001",
      orderId: "order_001",
      status: PaymentStatus.PAID,
      paidAt: new Date(),
    };
    prismaMock.payment.findUnique.mockResolvedValue(mockPayment);

    const response = await service.updatePaymentStatus(
      "payment_001",
      { status: PaymentStatus.PAID },
      "admin_001",
    );

    expect(response.idempotent).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("retryPayment — success, resets FAILED payment to PENDING", async () => {
    const mockPayment = {
      id: "payment_failed",
      status: PaymentStatus.FAILED,
      providerRef: "orig_ref_123",
      paidAt: new Date(),
      order: { amount: 75000 },
    };
    prismaMock.payment.findUnique.mockResolvedValue(mockPayment);
    transactionMock.payment.update.mockResolvedValue({
      ...mockPayment,
      status: PaymentStatus.PENDING,
      paidAt: null,
      providerRef: null,
    });

    const response = await service.retryPayment("payment_failed", "admin_001");

    expect(response.payment.status).toBe(PaymentStatus.PENDING);
    expect(transactionMock.payment.update).toHaveBeenCalledWith({
      where: { id: "payment_failed" },
      data: {
        status: PaymentStatus.PENDING,
        paidAt: null,
        providerRef: null,
      },
    });
    expect(transactionMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ADMIN_PAYMENT_RETRY" }),
      }),
    );
  });

  it("retryPayment — throws ConflictException when payment is not FAILED", async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      id: "payment_paid",
      status: PaymentStatus.PAID,
    });

    await expect(
      service.retryPayment("payment_paid", "admin_001"),
    ).rejects.toThrow("Only FAILED payments can be retried.");
  });

  it("retryPayment — throws NotFoundException when payment not found", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null);

    await expect(
      service.retryPayment("nonexistent", "admin_001"),
    ).rejects.toThrow("Payment not found.");
  });

  it("deletePayment — success for PENDING payment", async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      id: "payment_pending",
      status: PaymentStatus.PENDING,
      orderId: "order_001",
      order: { amount: 50000 },
    });
    transactionMock.payment.delete.mockResolvedValue({ id: "payment_pending" });

    const response = await service.deletePayment("payment_pending", "admin_001");

    expect(response.success).toBe(true);
    expect(response.paymentId).toBe("payment_pending");
    expect(transactionMock.payment.delete).toHaveBeenCalledWith({
      where: { id: "payment_pending" },
    });
    expect(transactionMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ADMIN_PAYMENT_DELETED" }),
      }),
    );
  });

  it("deletePayment — throws ConflictException for PAID payment", async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      id: "payment_paid",
      status: PaymentStatus.PAID,
    });

    await expect(
      service.deletePayment("payment_paid", "admin_001"),
    ).rejects.toThrow("Only PENDING or FAILED payments can be deleted.");
  });

  it("deletePayment — throws NotFoundException when payment not found", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(null);

    await expect(
      service.deletePayment("nonexistent", "admin_001"),
    ).rejects.toThrow("Payment not found.");
  });

  // ========== Ticket CRUD tests ==========

  function buildTicketOrder(overrides: Partial<any> = {}) {
    return {
      id: "order_001",
      amount: 100000,
      status: OrderStatus.PAID,
      user: { id: "user_001", displayName: "Test User", email: "test@example.com" },
      payment: { id: "payment_001", status: PaymentStatus.PAID },
      tickets: [],
      reservation: null,
      ...overrides,
    };
  }

  function buildMockSeat(overrides: Partial<any> = {}) {
    return {
      id: "seat_001",
      zone: "A",
      row: "1",
      number: "01",
      status: SeatStatus.HELD,
      ...overrides,
    };
  }

  function buildMockTicket(overrides: Partial<any> = {}) {
    return {
      id: "ticket_001",
      orderId: "order_001",
      seatId: "seat_001",
      qrCode: "qr-uuid-001",
      status: TicketStatus.ACTIVE,
      checkedInAt: null,
      seat: buildMockSeat(),
      ...overrides,
    };
  }

  it("createTicket — success, creates ticket with qrCode and issues audit log", async () => {
    transactionMock.order.findUnique.mockResolvedValue(buildTicketOrder());
    transactionMock.seat.findUnique.mockResolvedValue(buildMockSeat());
    transactionMock.ticket.findUnique.mockResolvedValue(null);
    transactionMock.ticket.create.mockResolvedValue({
      id: "ticket_new",
      qrCode: "qr-new-001",
      status: TicketStatus.ACTIVE,
    });

    const response = await service.createTicket(
      { orderId: "order_001", userId: "user_001", eventId: "event_001", seatId: "seat_001" },
      "admin_001",
    );

    expect(response.ticket.id).toBe("ticket_new");
    expect(transactionMock.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: "order_001",
          seatId: "seat_001",
          status: TicketStatus.ACTIVE,
        }),
      }),
    );
    expect(transactionMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ADMIN_TICKET_ISSUED" }),
      }),
    );
  });

  it("createTicket — throws ConflictException when order is not PAID", async () => {
    transactionMock.order.findUnique.mockResolvedValue(buildTicketOrder({ status: OrderStatus.PENDING }));

    await expect(
      service.createTicket(
        { orderId: "order_001", userId: "user_001", eventId: "event_001", seatId: "seat_001" },
        "admin_001",
      ),
    ).rejects.toThrow("Only PAID orders can receive tickets.");
  });

  it("createTicket — throws ConflictException when seat already has a ticket", async () => {
    transactionMock.order.findUnique.mockResolvedValue(buildTicketOrder());
    transactionMock.seat.findUnique.mockResolvedValue(buildMockSeat());
    transactionMock.ticket.findUnique.mockResolvedValue(buildMockTicket());

    await expect(
      service.createTicket(
        { orderId: "order_001", userId: "user_001", eventId: "event_001", seatId: "seat_001" },
        "admin_001",
      ),
    ).rejects.toThrow("already has an active ticket");
  });

  it("createTicket — throws NotFoundException when order not found", async () => {
    transactionMock.order.findUnique.mockResolvedValue(null);

    await expect(
      service.createTicket(
        { orderId: "nonexistent", userId: "user_001", eventId: "event_001", seatId: "seat_001" },
        "admin_001",
      ),
    ).rejects.toThrow("Order not found.");
  });

  it("updateTicketStatus — success, sets checkedInAt when checking in", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(buildMockTicket());
    transactionMock.ticket.update.mockResolvedValue({
      ...buildMockTicket(),
      status: TicketStatus.USED,
      checkedInAt: new Date(),
    });

    const response = await service.updateTicketStatus(
      "ticket_001",
      { status: TicketStatus.USED },
      "admin_001",
    );

    expect(response.ticket.status).toBe(TicketStatus.USED);
    expect(response.idempotent).toBe(false);
    expect(transactionMock.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ticket_001" },
        data: expect.objectContaining({ status: TicketStatus.USED }),
      }),
    );
    expect(transactionMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ADMIN_TICKET_STATUS_UPDATED" }),
      }),
    );
  });

  it("updateTicketStatus — idempotent when status is already set", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(buildMockTicket({ status: TicketStatus.USED }));

    const response = await service.updateTicketStatus(
      "ticket_001",
      { status: TicketStatus.USED },
      "admin_001",
    );

    expect(response.idempotent).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("updateTicketStatus — throws ConflictException for forbidden transitions", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(buildMockTicket({ status: TicketStatus.USED }));

    await expect(
      service.updateTicketStatus("ticket_001", { status: TicketStatus.ACTIVE }, "admin_001"),
    ).rejects.toThrow("ACTIVE tickets can be updated");
  });

  it("voidTicket — success, voids ticket and releases seat", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(buildMockTicket());
    transactionMock.ticket.update.mockResolvedValue({
      ...buildMockTicket(),
      status: TicketStatus.REFUNDED,
    });
    transactionMock.ticket.findFirst.mockResolvedValue(null);
    transactionMock.seat.update.mockResolvedValue(buildMockSeat({ status: SeatStatus.AVAILABLE }));

    const response = await service.voidTicket(
      "ticket_001",
      { reason: "Customer cancelled", releaseSeat: true },
      "admin_001",
    );

    expect(response.seatReleased).toBe(true);
    expect(transactionMock.seat.update).toHaveBeenCalledWith({
      where: { id: "seat_001" },
      data: { status: SeatStatus.AVAILABLE },
    });
    expect(transactionMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ADMIN_TICKET_VOIDED" }),
      }),
    );
  });

  it("voidTicket — success without seat release", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(buildMockTicket());
    transactionMock.ticket.update.mockResolvedValue({
      ...buildMockTicket(),
      status: TicketStatus.REFUNDED,
    });

    const response = await service.voidTicket(
      "ticket_001",
      { releaseSeat: false },
      "admin_001",
    );

    expect(response.seatReleased).toBe(false);
    expect(transactionMock.seat.update).not.toHaveBeenCalled();
  });

  it("voidTicket — throws ConflictException when seat conflict", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(buildMockTicket());
    transactionMock.ticket.update.mockResolvedValue({
      ...buildMockTicket(),
      status: TicketStatus.REFUNDED,
    });
    transactionMock.ticket.findFirst.mockResolvedValue(buildMockTicket({ id: "other_ticket" }));

    await expect(
      service.voidTicket("ticket_001", { releaseSeat: true }, "admin_001"),
    ).rejects.toThrow("Cannot release seat — it already has an active ticket");
  });

  it("voidTicket — throws ConflictException for non-ACTIVE ticket", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(buildMockTicket({ status: TicketStatus.USED }));

    await expect(
      service.voidTicket("ticket_001", {}, "admin_001"),
    ).rejects.toThrow("Only ACTIVE tickets can be voided.");
  });

  it("voidTicket — throws NotFoundException when ticket not found", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expect(
      service.voidTicket("nonexistent", {}, "admin_001"),
    ).rejects.toThrow("Ticket not found.");
  });

  it("resendTicket — returns no-op response and writes audit log", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(buildMockTicket());

    const response = await service.resendTicket("ticket_001", "admin_001");

    expect(response).toEqual({
      success: true,
      message: "Email integration not implemented.",
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ADMIN_TICKET_RESEND_ATTEMPTED" }),
      }),
    );
  });

  it("deleteTicket — success, deletes ticket and writes audit log", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(buildMockTicket());

    const response = await service.deleteTicket("ticket_001", "admin_001");

    expect(response.success).toBe(true);
    expect(response.ticketId).toBe("ticket_001");
    expect(transactionMock.ticket.delete).toHaveBeenCalledWith({
      where: { id: "ticket_001" },
    });
    expect(transactionMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ADMIN_TICKET_DELETED" }),
      }),
    );
  });

  it("deleteTicket — throws NotFoundException when ticket not found", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue(null);

    await expect(
      service.deleteTicket("nonexistent", "admin_001"),
    ).rejects.toThrow("Ticket not found.");
  });
});

function buildEditableManualOrder(overrides: Partial<any> = {}) {
  // Always create fresh objects at every level so mutations from one test
  // don't bleed into another test's assertions.
  const defaultReservationSeats = [
    {
      seatId: "seat_001",
      seat: { id: "seat_001", zone: "A", row: "1", number: "01", status: SeatStatus.HELD },
    },
    {
      seatId: "seat_002",
      seat: { id: "seat_002", zone: "A", row: "1", number: "02", status: SeatStatus.HELD },
    },
  ];
  const defaultReservation = {
    id: "res_manual",
    eventId: "event_001",
    source: ReservationSource.ADMIN_MANUAL_ORDER,
    status: ReservationStatus.HELD,
    expiresAt: new Date("2026-04-15T04:30:00.000Z"),
    event: { id: "event_001", title: "Offline Summit" },
    reservationSeats: defaultReservationSeats,
  };

  return {
    id: "order_manual",
    reservationId: "res_manual",
    status: OrderStatus.PENDING,
    tickets: [] as any[],
    // payment/reservation: use override value if provided, else default.
    // Avoid spreading `...overrides` first — it would duplicate keys below.
    payment: overrides.payment !== undefined ? overrides.payment : null,
    reservation: overrides.reservation
      ? { ...defaultReservation, ...overrides.reservation }
      : defaultReservation,
    user: { id: "user_001", displayName: "Customer Demo", email: "customer@example.com" },
    // Shallow-copy top-level overrides (id, status, etc.)
    ...overrides,
  };
}
