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
import { AdminUsersQueryDto } from "./dto/admin-users-query.dto";
import { SuspendUserDto } from "./dto/suspend-user.dto";
import { UpdateUserRoleDto } from "./dto/update-user-role.dto";
import { AdminUsersService } from "./admin-users.service";

@Controller("admin/users")
@UseGuards(JwtAuthGuard, AdminAccessGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminUsersService.getUsers(query);
  }

  @Get(":id")
  getUserDetail(@Param("id") id: string) {
    return this.adminUsersService.getUserDetail(id);
  }

  @Put(":id/role")
  updateUserRole(
    @Param("id") userId: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminUsersService.updateUserRole(userId, dto, user);
  }

  @Post(":id/suspend")
  suspendUser(
    @Param("id") userId: string,
    @Body() dto: SuspendUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminUsersService.suspendUser(userId, dto, user);
  }

  @Post(":id/unsuspend")
  unsuspendUser(@Param("id") userId: string, @CurrentUser() user: AuthUser) {
    return this.adminUsersService.unsuspendUser(userId, user);
  }

  @Post(":id/reset-password")
  resetPassword(@Param("id") userId: string, @CurrentUser() user: AuthUser) {
    return this.adminUsersService.resetPassword(userId, user);
  }

  @Delete(":id")
  deleteUser(@Param("id") userId: string, @CurrentUser() user: AuthUser) {
    return this.adminUsersService.deleteUser(userId, user);
  }
}
