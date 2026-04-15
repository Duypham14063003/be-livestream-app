import { BadRequestException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { AdminUsersService } from "../src/modules/admin/users/admin-users.service";

describe("AdminUsersService", () => {
  const prismaMock: any = {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    ticket: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    reservation: {
      count: jest.fn(),
    },
    liveParticipant: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const configMock = {
    get: jest.fn((key: string) => {
      if (key === "BCRYPT_SALT_ROUNDS") return "4";
      return undefined;
    }),
  };

  let service: AdminUsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(Date.parse("2026-04-15T03:45:00.000Z"));
    service = new AdminUsersService(
      prismaMock as never,
      configMock as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("maps lifecycle status and guard controls on the admin user list", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      buildUserListRow({
        id: "admin_abc123",
        role: UserRole.ADMIN,
        displayName: "Primary Admin",
      }),
      buildUserListRow({
        id: "user_suspended",
        suspendedAt: new Date("2026-04-15T03:30:00.000Z"),
      }),
      buildUserListRow({
        id: "user_deleted",
        deletedAt: new Date("2026-04-15T03:00:00.000Z"),
        anonymizedAt: new Date("2026-04-15T03:00:00.000Z"),
        email: null,
      }),
    ]);
    prismaMock.user.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);

    const response = await service.getUsers({
      page: 1,
      pageSize: 20,
      sortBy: "createdAt",
      sortOrder: "desc",
    });

    expect(response.data.map((item) => item.status)).toEqual([
      "ACTIVE",
      "SUSPENDED",
      "DELETED",
    ]);
    expect(response.data[0].controls.guardMessage).toBe(
      "At least one active admin account must remain.",
    );
    expect(response.data[0].controls.canSuspend).toBe(false);
    expect(response.data[1].controls.canUnsuspend).toBe(true);
    expect(response.data[2].controls.canResetPassword).toBe(false);
  });

  it("rejects demoting the last active admin", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      buildManagedUser({
        id: "admin_abc123",
        role: UserRole.ADMIN,
      }),
    );
    prismaMock.user.count.mockResolvedValue(1);

    await expect(
      service.updateUserRole(
        "admin_abc123",
        { role: UserRole.USER },
        { userId: "admin_actor", role: UserRole.ADMIN },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("suspends and unsuspends eligible accounts", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(
      buildManagedUser({
        id: "user_active",
      }),
    );
    prismaMock.user.update.mockResolvedValueOnce({
      id: "user_active",
      role: UserRole.USER,
      suspendedAt: new Date("2026-04-15T03:45:00.000Z"),
      deletedAt: null,
      anonymizedAt: null,
    });

    const suspendResponse = await service.suspendUser(
      "user_active",
      {},
      { userId: "admin_actor", role: UserRole.ADMIN },
    );

    expect(suspendResponse.data.status).toBe("SUSPENDED");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user_active" },
        data: expect.objectContaining({
          suspendedAt: expect.any(Date),
        }),
      }),
    );

    prismaMock.user.findUnique.mockResolvedValueOnce(
      buildManagedUser({
        id: "user_active",
        suspendedAt: new Date("2026-04-15T03:40:00.000Z"),
      }),
    );
    prismaMock.user.update.mockResolvedValueOnce({
      id: "user_active",
      role: UserRole.USER,
      suspendedAt: null,
      deletedAt: null,
      anonymizedAt: null,
    });

    const unsuspendResponse = await service.unsuspendUser("user_active", {
      userId: "admin_actor",
      role: UserRole.ADMIN,
    });

    expect(unsuspendResponse.data.status).toBe("ACTIVE");
    expect(prismaMock.user.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "user_active" },
        data: { suspendedAt: null },
      }),
    );
  });

  it("returns a one-time temporary password while storing only the hash", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      buildManagedUser({
        id: "user_reset",
      }),
    );
    prismaMock.user.update.mockResolvedValue({ id: "user_reset" });

    const response = await service.resetPassword("user_reset", {
      userId: "admin_actor",
      role: UserRole.ADMIN,
    });

    const updatePayload = prismaMock.user.update.mock.calls[0][0].data;
    expect(response.data.userId).toBe("user_reset");
    expect(response.data.temporaryPassword).toHaveLength(16);
    expect(updatePayload.password).not.toBe(response.data.temporaryPassword);
    await expect(
      bcrypt.compare(response.data.temporaryPassword, updatePayload.password),
    ).resolves.toBe(true);
  });

  it("soft-deletes and anonymizes the user record in place", async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      buildManagedUser({
        id: "user_abc123",
        displayName: "Alice Nguyen",
        email: "alice@example.com",
      }),
    );
    prismaMock.user.update.mockResolvedValue({
      id: "user_abc123",
      role: UserRole.USER,
      suspendedAt: null,
      deletedAt: new Date("2026-04-15T03:45:00.000Z"),
      anonymizedAt: new Date("2026-04-15T03:45:00.000Z"),
    });

    const response = await service.deleteUser("user_abc123", {
      userId: "admin_actor",
      role: UserRole.ADMIN,
    });

    expect(response.data.status).toBe("DELETED");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user_abc123" },
        data: expect.objectContaining({
          email: null,
          phone: null,
          password: null,
          trustedDevice: null,
          kycStatus: null,
          displayName: "Deleted user abc123",
          deletedAt: expect.any(Date),
          anonymizedAt: expect.any(Date),
        }),
      }),
    );
  });
});

function buildManagedUser(overrides: Partial<any> = {}) {
  return {
    id: "user_001",
    email: "customer@example.com",
    phone: "0123456789",
    password: "$2b$04$abcdefghijklmnopqrstuv",
    displayName: "Customer Demo",
    role: UserRole.USER,
    kycStatus: "VERIFIED",
    trustedDevice: "device_001",
    suspendedAt: null,
    deletedAt: null,
    anonymizedAt: null,
    createdAt: new Date("2026-04-10T12:00:00.000Z"),
    updatedAt: new Date("2026-04-14T12:00:00.000Z"),
    ...overrides,
  };
}

function buildUserListRow(overrides: Partial<any> = {}) {
  return {
    ...buildManagedUser(overrides),
    _count: {
      reservations: 2,
      orders: 1,
    },
    orders: [{ _count: { tickets: 3 } }],
  };
}
