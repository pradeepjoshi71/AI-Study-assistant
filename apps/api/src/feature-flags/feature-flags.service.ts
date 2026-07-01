import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface FeatureFlagDefinition {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  targetOrgIds: string[];
}

export const FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    key: 'knowledge_graph',
    enabled: true,
    rolloutPercent: 100,
    targetOrgIds: [],
  },
  {
    key: 'tutor_agent',
    enabled: true,
    rolloutPercent: 100,
    targetOrgIds: [],
  },
  {
    key: 'analytics',
    enabled: true,
    rolloutPercent: 100,
    targetOrgIds: [],
  },
  {
    key: 'api_access',
    enabled: true,
    rolloutPercent: 100,
    targetOrgIds: [],
  },
  {
    key: 'shared_workspace',
    enabled: true,
    rolloutPercent: 100,
    targetOrgIds: [],
  },
  {
    key: 'sso',
    enabled: true,
    rolloutPercent: 100,
    targetOrgIds: [],
  },
  {
    key: 'audit_logs',
    enabled: true,
    rolloutPercent: 100,
    targetOrgIds: [],
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
          enabled: flag.enabled,
          rolloutPercent: flag.rolloutPercent,
          targetOrgIds: flag.targetOrgIds,
        },
        update: {
          enabled: flag.enabled,
          rolloutPercent: flag.rolloutPercent,
          targetOrgIds: flag.targetOrgIds,
        },
      });
    }
    this.logger.log('Feature flags synced ✓');
  }

  /**
   * Evaluates whether a feature flag is enabled for a specific user+org context.
   *
   * Cache strategy: stores the flag definition (not evaluation) under `flag:{key}`
   * with a 5-minute TTL so writes via AdminFlagsService.updateFlag() can flush it.
   *
   * Rollout logic (applied in order):
   *  1. If globally `enabled = true` → allow
   *  2. If `orgId` is in `targetOrgIds` → allow
   *  3. If hash(userId):key % 100 < rolloutPercent → allow
   *  4. Else deny
   */
  async isEnabled(key: string, userId: string, orgId?: string): Promise<boolean> {
    const client = this.redis.getClient();
    const flagCacheKey = `flag:${key}`;

    // ── 1. Load flag definition from Redis (or DB) ───────────────────────────
    let flag: {
      id: string; key: string; enabled: boolean;
      rolloutPercent: number; targetOrgIds: string[];
    } | null = null;

    const cached = await client.get(flagCacheKey);
    if (cached) {
      try {
        flag = JSON.parse(cached);
      } catch {
        flag = null;
      }
    }

    if (!flag) {
      flag = await this.prisma.featureFlag.findUnique({ where: { key } }) as any;
      if (!flag) {
        this.logger.warn(`Feature flag key not found in catalog: ${key}`);
        return false;
      }
      // Cache the flag definition for 5 minutes
      await client.set(flagCacheKey, JSON.stringify(flag), 'EX', 300);
    }

    // ── 2. Check tenant-level override first (highest priority) ─────────────
    if (orgId) {
      const override = await this.prisma.tenantFeatureOverride.findUnique({
        where: {
          organizationId_featureFlagId: {
            organizationId: orgId,
            featureFlagId: flag!.id,
          },
        },
      });
      if (override !== null) {
        return override.enabled;
      }
    }

    // ── 3. Global enabled flag ────────────────────────────────────────────────
    if (flag!.enabled) return true;

    // ── 4. Org whitelist ──────────────────────────────────────────────────────
    if (orgId && flag!.targetOrgIds.includes(orgId)) return true;

    // ── 5. Percentage rollout keyed on userId ─────────────────────────────────
    if (flag!.rolloutPercent > 0 && userId) {
      const bucket = this.getRolloutHash(userId, key);
      if (bucket < flag!.rolloutPercent) return true;
    }

    return false;
  }

  /**
   * @deprecated Use isEnabled(key, userId, orgId) instead.
   * Kept for backwards-compatibility with callers that pass (organizationId, key).
   */
  async isEnabledForOrg(organizationId: string, key: string): Promise<boolean> {
    return this.isEnabled(key, '', organizationId);
  }

  private getRolloutHash(userIdOrOrgId: string, flagKey: string): number {
    let hash = 0;
    const str = `${userIdOrOrgId}:${flagKey}`;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash % 100);
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
    } catch {
      // Override might not exist, ignore deletion errors
    }

    const cacheKey = `feature_flag:${organizationId}:${key}`;
    await this.redis.getClient().del(cacheKey);

    return { success: true };
  }

  async getOrganizationFlags(organizationId: string) {
    const flags = await this.prisma.featureFlag.findMany();
    const result: Record<string, boolean> = {};

    for (const flag of flags) {
      result[flag.key] = await this.isEnabled(flag.key, '', organizationId);
    }

    return result;
  }
}
