import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from './guards/admin.guard';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { SuperAdmin } from './decorators/super-admin.decorator';
import { OrgAdmin } from './decorators/org-admin.decorator';
import { AuditInterceptor } from '../audit/interceptors/audit.interceptor';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

class SuspendOrgDto {
  @IsString()
  reason!: string;
}

class QueryOrgsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}

class QueryAuditLogsDto {
  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard, ThrottlerGuard)
@Throttle({ admin: { limit: 30, ttl: 60000 } })
@UseInterceptors(AuditInterceptor)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('organizations')
  @SuperAdmin()
  getOrganizations(@Query() query: QueryOrgsDto) {
    return this.adminService.getOrganizations(query.page, query.limit);
  }

  @Post('organizations/:id/suspend')
  @OrgAdmin()
  suspendOrganization(
    @Param('id') organizationId: string,
    @Body() dto: SuspendOrgDto,
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    return this.adminService.suspendOrganization(organizationId, dto.reason, actorId);
  }

  @Post('organizations/:id/unsuspend')
  @OrgAdmin()
  unsuspendOrganization(
    @Param('id') organizationId: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    return this.adminService.unsuspendOrganization(organizationId, actorId);
  }

  @Get('metrics')
  @SuperAdmin()
  getSystemMetrics() {
    return this.adminService.getSystemMetrics();
  }

  @Get('audit-logs')
  async getAuditLogs(@Query() query: QueryAuditLogsDto) {
    return this.adminService.getAuditLogs({
      organizationId: query.organizationId,
      actorId: query.actorId,
      page: query.page,
      limit: query.limit,
    });
  }

  // ── Reseller Administration ────────────────────────────────────────────────

  @Get('resellers')
  @SuperAdmin()
  async getResellers() {
    return this.adminService.getResellers();
  }

  @Patch('resellers/:id/commission')
  @SuperAdmin()
  async updateCommission(
    @Param('id') userId: string,
    @Body('commissionRate') commissionRate: number,
  ) {
    return this.adminService.updateResellerCommission(userId, commissionRate);
  }

  @Patch('resellers/:id/suspend')
  @SuperAdmin()
  async suspendReseller(@Param('id') userId: string) {
    return this.adminService.toggleResellerSuspension(userId);
  }
}
