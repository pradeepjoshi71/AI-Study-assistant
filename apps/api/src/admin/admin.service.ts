import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PlansService } from '../billing/plans.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly plans: PlansService,
  ) {}

  // ─── Tenant Suspension ─────────────────────────────────────

  async suspendOrganization(organizationId: string, reason: string, actorId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');

    await this.prisma.$transaction([
      this.prisma.organization.update({
        where: { id: organizationId },
        data: { isSuspended: true, suspendedReason: reason },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId,
          actorId,
          actorType: 'admin',
          action: 'organization.suspended',
          resourceType: 'organization',
          resourceId: organizationId,
          metadata: { reason },
        },
      }),
    ]);

    this.logger.warn(`Organization ${organizationId} suspended by admin ${actorId}. Reason: ${reason}`);
    return { success: true };
  }

  async unsuspendOrganization(organizationId: string, actorId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');

    await this.prisma.$transaction([
      this.prisma.organization.update({
        where: { id: organizationId },
        data: { isSuspended: false, suspendedReason: null },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId,
          actorId,
          actorType: 'admin',
          action: 'organization.unsuspended',
          resourceType: 'organization',
          resourceId: organizationId,
        },
      }),
    ]);

    this.logger.log(`Organization ${organizationId} unsuspended by admin ${actorId}`);
    return { success: true };
  }

  // ─── Tenant Querying ──────────────────────────────────────

  async getOrganizations(page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [total, items] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.findMany({
        skip,
        take: limit,
        include: {
          subscription: {
            include: { plan: true },
          },
          _count: {
            select: { members: true, apiKeys: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { total, page, limit, items };
  }

  // ─── System Observability & Abuse Detection ──────────────

  async getSystemMetrics() {
    const [
      totalOrgs,
      activeSubs,
      totalEvents,
      tokenSums,
      recentAuditLogs,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.usageEvent.count(),
      this.prisma.usageEvent.aggregate({
        _sum: { tokensIn: true, tokensOut: true, costUsdMicro: true },
      }),
      this.prisma.auditLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Simple Abuse detection: identify orgs with excessive failed API keys calls
    const abuseLogs = await this.prisma.apiUsageLog.groupBy({
      by: ['apiKeyId'],
      where: { statusCode: { gte: 400 } },
      _count: true,
      orderBy: { _count: { apiKeyId: 'desc' } },
      take: 5,
    });

    const potentialAbuseKeys = await Promise.all(
      abuseLogs.map(async (log) => {
        const key = await this.prisma.apiKey.findUnique({
          where: { id: log.apiKeyId },
          include: { organization: true },
        });
        return {
          apiKeyPrefix: key?.keyPrefix,
          organizationName: key?.organization.name,
          organizationId: key?.organization.id,
          failedRequests: log._count,
        };
      }),
    );

    return {
      totals: {
        organizations: totalOrgs,
        activeSubscriptions: activeSubs,
        rawUsageEventsCount: totalEvents,
        totalTokensConsumed: (tokenSums._sum.tokensIn || 0) + (tokenSums._sum.tokensOut || 0),
        totalEstimatedCostUsd: (tokenSums._sum.costUsdMicro || 0) / 1000000,
      },
      abuseIndicators: {
        potentialAbuseKeys,
      },
      recentAuditLogs,
    };
  }

  // ─── Audit Log Queries ─────────────────────────────────────

  async getAuditLogs(params: {
    organizationId?: string;
    actorId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (params.organizationId) where.organizationId = params.organizationId;
    if (params.actorId) where.actorId = params.actorId;

    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { total, page, limit, items };
  }
}
