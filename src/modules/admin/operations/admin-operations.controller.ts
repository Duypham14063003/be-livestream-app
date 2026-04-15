import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { AuthUser } from "../../auth/interfaces/auth-user.interface";
import { AdminAccessGuard } from "../common/admin-access.guard";
import { AdminOperationsService } from "./admin-operations.service";
import { CancelAdminOrderDto } from "./dto/cancel-admin-order.dto";
import { CreateManualOrderDto } from "./dto/create-manual-order.dto";
import {
  AdminOrdersQueryDto,
  AdminPaymentsQueryDto,
  AdminRefundsQueryDto,
  AdminTicketsQueryDto,
} from "./dto/admin-operations-query.dto";
import { ReplaceManualOrderSeatsDto } from "./dto/replace-manual-order-seats.dto";
import { UpdateManualPendingSettingDto } from "./dto/update-manual-pending-setting.dto";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { UpdatePaymentStatusDto } from "./dto/update-payment-status.dto";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { UpdateTicketStatusDto } from "./dto/update-ticket-status.dto";
import { VoidTicketDto } from "./dto/void-ticket.dto";

@Controller("admin")
@UseGuards(JwtAuthGuard, AdminAccessGuard)
export class AdminOperationsController {
  constructor(
    private readonly adminOperationsService: AdminOperationsService,
  ) {}

  @Get("orders/settings/manual-pending")
  getManualPendingSetting() {
    return this.adminOperationsService.getManualPendingSetting();
  }

  @Put("orders/settings/manual-pending")
  updateManualPendingSetting(
    @Body() dto: UpdateManualPendingSettingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.updateManualPendingSetting(
      dto,
      user.userId,
    );
  }

  @Post("orders")
  createManualOrder(
    @Body() dto: CreateManualOrderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.createManualOrder(dto, user.userId);
  }

  @Get("orders")
  getOrders(@Query() query: AdminOrdersQueryDto) {
    return this.adminOperationsService.getOrders(query);
  }

  @Get("orders/:id")
  getOrderDetail(@Param("id") id: string) {
    return this.adminOperationsService.getOrderDetail(id);
  }

  @Put("orders/:orderId/seats")
  replaceManualOrderSeats(
    @Param("orderId") orderId: string,
    @Body() dto: ReplaceManualOrderSeatsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.replaceManualOrderSeats(
      orderId,
      dto,
      user.userId,
    );
  }

  @Post("orders/:orderId/cancel")
  cancelOrder(
    @Param("orderId") orderId: string,
    @Body() dto: CancelAdminOrderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.cancelOrder(orderId, dto, user.userId);
  }

  @Delete("orders/:orderId")
  deletePendingOrder(
    @Param("orderId") orderId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.deletePendingOrder(orderId, user.userId);
  }

  @Get("payments")
  getPayments(@Query() query: AdminPaymentsQueryDto) {
    return this.adminOperationsService.getPayments(query);
  }

  @Post("payments")
  createManualPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.createManualPayment(dto, user.userId);
  }

  @Put("payments/:paymentId/status")
  updatePaymentStatus(
    @Param("paymentId") paymentId: string,
    @Body() dto: UpdatePaymentStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.updatePaymentStatus(paymentId, dto, user.userId);
  }

  @Post("payments/:paymentId/retry")
  retryPayment(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.retryPayment(paymentId, user.userId);
  }

  @Delete("payments/:paymentId")
  deletePayment(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.deletePayment(paymentId, user.userId);
  }

  @Post("tickets")
  createTicket(
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.createTicket(dto, user.userId);
  }

  @Put("tickets/:ticketId/status")
  updateTicketStatus(
    @Param("ticketId") ticketId: string,
    @Body() dto: UpdateTicketStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.updateTicketStatus(ticketId, dto, user.userId);
  }

  @Post("tickets/:ticketId/void")
  voidTicket(
    @Param("ticketId") ticketId: string,
    @Body() dto: VoidTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.voidTicket(ticketId, dto, user.userId);
  }

  @Post("tickets/:ticketId/resend")
  resendTicket(
    @Param("ticketId") ticketId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.resendTicket(ticketId, user.userId);
  }

  @Delete("tickets/:ticketId")
  deleteTicket(
    @Param("ticketId") ticketId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminOperationsService.deleteTicket(ticketId, user.userId);
  }

  @Get("refunds")
  getRefunds(@Query() query: AdminRefundsQueryDto) {
    return this.adminOperationsService.getRefunds(query);
  }

  @Get("tickets")
  getTickets(@Query() query: AdminTicketsQueryDto) {
    return this.adminOperationsService.getTickets(query);
  }

  @Get("tickets/:id")
  getTicketDetail(@Param("id") id: string) {
    return this.adminOperationsService.getTicketDetail(id);
  }

  @Get("tickets/:id/document")
  getTicketDocument(@Param("id") id: string) {
    return this.adminOperationsService.getTicketDocument(id);
  }
}
