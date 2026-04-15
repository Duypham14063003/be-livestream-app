import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LivestreamModule } from "../livestream/livestream.module";
import { PaymentsModule } from "../payments/payments.module";
import { ReservationsModule } from "../reservations/reservations.module";
import { SystemSettingsModule } from "../system-settings/system-settings.module";
import { TicketsModule } from "../tickets/tickets.module";
import { AdminAuditController } from "./audit/admin-audit.controller";
import { AdminAuditService } from "./audit/admin-audit.service";
import { AdminAuthController } from "./auth/admin-auth.controller";
import { AdminAuthService } from "./auth/admin-auth.service";
import { AdminAccessGuard } from "./common/admin-access.guard";
import { AdminDashboardController } from "./dashboard/admin-dashboard.controller";
import { AdminDashboardService } from "./dashboard/admin-dashboard.service";
import { AdminEventsController } from "./events/admin-events.controller";
import { AdminEventsService } from "./events/admin-events.service";
import { AdminLivestreamController } from "./livestream/admin-livestream.controller";
import { AdminLivestreamService } from "./livestream/admin-livestream.service";
import { AdminOperationsController } from "./operations/admin-operations.controller";
import { AdminOperationsService } from "./operations/admin-operations.service";
import { AdminReservationsController } from "./reservations/admin-reservations.controller";
import { AdminReservationsService } from "./reservations/admin-reservations.service";
import { AdminRefundsController } from "./refunds/admin-refunds.controller";
import { AdminRefundsService } from "./refunds/admin-refunds.service";
import { AdminUsersController } from "./users/admin-users.controller";
import { AdminUsersService } from "./users/admin-users.service";

@Module({
  imports: [
    AuthModule,
    PaymentsModule,
    LivestreamModule,
    ReservationsModule,
    SystemSettingsModule,
    TicketsModule,
  ],
  controllers: [
    AdminAuditController,
    AdminAuthController,
    AdminDashboardController,
    AdminUsersController,
    AdminEventsController,
    AdminLivestreamController,
    AdminOperationsController,
    AdminReservationsController,
    AdminRefundsController,
  ],
  providers: [
    AdminAuditService,
    AdminAuthService,
    AdminAccessGuard,
    AdminDashboardService,
    AdminUsersService,
    AdminEventsService,
    AdminLivestreamService,
    AdminOperationsService,
    AdminReservationsService,
    AdminRefundsService,
  ],
  exports: [AdminAccessGuard],
})
export class AdminModule {}
