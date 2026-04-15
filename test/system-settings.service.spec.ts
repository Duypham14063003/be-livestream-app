import { SystemSettingsService } from "../src/modules/system-settings/system-settings.service";

describe("SystemSettingsService", () => {
  const prismaMock: any = {
    systemSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const configMock = {
    get: jest.fn((key: string) => {
      if (key === "SEAT_HOLD_TTL_MINUTES") {
        return "15";
      }

      return undefined;
    }),
  };

  let service: SystemSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SystemSettingsService(prismaMock as never, configMock as never);
  });

  it("falls back to the seat hold env value when no row is persisted", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);

    const response = await service.getManualPendingOrderTtlSetting();

    expect(response).toEqual({
      ttlMinutes: 15,
      fallbackTtlMinutes: 15,
      isPersisted: false,
      updatedAt: null,
    });
  });

  it("returns the persisted ttl when present", async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue({
      key: "manualPendingOrderTtlMinutes",
      value: "30",
      updatedAt: new Date("2026-04-15T04:00:00.000Z"),
    });

    const response = await service.getManualPendingOrderTtlSetting();

    expect(response).toEqual({
      ttlMinutes: 30,
      fallbackTtlMinutes: 15,
      isPersisted: true,
      updatedAt: "2026-04-15T04:00:00.000Z",
    });
  });

  it("persists ttl updates through an upsert", async () => {
    prismaMock.systemSetting.upsert.mockResolvedValue({
      key: "manualPendingOrderTtlMinutes",
      value: "25",
      updatedAt: new Date("2026-04-15T04:05:00.000Z"),
    });

    const response = await service.updateManualPendingOrderTtlMinutes(25);

    expect(response).toEqual({
      ttlMinutes: 25,
      fallbackTtlMinutes: 15,
      isPersisted: true,
      updatedAt: "2026-04-15T04:05:00.000Z",
    });
    expect(prismaMock.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "manualPendingOrderTtlMinutes" },
        update: { value: "25" },
      }),
    );
  });
});
