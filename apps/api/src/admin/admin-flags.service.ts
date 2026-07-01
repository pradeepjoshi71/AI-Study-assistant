import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface UpdateFlagInput {
  enabled?: boolean;
  rolloutPercent?: number;
  targetOrgIds?: string[];
}

@Injectable()
export class AdminFlagsService {
  private readonly logger = new Logger(AdminFlagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // -- List all feature flags ----------------------------------------------------

  async getAllFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  // -- Update a flag and flush its Redis cache key -------------------------------

  async updateFlag(key: string, input: UpdateFlagInput) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) throw new NotFoundException(`Feature flag "${key}" not found`);

    const data: Record<string, unknown> = {};
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.rolloutPercent !== undefined) data.rolloutPercent = input.rolloutPercent;
    if (input.targetOrgIds !== undefined) data.targetOrgIds = input.targetOrgIds;

    const updated = await this.prisma.featureFlag.update({ where: { key }, data });

    // Flush the canonical Redis cache key for this flag
    const cacheKey = `flag:${key}`;
    try {
      await this.redis.getClient().del(cacheKey);
      this.logger.log(`Flushed Redis cache key "${cacheKey}" after flag update`);
    } catch (err: any) {
      this.logger.warn(`Failed to flush flag cache: ${err.message}`);
    }

    return updated;
  }
}
