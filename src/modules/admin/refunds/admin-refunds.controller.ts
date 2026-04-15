import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { AuthUser } from "../../auth/interfaces/auth-user.interface";
import { AdminAccessGuard } from "../common/admin-access.guard";
import { ApproveRefundDto } from "./dto/approve-refund.dto";
import { RejectRefundDto } from "./dto/reject-refund.dto";
import { AdminRefundsService } from "./admin-refunds.service";

@Controller("admin/refunds")
@UseGuards(JwtAuthGuard, AdminAccessGuard)
export class AdminRefundsController {
  constructor(private readonly adminRefundsService: AdminRefundsService) {}

  @Post(":id/approve")
  approveRefund(
    @Param("id") refundId: string,
    @Body() dto: ApproveRefundDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminRefundsService.approveRefund(
      refundId,
      user.userId,
      dto.decisionNote,
    );
  }

  @Post(":id/reject")
  rejectRefund(
    @Param("id") refundId: string,
    @Body() dto: RejectRefundDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminRefundsService.rejectRefund(
      refundId,
      user.userId,
      dto.decisionNote,
    );
  }
}
