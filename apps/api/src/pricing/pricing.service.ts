import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OVERAGE_RATES } from './pricing.config';
import { PlanType, BillingCycle } from '@prisma/client';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate the estimated invoice for the current billing cycle of an organization.
   * Considers the base price plus calculated overage fees for tokens, documents, and API calls.
   */
  async calculateCurrentPeriodEstimate(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });

    if (!subscription) {
      return {
        basePriceUsdCents: 0,
        overageFeesUsdCents: 0,
        totalEstimatedUsdCents: 0,
        breakdown: {},
      };
    }

    const { plan, cycle } = subscription;
    const planType = plan.type as PlanType;
    const rates = OVERAGE_RATES[planType];

    const basePriceCents = cycle === BillingCycle.MONTHLY 
      ? plan.priceMonthlyUsdCents 
      : plan.priceYearlyUsdCents;

    // Retrieve monthly limits
    const maxTokens = plan.maxTokensPerMonth;
    const maxDocs = plan.maxDocuments;
    const maxStorageGb = plan.maxStorageGb;

    // Calculate Token Overage
    const tokensUsed = subscription.currentPeriodTokensUsed;
    let tokenOverageFeeCents = 0;
    let tokenOverage = 0;

    if (maxTokens !== null && tokensUsed > maxTokens) {
      tokenOverage = tokensUsed - maxTokens;
      tokenOverageFeeCents = Math.ceil((tokenOverage / 1000) * (rates.tokenOverageRateMicro / 10000));
    }

    // Calculate Document Overage
    // Fetch docs created in current period
    const docsCount = await this.prisma.document.count({
      where: {
        user: {
          organizationMemberships: {
            some: { organizationId },
          },
        },
        createdAt: {
          gte: subscription.currentPeriodStart,
          lte: subscription.currentPeriodEnd,
        },
      },
    });

    let docOverageFeeCents = 0;
    let docOverage = 0;
    if (maxDocs !== null && docsCount > maxDocs) {
      docOverage = docsCount - maxDocs;
      docOverageFeeCents = docOverage * rates.documentOverageRateCents;
    }

    // Calculate Storage Overage
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { storageUsedBytes: true },
    });
    const storageUsedBytes = Number(org?.storageUsedBytes || 0n);
    const storageUsedGb = storageUsedBytes / (1024 * 1024 * 1024);
    let storageOverageFeeCents = 0;
    let storageOverageGb = 0;

    if (maxStorageGb !== null && storageUsedGb > maxStorageGb) {
      storageOverageGb = storageUsedGb - maxStorageGb;
      storageOverageFeeCents = Math.ceil(storageOverageGb * rates.storageOverageRateCents);
    }

    // API Call Overage
    const apiCallsUsed = subscription.currentPeriodApiCallsUsed;
    const maxApiCalls = plan.maxApiCallsPerDay ? plan.maxApiCallsPerDay * 30 : null; // Estimate monthly limit
    let apiCallOverageFeeCents = 0;
    let apiCallOverage = 0;

    if (maxApiCalls !== null && apiCallsUsed > maxApiCalls) {
      apiCallOverage = apiCallsUsed - maxApiCalls;
      apiCallOverageFeeCents = Math.ceil(apiCallOverage * (rates.apiCallOverageRateMicro / 10000));
    }

    const totalOverageCents =
      tokenOverageFeeCents +
      docOverageFeeCents +
      storageOverageFeeCents +
      apiCallOverageFeeCents;

    return {
      basePriceUsdCents: basePriceCents,
      overageFeesUsdCents: totalOverageCents,
      totalEstimatedUsdCents: basePriceCents + totalOverageCents,
      breakdown: {
        tokens: {
          used: tokensUsed,
          limit: maxTokens,
          overage: tokenOverage,
          feeCents: tokenOverageFeeCents,
        },
        documents: {
          used: docsCount,
          limit: maxDocs,
          overage: docOverage,
          feeCents: docOverageFeeCents,
        },
        storage: {
          usedGb: parseFloat(storageUsedGb.toFixed(3)),
          limitGb: maxStorageGb,
          overageGb: parseFloat(storageOverageGb.toFixed(3)),
          feeCents: storageOverageFeeCents,
        },
        apiCalls: {
          used: apiCallsUsed,
          limit: maxApiCalls,
          overage: apiCallOverage,
          feeCents: apiCallOverageFeeCents,
        },
      },
    };
  }
}
