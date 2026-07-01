import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PlansService } from '../billing/plans.service';
import { ActorType } from '@prisma/client';

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
          orgId: organizationId,
          userId: actorId,
          actorId,
          actorType: ActorType.ADMIN,
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
          orgId: organizationId,
          userId: actorId,
          actorId,
          actorType: ActorType.ADMIN,
          action: 'organization.unsuspended',
          resourceType: 'organization',
          resourceId: organizationId,
          metadata: {},
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
    if (params.organizationId) where.orgId = params.organizationId;
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

  // ── Reseller Administration ────────────────────────────────────────────────

  async getResellers() {
    const resellers = await this.prisma.resellerAccount.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
          },
        },
      },
    });

    const enriched = await Promise.all(
      resellers.map(async (reseller) => {
        const tenants = await this.prisma.tenant.findMany({
          where: { resellerId: reseller.userId },
          include: { plan: true },
        });

        const tenantCount = tenants.length;
        const mrr = tenants
          .filter((t) => t.status === "ACTIVE")
          .reduce((sum, t) => sum + (t.plan?.price || 0), 0);

        return {
          userId: reseller.userId,
          name: reseller.user.name || reseller.user.email,
          email: reseller.user.email,
          stripeConnectId: reseller.stripeConnectId,
          commissionRate: reseller.commissionRate,
          isActive: reseller.user.isActive,
          tenantCount,
          mrr,
          createdAt: reseller.createdAt,
        };
      }),
    );

    return enriched;
  }

  async updateResellerCommission(userId: string, commissionRate: number) {
    return this.prisma.resellerAccount.update({
      where: { userId },
      data: { commissionRate },
    });
  }

  async toggleResellerSuspension(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("Reseller user not found");

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive },
    });

    return { id: updated.id, isActive: updated.isActive };
  }
}
