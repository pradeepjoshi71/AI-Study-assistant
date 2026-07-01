import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  BadRequestException,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DataExportStatus, DataDeletionStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('compliance') private readonly complianceQueue: Queue,
  ) {}

  @Get('consent')
  async getConsent(@CurrentUser() user: any) {
    const userId = user.id;
    const result: Record<string, boolean> = {
      TERMS: false,
      PRIVACY: false,
      MARKETING: false,
    };

    for (const type of ['TERMS', 'PRIVACY', 'MARKETING']) {
      const record = await this.prisma.consentRecord.findFirst({
        where: { userId, consentType: type as any },
        orderBy: { createdAt: 'desc' },
      });
      result[type] = record ? record.accepted : false;
    }

    return result;
  }

  @Post('consent')
  async updateConsent(
    @CurrentUser() user: any,
    @Body() body: { consentType: string; accepted: boolean },
  ) {
    const userId = user.id;
    const { consentType, accepted } = body;

    if (!['TERMS', 'PRIVACY', 'MARKETING'].includes(consentType)) {
      throw new BadRequestException('Invalid consent type.');
    }

    const record = await this.prisma.consentRecord.create({
      data: {
        userId,
        consentType: consentType as any,
        version: '1.0',
        accepted,
      },
    });

    return { success: true, record };
  }

  @Get('export/status')
  async getExportStatus(@CurrentUser() user: any) {
    const userId = user.id;
    const latest = await this.prisma.dataExportRequest.findFirst({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });
    return latest || null;
  }

  @Get('delete-account/status')
  async getDeletionStatus(@CurrentUser() user: any) {
    const userId = user.id;
    const latest = await this.prisma.dataDeletionRequest.findFirst({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });
    return latest || null;
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  async requestDataExport(@CurrentUser() user: any) {
    const userId = user.id;

    // 1. Enforce export limits: max 1 request every 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentRequestsCount = await this.prisma.dataExportRequest.count({
      where: {
        userId,
        requestedAt: { gte: thirtyDaysAgo },
      },
    });

    if (recentRequestsCount > 0) {
      throw new BadRequestException(
        'You can only request a data export once every 30 days.',
      );
    }

    // 2. Resolve organization scope for non-nullable DB schema mapping
    let orgId = user.orgId;
    if (!orgId) {
      const membership = await this.prisma.orgMember.findFirst({
        where: { userId },
      });
      orgId = membership?.orgId || 'personal';
    }

    // 3. Create database tracking record
    const exportRequest = await this.prisma.dataExportRequest.create({
      data: {
        userId,
        orgId,
        status: DataExportStatus.PENDING,
        requestedAt: new Date(),
      },
    });

    // 4. Dispatch job to BullMQ compliance queue immediately (fire-and-forget)
    await this.complianceQueue.add('export-job', {
      userId,
      requestId: exportRequest.id,
      orgId,
      email: user.email,
    });

    return {
      success: true,
      requestId: exportRequest.id,
      message: 'Data export request submitted. You will receive an email with the download link once completed.',
    };
  }

  @Post('delete-account')
  @HttpCode(HttpStatus.OK)
  async requestAccountDeletion(@CurrentUser() user: any) {
    const userId = user.id;

    // Check if there's already a pending or grace request
    const existingRequest = await this.prisma.dataDeletionRequest.findFirst({
      where: {
        userId,
        status: { in: [DataDeletionStatus.PENDING, DataDeletionStatus.GRACE] },
      },
    });

    if (existingRequest) {
      throw new BadRequestException(
        'An account deletion request is already in progress or in its grace period.',
      );
    }

    // Resolve organization scope
    let orgId = user.orgId;
    if (!orgId) {
      const membership = await this.prisma.orgMember.findFirst({
        where: { userId },
      });
      orgId = membership?.orgId || 'personal';
    }

    // Grace period is exactly 30 days
    const gracePeriodDays = 30;
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + gracePeriodDays);

    const deletionRequest = await this.prisma.dataDeletionRequest.create({
      data: {
        userId,
        orgId,
        status: DataDeletionStatus.GRACE,
        scheduledAt,
      },
    });

    // Schedule delayed BullMQ job (30 days in milliseconds)
    const delayMs = gracePeriodDays * 24 * 60 * 60 * 1000;
    await this.complianceQueue.add(
      'delete-account-job',
      {
        userId,
        requestId: deletionRequest.id,
        email: user.email,
      },
      {
        delay: delayMs,
        jobId: `delete-account-${deletionRequest.id}`,
      },
    );

    return {
      success: true,
      requestId: deletionRequest.id,
      scheduledAt: scheduledAt.toISOString(),
      message: `Account deletion scheduled. Your account and all associated data will be permanently deleted after a 30-day grace period on ${scheduledAt.toDateString()}. You can cancel this request at any time before then.`,
    };
  }

  @Delete('delete-account/:requestId')
  async cancelAccountDeletion(
    @Param('requestId') requestId: string,
    @CurrentUser() user: any,
  ) {
    const userId = user.id;

    const deletionRequest = await this.prisma.dataDeletionRequest.findUnique({
      where: { id: requestId },
    });

    if (!deletionRequest || deletionRequest.userId !== userId) {
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
      message: 'Account deletion request has been successfully cancelled.',
    };
  }
}
