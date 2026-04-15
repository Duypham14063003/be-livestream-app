import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { AdminAccessGuard } from "../common/admin-access.guard";
import { AdminAuditLogsQueryDto } from "./dto/admin-audit-logs-query.dto";
import { AdminAuditService } from "./admin-audit.service";

@Controller("admin/audit-logs")
@UseGuards(JwtAuthGuard, AdminAccessGuard)
export class AdminAuditController {
  constructor(private readonly adminAuditService: AdminAuditService) {}

  @Get()
  getAuditLogs(@Query() query: AdminAuditLogsQueryDto) {
    return this.adminAuditService.getAuditLogs(query);
  }
}
