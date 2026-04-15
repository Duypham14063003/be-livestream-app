import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import {
  deriveAccountStatus,
  isAccountActive,
  type AccountStatus,
} from "../../auth/account-state";
import { AuthUser } from "../../auth/interfaces/auth-user.interface";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  buildAdminListMeta,
  normalizeAdminListQuery,
  type NormalizedAdminListQuery,
} from "../common/admin-listing";
import { AdminUsersQueryDto } from "./dto/admin-users-query.dto";
import { SuspendUserDto } from "./dto/suspend-user.dto";
import { UpdateUserRoleDto } from "./dto/update-user-role.dto";

const USERS_SORT_FIELDS = ["createdAt", "displayName", "role"] as const;
const ACCOUNT_STATUS_VALUES = ["ACTIVE", "SUSPENDED", "DELETED"] as const;

type UsersSortField = (typeof USERS_SORT_FIELDS)[number];
type AccountStatusValue = (typeof ACCOUNT_STATUS_VALUES)[number];
type ManagedUserRecord = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    phone: true;
    password: true;
    displayName: true;
    role: true;
    kycStatus: true;
    trustedDevice: true;
    suspendedAt: true;
    deletedAt: true;
    anonymizedAt: true;
    createdAt: true;
    updatedAt: true;
  };
}>;
type UserLifecycleRecord = Pick<
  ManagedUserRecord,
  "id" | "role" | "suspendedAt" | "deletedAt" | "anonymizedAt"
