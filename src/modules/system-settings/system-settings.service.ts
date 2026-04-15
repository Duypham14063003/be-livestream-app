import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import { MANUAL_PENDING_ORDER_TTL_SETTING_KEY } from "./system-settings.constants";

type SettingsClient = Pick<
  PrismaService,
  "systemSetting"
>;

export interface ManualPendingOrderTtlSetting {
  ttlMinutes: number;
  fallbackTtlMinutes: number;
  isPersisted: boolean;
  updatedAt: string | null;
}

@Injectable()
export class SystemSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getManualPendingOrderTtlSetting(
    client: SettingsClient = this.prisma,
  ): Promise<ManualPendingOrderTtlSetting> {
    const setting = await client.systemSetting.findUnique({
      where: { key: MANUAL_PENDING_ORDER_TTL_SETTING_KEY },
    });

    const fallbackTtlMinutes = this.getSeatHoldFallbackMinutes();
    const persistedValue = setting
      ? this.parsePositiveInteger(setting.value, fallbackTtlMinutes)
      : null;
    const ttlMinutes = persistedValue ?? fallbackTtlMinutes;

    return {
      ttlMinutes,
      fallbackTtlMinutes,
      isPersisted: persistedValue !== null,
      updatedAt: setting?.updatedAt.toISOString() ?? null,
    };
  }

  async updateManualPendingOrderTtlMinutes(
    ttlMinutes: number,
    client: SettingsClient = this.prisma,
  ): Promise<ManualPendingOrderTtlSetting> {
    if (!Number.isInteger(ttlMinutes) || ttlMinutes <= 0) {
      throw new BadRequestException(
        "manualPendingOrderTtlMinutes must be a positive integer.",
      );
    }

    const setting = await client.systemSetting.upsert({
      where: { key: MANUAL_PENDING_ORDER_TTL_SETTING_KEY },
      update: { value: String(ttlMinutes) },
      create: {
        key: MANUAL_PENDING_ORDER_TTL_SETTING_KEY,
        value: String(ttlMinutes),
      },
    });

    return {
      ttlMinutes,
      fallbackTtlMinutes: this.getSeatHoldFallbackMinutes(),
      isPersisted: true,
      updatedAt: setting.updatedAt.toISOString(),
    };
  }

  buildManualPendingOrderExpiry(ttlMinutes: number) {
    return new Date(Date.now() + ttlMinutes * 60 * 1000);
  }

  getSeatHoldFallbackMinutes() {
    return this.parsePositiveInteger(
      this.configService.get<string>("SEAT_HOLD_TTL_MINUTES"),
      10,
    );
  }

  private parsePositiveInteger(
    value: string | null | undefined,
    fallbackValue: number,
  ) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      return fallbackValue;
    }

    return parsed;
  }
}

