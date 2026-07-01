import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from './guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DataDeletionStatus } from '@prisma/client';
import { Response } from 'express';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/compliance')
export class AdminComplianceController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('compliance') private readonly complianceQueue: Queue,
  ) {}

  @Get('exports')
  async getExportRequests() {
    return this.prisma.dataExportRequest.findMany({
      orderBy: { requestedAt: 'desc' },
    });
  }

  @Get('deletions')
  async getDeletionRequests() {
    return this.prisma.dataDeletionRequest.findMany({
      orderBy: { requestedAt: 'desc' },
    });
  }

  @Delete('deletions/:requestId')
  async cancelDeletionRequest(@Param('requestId') requestId: string) {
    const deletionRequest = await this.prisma.dataDeletionRequest.findUnique({
      where: { id: requestId },
    });

    if (!deletionRequest) {
      throw new NotFoundException('Data deletion request not found.');
    }

    if (deletionRequest.status !== DataDeletionStatus.GRACE) {
      throw new BadRequestException(
        'This deletion request cannot be cancelled because it is not in the GRACE period.',
      );
    }

    // 1. Update DB status to CANCELLED
    await this.prisma.dataDeletionRequest.update({
      where: { id: requestId },
      data: { status: DataDeletionStatus.CANCELLED },
    });

    // 2. Remove the delayed job from BullMQ
    const job = await this.complianceQueue.getJob(`delete-account-${requestId}`);
    if (job) {
      await job.remove();
    }

    return {
      success: true,
      message: 'Account deletion request has been successfully cancelled by admin.',
    };
  }

  @Get('retention-policies')
  async getRetentionPolicies() {
    return this.prisma.retentionPolicy.findMany({
      include: { organization: true },
    });
  }

  @Post('retention-policies')
  async saveRetentionPolicy(
    @Body()
    body: {
      orgId: string;
      auditRetentionDays: number;
      dataRetentionDays: number;
    },
    @CurrentUser() adminUser: any,
  ) {
    const { orgId, auditRetentionDays, dataRetentionDays } = body;

    // Verify organization exists
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) {
      throw new NotFoundException(`Organization with ID ${orgId} not found.`);
    }

    return this.prisma.retentionPolicy.upsert({
      where: { orgId },
      update: {
        auditRetentionDays,
        dataRetentionDays,
        updatedBy: adminUser.id,
      },
      create: {
        orgId,
        auditRetentionDays,
        dataRetentionDays,
        updatedBy: adminUser.id,
      },
    });
  }

  @Get('audit-logs')
  async getAuditLogs(
    @Query('userId') userId?: string,
    @Query('actorType') actorType?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('orgId') orgId?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = 50;
    const where: any = {};

    if (userId) where.userId = userId;
    if (actorType) where.actorType = actorType as any;
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (resourceType) where.resourceType = resourceType;
    if (orgId) where.orgId = orgId;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const queryOptions: any = {
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
    };

    if (cursor) {
      queryOptions.skip = 1;
      queryOptions.cursor = { id: cursor };
    }

    const logs = await this.prisma.auditLog.findMany(queryOptions);
    const nextCursor = logs.length === limit ? logs[logs.length - 1].id : null;

    return {
      data: logs,
      nextCursor,
    };
  }

  @Get('audit-logs/export')
  async exportAuditLogs(
    @Res() res: Response,
    @Query('userId') userId?: string,
    @Query('actorType') actorType?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('orgId') orgId?: string,
  ) {
    const where: any = {};

    if (userId) where.userId = userId;
    if (actorType) where.actorType = actorType as any;
    if (action) where.action = { contains: action, mode: 'insensitive' };
    if (resourceType) where.resourceType = resourceType;
    if (orgId) where.orgId = orgId;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'id',
      'orgId',
      'userId',
      'actorId',
      'actorType',
      'action',
      'resourceType',
      'resourceId',
      'ip',
      'userAgent',
      'createdAt',
    ];

    const rows = logs.map((log) =>
      [
        log.id,
        log.orgId || '',
        log.userId || '',
        log.actorId,
        log.actorType,
        log.action,
        log.resourceType,
        log.resourceId || '',
        log.ip || '',
        `"${(log.userAgent || '').replace(/"/g, '""')}"`,
        log.createdAt.toISOString(),
      ].join(','),
    );

    const csvContent = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
    res.status(200).send(csvContent);
  }
}