>;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getUsers(query: AdminUsersQueryDto) {
    const listing = normalizeAdminListQuery(query, {
      allowedSortBy: USERS_SORT_FIELDS,
      defaultSortBy: "createdAt",
      defaultSortOrder: "desc",
    });
    const where: Prisma.UserWhereInput = {
      role: query.role && this.isUserRole(query.role) ? query.role : undefined,
      ...this.buildStatusWhere(query.status),
      ...(query.search
        ? {
            OR: [
              {
                id: {
                  contains: query.search,
                },
              },
              {
                displayName: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                email: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                phone: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };

    const [users, total, activeAdminCount] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: this.buildUsersOrderBy(listing),
        skip: listing.skip,
        take: listing.take,
        include: {
          _count: {
            select: {
              reservations: true,
              orders: true,
            },
          },
          orders: {
            select: {
              _count: {
                select: {
                  tickets: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
      this.countActiveAdmins(),
    ]);

    return {
      data: users.map((user) => ({
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: deriveAccountStatus(user),
        suspendedAt: user.suspendedAt?.toISOString() ?? null,
        deletedAt: user.deletedAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        ordersCount: user._count.orders,
        reservationsCount: user._count.reservations,
        ticketsCount: user.orders.reduce(
          (sum, order) => sum + order._count.tickets,
          0,
        ),
        controls: this.buildControls(user, activeAdminCount),
      })),
      meta: buildAdminListMeta(total, listing),
    };
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        phone: true,
        role: true,
        suspendedAt: true,
        deletedAt: true,
        anonymizedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User was not found.");
    }

    const [
      orders,
      tickets,
      reservationsCount,
      activeParticipations,
      liveParticipations,
      ordersCount,
      ticketsCount,
      totalSpentAggregate,
      activeAdminCount,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          userId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
        include: {
          reservation: {
            include: {
              event: true,
            },
          },
        },
      }),
      this.prisma.ticket.findMany({
        where: {
          order: {
            userId,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
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
      }),
      this.prisma.reservation.count({
        where: { userId },
      }),
      this.prisma.liveParticipant.count({
        where: {
          userId,
          leftAt: null,
        },
      }),
      this.prisma.liveParticipant.findMany({
        where: {
          userId,
        },
        orderBy: {
          joinedAt: "desc",
        },
        take: 5,
        include: {
          room: true,
        },
      }),
      this.prisma.order.count({
        where: {
          userId,
        },
      }),
      this.prisma.ticket.count({
        where: {
          order: {
            userId,
          },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          userId,
          status: {
            in: ["PAID", "REFUND_PENDING", "REFUNDED"],
          },
        },
        _sum: {
          amount: true,
        },
      }),
      this.countActiveAdmins(),
    ]);

    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: deriveAccountStatus(user),
        suspendedAt: user.suspendedAt?.toISOString() ?? null,
        deletedAt: user.deletedAt?.toISOString() ?? null,
        anonymizedAt: user.anonymizedAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      controls: this.buildControls(user, activeAdminCount),
      stats: {
        reservationsCount,
        ordersCount,
        ticketsCount,
        totalSpent: totalSpentAggregate._sum.amount ?? 0,
        activeParticipations,
      },
      recentOrders: orders.map((order) => ({
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        eventTitle: order.reservation.event.title,
        createdAt: order.createdAt.toISOString(),
      })),
      recentTickets: tickets.map((ticket) => ({
        id: ticket.id,
        seatLabel: `${ticket.seat.zone}-${ticket.seat.row}-${ticket.seat.number}`,
        status: ticket.status,
        eventTitle: ticket.order.reservation.event.title,
        createdAt: ticket.createdAt.toISOString(),
      })),
      liveParticipations: liveParticipations.map((entry) => ({
        roomId: entry.roomId,
        roomTitle: entry.room.title,
        role: entry.role,
        joinedAt: entry.joinedAt.toISOString(),
        leftAt: entry.leftAt?.toISOString() ?? null,
      })),
    };
  }

  async updateUserRole(
    userId: string,
    dto: UpdateUserRoleDto,
    authUser: AuthUser,
  ) {
    const user = await this.findManageableUserOrThrow(userId);
    this.ensureNotDeleted(user);
    await this.ensureActiveAdminContinuity(user, {
      nextRole: dto.role,
    });

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        role: dto.role,
      },
      select: {
        id: true,
        role: true,
        suspendedAt: true,
        deletedAt: true,
        anonymizedAt: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_USER_ROLE_UPDATED",
        entityType: "user",
        entityId: userId,
        payload: {
          adminId: authUser.userId,
          previousRole: user.role,
          nextRole: dto.role,
        },
      },
    });

    return {
      data: {
        id: updatedUser.id,
        role: updatedUser.role,
        status: deriveAccountStatus(updatedUser),
      },
    };
  }

  async suspendUser(userId: string, dto: SuspendUserDto, authUser: AuthUser) {
    const user = await this.findManageableUserOrThrow(userId);
    this.ensureNotDeleted(user);

    if (user.suspendedAt) {
      throw new BadRequestException("This account is already suspended.");
    }

    await this.ensureActiveAdminContinuity(user, { suspend: true });

    const suspendedAt = new Date();
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        suspendedAt,
      },
      select: {
        id: true,
        role: true,
        suspendedAt: true,
        deletedAt: true,
        anonymizedAt: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_USER_SUSPENDED",
        entityType: "user",
        entityId: userId,
        payload: {
          adminId: authUser.userId,
          reason: dto.reason?.trim() || null,
          suspendedAt,
        },
      },
    });

    return {
      data: {
        id: updatedUser.id,
        status: deriveAccountStatus(updatedUser),
      },
    };
  }

  async unsuspendUser(userId: string, authUser: AuthUser) {
    const user = await this.findManageableUserOrThrow(userId);
    this.ensureNotDeleted(user);

    if (!user.suspendedAt) {
      throw new BadRequestException("This account is not suspended.");
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        suspendedAt: null,
      },
      select: {
        id: true,
        role: true,
        suspendedAt: true,
        deletedAt: true,
        anonymizedAt: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_USER_UNSUSPENDED",
        entityType: "user",
        entityId: userId,
        payload: {
          adminId: authUser.userId,
        },
      },
    });

    return {
      data: {
        id: updatedUser.id,
        status: deriveAccountStatus(updatedUser),
      },
    };
  }

  async resetPassword(userId: string, authUser: AuthUser) {
    const user = await this.findManageableUserOrThrow(userId);
    this.ensureNotDeleted(user);

    const temporaryPassword = this.generateTemporaryPassword();
    const saltRounds = Number(
      this.configService.get<string>("BCRYPT_SALT_ROUNDS") ?? 10,
    );
    const hashedPassword = await bcrypt.hash(temporaryPassword, saltRounds);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_USER_PASSWORD_RESET",
        entityType: "user",
        entityId: userId,
        payload: {
          adminId: authUser.userId,
          resetAt: new Date(),
        },
      },
    });

    return {
      data: {
        userId,
        temporaryPassword,
      },
    };
  }

  async deleteUser(userId: string, authUser: AuthUser) {
    const user = await this.findManageableUserOrThrow(userId);
    this.ensureNotDeleted(user);
    await this.ensureActiveAdminContinuity(user, { delete: true });

    const deletedAt = new Date();
    const anonymizedDisplayName = `Deleted user ${user.id.slice(-6)}`;

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        email: null,
        phone: null,
        password: null,
        displayName: anonymizedDisplayName,
        trustedDevice: null,
        kycStatus: null,
        deletedAt,
        anonymizedAt: deletedAt,
      },
      select: {
        id: true,
        role: true,
        suspendedAt: true,
        deletedAt: true,
        anonymizedAt: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: "ADMIN_USER_DELETED",
        entityType: "user",
        entityId: userId,
        payload: {
          adminId: authUser.userId,
          deletedAt,
        },
      },
    });

    return {
      data: {
        id: updatedUser.id,
        status: deriveAccountStatus(updatedUser),
      },
    };
  }

  private isUserRole(role: string): role is UserRole {
    return Object.values(UserRole).includes(role as UserRole);
  }

  private isAccountStatusValue(status: string): status is AccountStatusValue {
    return ACCOUNT_STATUS_VALUES.includes(status as AccountStatusValue);
  }

  private buildStatusWhere(status?: string): Prisma.UserWhereInput {
    if (!status || !this.isAccountStatusValue(status)) {
      return {};
    }

    switch (status) {
      case "DELETED":
        return {
          deletedAt: {
            not: null,
          },
        };
      case "SUSPENDED":
        return {
          deletedAt: null,
          suspendedAt: {
            not: null,
          },
        };
      default:
        return {
          deletedAt: null,
          suspendedAt: null,
        };
    }
  }

  private buildUsersOrderBy(
    query: NormalizedAdminListQuery<UsersSortField>,
  ): Prisma.UserOrderByWithRelationInput[] {
    switch (query.sortBy) {
      case "displayName":
        return [
          { displayName: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      case "role":
        return [
          { role: query.sortOrder },
          { createdAt: "desc" },
          { id: "desc" },
        ];
      default:
        return [{ createdAt: query.sortOrder }, { id: "desc" }];
    }
  }

  private buildControls(user: UserLifecycleRecord, activeAdminCount: number) {
    const status = deriveAccountStatus(user);
    const guardMessage = this.getAdminContinuityGuardMessage(
      user,
      activeAdminCount,
    );

    return {
      canChangeRole: status !== "DELETED" && !guardMessage,
      canSuspend: status === "ACTIVE" && !guardMessage,
      canUnsuspend: status === "SUSPENDED",
      canResetPassword: status !== "DELETED",
      canDelete: status !== "DELETED" && !guardMessage,
      guardMessage,
    };
  }

  private getAdminContinuityGuardMessage(
    user: UserLifecycleRecord,
    activeAdminCount: number,
  ): string | null {
    const isProtectedAdmin =
      user.role === UserRole.ADMIN &&
      isAccountActive(user) &&
      activeAdminCount <= 1;

    if (!isProtectedAdmin) {
      return null;
    }

    return "At least one active admin account must remain.";
  }

  private async findManageableUserOrThrow(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        password: true,
        displayName: true,
        role: true,
        kycStatus: true,
        trustedDevice: true,
        suspendedAt: true,
        deletedAt: true,
        anonymizedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User was not found.");
    }

    return user;
  }

  private ensureNotDeleted(user: UserLifecycleRecord) {
    if (user.deletedAt) {
      throw new BadRequestException("Deleted accounts cannot be changed.");
    }
  }

  private async ensureActiveAdminContinuity(
    user: UserLifecycleRecord,
    options: { nextRole?: UserRole; suspend?: boolean; delete?: boolean },
  ) {
    const nextRole = options.nextRole ?? user.role;
    const currentlyActiveAdmin =
      user.role === UserRole.ADMIN && deriveAccountStatus(user) === "ACTIVE";
    const remainsActiveAdmin =
      !options.suspend && !options.delete && nextRole === UserRole.ADMIN;

    if (!currentlyActiveAdmin || remainsActiveAdmin) {
      return;
    }

    const activeAdminCount = await this.countActiveAdmins();
    if (activeAdminCount <= 1) {
      throw new BadRequestException(
        "At least one active admin account must remain.",
      );
    }
  }

  private countActiveAdmins() {
    return this.prisma.user.count({
      where: {
        role: UserRole.ADMIN,
        suspendedAt: null,
        deletedAt: null,
      },
    });
  }

  private generateTemporaryPassword() {
    return randomBytes(12).toString("base64url").slice(0, 16);
  }
}
