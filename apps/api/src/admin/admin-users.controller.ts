import {
  Controller,
  Get,
  Patch,
  Delete,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from './guards/admin.guard';
import { SuperAdmin } from './decorators/super-admin.decorator';
import { AdminUsersService } from './admin-users.service';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuditInterceptor } from '../audit/interceptors/audit.interceptor';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard, ThrottlerGuard)
@Throttle({ admin: { limit: 30, ttl: 60000 } })
@UseInterceptors(AuditInterceptor)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  // -- GET /admin/users   paginated list with filters -------------------------
  @Get()
  @SuperAdmin()
  listUsers(@Query() query: QueryUsersDto) {
    return this.adminUsersService.listUsers(query);
  }

  // -- GET /admin/users/:id   full profile + usage stats ----------------------
  @Get(':id')
  @SuperAdmin()
  getUserProfile(@Param('id') userId: string) {
    return this.adminUsersService.getUserProfile(userId);
  }

  // -- PATCH /admin/users/:id   update systemRole / status / plan -------------
  @Patch(':id')
  @SuperAdmin()
  updateUser(@Param('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.adminUsersService.updateUser(userId, dto);
  }

  // -- DELETE /admin/users/:id   soft delete + anonymize ----------------------
  @Delete(':id')
  @SuperAdmin()
  @HttpCode(HttpStatus.OK)
  softDeleteUser(@Param('id') userId: string) {
    return this.adminUsersService.softDeleteUser(userId);
  }

  // -- POST /admin/users/:id/impersonate   SUPER_ADMIN only, 15-min JWT -------
  @Post(':id/impersonate')
  @SuperAdmin()
  @HttpCode(HttpStatus.OK)
  impersonateUser(@Param('id') targetUserId: string, @Req() req: any) {
    const adminId: string = req.user.sub;
    return this.adminUsersService.impersonateUser(targetUserId, adminId);
  }

  // -- POST /admin/users/export   enqueue BullMQ CSV export -------------------
  @Post('export')
  @SuperAdmin()
  @HttpCode(HttpStatus.ACCEPTED)
  exportUsers(@Body() filters: QueryUsersDto, @Req() req: any) {
    const adminId: string = req.user.sub;
    return this.adminUsersService.enqueueExport(adminId, filters as any);
  }

  // -- GET /admin/users/export/:jobId   poll export job result ----------------
  @Get('export/:jobId')
  @SuperAdmin()
  getExportResult(@Param('jobId') jobId: string) {
    return this.adminUsersService.getExportResult(jobId);
  }
}
