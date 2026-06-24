import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PlanType } from '@prisma/client';

export interface FeatureFlagDefinition {
  key: string;
  description: string;
  defaultValue: boolean;
  enabledPlans: PlanType[];
}

export const FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    key: 'knowledge_graph',
    description: 'Enables the AI Knowledge Graph Explorer',
    defaultValue: false,
    enabledPlans: [PlanType.PRO, PlanType.TEAM, PlanType.ENTERPRISE],
  },
  {
    key: 'tutor_agent',
    description: 'Enables the AI Tutor conversational agent',
    defaultValue: false,
    enabledPlans: [PlanType.PRO, PlanType.TEAM, PlanType.ENTERPRISE],
  },
  {
    key: 'analytics',
    description: 'Enables study analytics and performance metrics',
    defaultValue: false,
    enabledPlans: [PlanType.PRO, PlanType.TEAM, PlanType.ENTERPRISE],
  },
  {
    key: 'api_access',
    description: 'Enables API key provisioning and access to external API',
    defaultValue: false,
    enabledPlans: [PlanType.PRO, PlanType.TEAM, PlanType.ENTERPRISE],
  },
  {
    key: 'shared_workspace',
    description: 'Enables team collaboration and shared folders',
    defaultValue: false,
    enabledPlans: [PlanType.TEAM, PlanType.ENTERPRISE],
  },
  {
    key: 'sso',
    description: 'Enables SAML Single Sign-On integration',
    defaultValue: false,
    enabledPlans: [PlanType.ENTERPRISE],
  },
  {
    key: 'audit_logs',
    description: 'Enables enterprise-grade activity audit trails',
    defaultValue: false,
    enabledPlans: [PlanType.ENTERPRISE],
  },
];

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    await this.seedFeatureFlags();
  }

  /**
   * Seed feature flags in DB on startup
   */
  async seedFeatureFlags() {
    this.logger.log('Syncing feature flag catalog to database...');
    for (const flag of FEATURE_FLAGS) {
      await this.prisma.featureFlag.upsert({
        where: { key: flag.key },
        create: {
          key: flag.key,
          description: flag.description,
          defaultValue: flag.defaultValue,
          enabledPlans: flag.enabledPlans,
        },
        update: {
          description: flag.description,
          defaultValue: flag.defaultValue,
          enabledPlans: flag.enabledPlans,
        },
      });
    }
    this.logger.log('Feature flags synced ✓');
  }

  /**
   * Evaluates if a feature is enabled for an organization.
   * Uses Redis caching with a 5-minute TTL.
   */
  async isEnabled(organizationId: string, key: string): Promise<boolean> {
    const cacheKey = `feature_flag:${organizationId}:${key}`;
    const client = this.redis.getClient();

    // Check Redis cache first
    const cached = await client.get(cacheKey);
    if (cached !== null) {
      return cached === 'true';
    }

    // Resolve feature flag
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      this.logger.warn(`Feature flag key not found in catalog: ${key}`);
      return false;
    }

    // Check DB for custom tenant override
    const override = await this.prisma.tenantFeatureOverride.findUnique({
      where: {
        organizationId_featureFlagId: {
          organizationId,
          featureFlagId: flag.id,
        },
      },
    });

    let enabled = false;

    if (override !== null) {
      // Custom override exists
      enabled = override.enabled;
    } else {
      // Check org active subscription plan type
      const subscription = await this.prisma.subscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      });

      const planType = subscription ? (subscription.plan.type as PlanType) : PlanType.FREE;
      const allowedPlans = flag.enabledPlans as PlanType[];
      enabled = allowedPlans.includes(planType);
    }

    // Cache evaluation result in Redis for 5 minutes
    await client.set(cacheKey, enabled ? 'true' : 'false', 'EX', 300);

    return enabled;
  }

  /**
   * Set custom override for an organization feature flag.
   * Cleans cache afterward.
   */
  async setOverride(organizationId: string, key: string, enabled: boolean) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) throw new NotFoundException('Feature flag not found');

    await this.prisma.tenantFeatureOverride.upsert({
      where: {
        organizationId_featureFlagId: {
          organizationId,
          featureFlagId: flag.id,
        },
      },
      create: {
        organizationId,
        featureFlagId: flag.id,
        enabled,
      },
      update: {
        enabled,
      },
    });

    // Invalidate Redis cache
    const cacheKey = `feature_flag:${organizationId}:${key}`;
    await this.redis.getClient().del(cacheKey);

    return { success: true };
  }

  async removeOverride(organizationId: string, key: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) throw new NotFoundException('Feature flag not found');

    try {
      await this.prisma.tenantFeatureOverride.delete({
        where: {
          organizationId_featureFlagId: {
            organizationId,
            featureFlagId: flag.id,
          },
        },
      });
    } catch {}

    const cacheKey = `feature_flag:${organizationId}:${key}`;
    await this.redis.getClient().del(cacheKey);

    return { success: true };
  }

  async getOrganizationFlags(organizationId: string) {
    const flags = await this.prisma.featureFlag.findMany();
    const result: Record<string, boolean> = {};

    for (const flag of flags) {
      result[flag.key] = await this.isEnabled(organizationId, flag.key);
    }

    return result;
  }
}
