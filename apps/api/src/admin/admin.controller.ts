import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('organizations')
  getOrganizations(@Query() query: QueryOrgsDto) {
    return this.adminService.getOrganizations(query.page, query.limit);
  }

  @Post('organizations/:id/suspend')
  suspendOrganization(
    @Param('id') organizationId: string,
    @Body() dto: SuspendOrgDto,
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    return this.adminService.suspendOrganization(organizationId, dto.reason, actorId);
  }

  @Post('organizations/:id/unsuspend')
  unsuspendOrganization(
    @Param('id') organizationId: string,
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    return this.adminService.unsuspendOrganization(organizationId, actorId);
  }

  @Get('metrics')
  getSystemMetrics() {
    return this.adminService.getSystemMetrics();
  }

  @Get('audit-logs')
  getAuditLogs(@Query() query: QueryAuditLogsDto) {
    return this.adminService.getAuditLogs({
      organizationId: query.organizationId,
      actorId: query.actorId,
      page: query.page,
      limit: query.limit,
    });
  }
}
