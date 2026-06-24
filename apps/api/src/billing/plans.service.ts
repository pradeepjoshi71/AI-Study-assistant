import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType } from '@prisma/client';

// ─── Plan configuration table ─────────────────────────────────────────────────
// This is the single source of truth for plan limits.
// Keep in sync with Stripe product/price IDs in your Stripe dashboard.

export interface PlanConfig {
  type: PlanType;
  name: string;
  description: string;
  // Limits (null = unlimited)
  maxUsers: number | null;
  maxDocuments: number | null;
  maxStorageGb: number | null;
  maxChatsPerDay: number | null;
  maxApiCallsPerDay: number | null;
  maxTokensPerMonth: number | null;
  // Features
  features: string[];
  // Pricing (USD cents, 0 = free)
  priceMonthlyUsdCents: number;
  priceYearlyUsdCents: number;
  // Cost per unit (micro-cents = 1/1,000,000 USD)
  costPerTokenMicro: number;      // per 1000 tokens
  costPerDocumentCents: number;
  costPerApiCallMicro: number;
  costPerGbStorageCents: number;
}

export const PLAN_CONFIGS: Record<PlanType, PlanConfig> = {
  FREE: {
    type: PlanType.FREE,
    name: 'Free',
    description: 'Get started with AI-powered study tools',
    maxUsers: 1,
    maxDocuments: 5,
    maxStorageGb: 0.5,
    maxChatsPerDay: 10,
    maxApiCallsPerDay: 0,   // no API access on free
    maxTokensPerMonth: 50_000,
    features: ['chat', 'quiz', 'flashcard'],
    priceMonthlyUsdCents: 0,
    priceYearlyUsdCents: 0,
    costPerTokenMicro: 0,
    costPerDocumentCents: 0,
    costPerApiCallMicro: 0,
    costPerGbStorageCents: 0,
  },
  PRO: {
    type: PlanType.PRO,
    name: 'Pro',
    description: 'Unlimited study with advanced AI features',
    maxUsers: 1,
    maxDocuments: 100,
    maxStorageGb: 10,
    maxChatsPerDay: 100,
    maxApiCallsPerDay: 500,
    maxTokensPerMonth: 1_000_000,
    features: ['chat', 'quiz', 'flashcard', 'tutor_agent', 'knowledge_graph', 'analytics', 'api_access'],
    priceMonthlyUsdCents: 1900,  // $19/mo
    priceYearlyUsdCents: 19000,  // $190/yr (2 months free)
    costPerTokenMicro: 2,        // $0.000002 per token overage
    costPerDocumentCents: 10,    // $0.10 per doc overage
    costPerApiCallMicro: 100,
    costPerGbStorageCents: 25,
  },
  TEAM: {
    type: PlanType.TEAM,
    name: 'Team',
    description: 'Collaborative study for teams up to 25',
    maxUsers: 25,
    maxDocuments: 1000,
    maxStorageGb: 100,
    maxChatsPerDay: 1000,
    maxApiCallsPerDay: 5000,
    maxTokensPerMonth: 10_000_000,
    features: ['chat', 'quiz', 'flashcard', 'tutor_agent', 'knowledge_graph', 'analytics', 'api_access', 'shared_workspace', 'team_analytics'],
    priceMonthlyUsdCents: 9900,   // $99/mo
    priceYearlyUsdCents: 95000,   // $950/yr
    costPerTokenMicro: 1,
    costPerDocumentCents: 5,
    costPerApiCallMicro: 50,
    costPerGbStorageCents: 15,
  },
  ENTERPRISE: {
    type: PlanType.ENTERPRISE,
    name: 'Enterprise',
    description: 'Unlimited scale with SLA, SSO, and dedicated support',
    maxUsers: null,           // unlimited
    maxDocuments: null,
    maxStorageGb: null,
    maxChatsPerDay: null,     // soft limit via rate limiting
    maxApiCallsPerDay: null,
    maxTokensPerMonth: null,
    features: ['chat', 'quiz', 'flashcard', 'tutor_agent', 'knowledge_graph', 'analytics', 'api_access', 'shared_workspace', 'team_analytics', 'sso', 'audit_logs', 'custom_models', 'dedicated_support'],
    priceMonthlyUsdCents: 0,   // custom pricing — contact sales
    priceYearlyUsdCents: 0,
    costPerTokenMicro: 0,
    costPerDocumentCents: 0,
    costPerApiCallMicro: 0,
    costPerGbStorageCents: 0,
  },
};

@Injectable()
export class PlansService implements OnModuleInit {
  private readonly logger = new Logger(PlansService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedPlans();
  }

  /**
   * Seed/sync plan definitions to DB on startup.
   * Uses upsert — safe to run on every deploy.
   */
  async seedPlans() {
    this.logger.log('Syncing plan configurations to database...');
    for (const config of Object.values(PLAN_CONFIGS)) {
      await this.prisma.plan.upsert({
        where: { type: config.type },
        create: {
          name: config.name,
          type: config.type,
          description: config.description,
          maxUsers: config.maxUsers,
          maxDocuments: config.maxDocuments,
          maxStorageGb: config.maxStorageGb,
          maxChatsPerDay: config.maxChatsPerDay,
          maxApiCallsPerDay: config.maxApiCallsPerDay,
          maxTokensPerMonth: config.maxTokensPerMonth,
          priceMonthlyUsdCents: config.priceMonthlyUsdCents,
          priceYearlyUsdCents: config.priceYearlyUsdCents,
          costPerTokenMicro: config.costPerTokenMicro,
          costPerDocumentCents: config.costPerDocumentCents,
          costPerApiCallMicro: config.costPerApiCallMicro,
          costPerGbStorageCents: config.costPerGbStorageCents,
        },
        update: {
          name: config.name,
          description: config.description,
          maxUsers: config.maxUsers,
          maxDocuments: config.maxDocuments,
          maxStorageGb: config.maxStorageGb,
          maxChatsPerDay: config.maxChatsPerDay,
          maxApiCallsPerDay: config.maxApiCallsPerDay,
          maxTokensPerMonth: config.maxTokensPerMonth,
          priceMonthlyUsdCents: config.priceMonthlyUsdCents,
          priceYearlyUsdCents: config.priceYearlyUsdCents,
        },
      });
    }
    this.logger.log('Plans synced ✓');
  }

  async findAll() {
    return this.prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceMonthlyUsdCents: 'asc' } });
  }

  async findByType(type: PlanType) {
    return this.prisma.plan.findUnique({ where: { type } });
  }

  getPlanConfig(type: PlanType): PlanConfig {
    return PLAN_CONFIGS[type];
  }
}
