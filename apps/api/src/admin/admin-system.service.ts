import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const HEALTH_CACHE_KEY = 'admin:system:health';
const HEALTH_CACHE_TTL = 60; // seconds

@Injectable()
export class AdminSystemService {
  private readonly logger = new Logger(AdminSystemService.name);
  private readonly aiServiceUrl: string;

  // All queues injected for job-count aggregation
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    @InjectQueue('document-processing') private readonly q1: Queue,
    @InjectQueue('embedding-generation') private readonly q2: Queue,
    @InjectQueue('graph-building') private readonly q3: Queue,
    @InjectQueue('analytics-aggregation') private readonly q4: Queue,
    @InjectQueue('memory-summarization') private readonly q5: Queue,
    @InjectQueue('cost-aggregation') private readonly q6: Queue,
    @InjectQueue('push-notifications') private readonly q7: Queue,
    @InjectQueue('voice-processing') private readonly q8: Queue,
    @InjectQueue('adaptive-mastery') private readonly q9: Queue,
    @InjectQueue('exam-generation') private readonly q10: Queue,
    @InjectQueue('admin-user-export') private readonly q11: Queue,
    @InjectQueue('stripe-sync') private readonly q12: Queue,
  ) {
    this.aiServiceUrl = this.config.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  // -- GET /admin/system/health -------------------------------------------------

  async getHealth() {
    const client = this.redis.getClient();

    // Check 60s Redis cache
    const cached = await client.get(HEALTH_CACHE_KEY);
    if (cached) {
      return { cached: true, ...JSON.parse(cached) };
    }

    // Collect all sub-aggregates in parallel
    const [prismaStats, redisInfo, bullStats, fastApiStats] = await Promise.all([
      this.getPrismaStats(),
      this.getRedisInfo(),
      this.getBullStats(),
      this.getFastApiStats(),
    ]);

    const payload = {
      timestamp: new Date().toISOString(),
      prisma: prismaStats,
      redis: redisInfo,
      queues: bullStats,
      aiService: fastApiStats,
    };

    // Cache result for 60 seconds
    await client.set(HEALTH_CACHE_KEY, JSON.stringify(payload), 'EX', HEALTH_CACHE_TTL);

    return { cached: false, ...payload };
  }

  private async getPrismaStats() {
    const [users, orgs, docs, chats] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.organization.count(),
      this.prisma.document.count(),
      this.prisma.message.count({ where: { role: 'USER' } }),
    ]);
    return { users, organizations: orgs, documents: docs, chatMessages: chats };
  }

  private async getRedisInfo() {
    try {
      const raw: string = await this.redis.getClient().info('all');
      const parse = (section: string, key: string): string | null => {
        const regex = new RegExp(`^${key}:(.+)$`, 'm');
        const m = section.match(regex);
        return m ? m[1].trim() : null;
      };

      const usedMemory = parse(raw, 'used_memory_human') ?? 'n/a';
      const peakMemory = parse(raw, 'used_memory_peak_human') ?? 'n/a';
      const hits = parseInt(parse(raw, 'keyspace_hits') ?? '0', 10);
      const misses = parseInt(parse(raw, 'keyspace_misses') ?? '0', 10);
      const hitRatio = hits + misses > 0
        ? Math.round((hits / (hits + misses)) * 10000) / 100
        : null;

      return { usedMemory, peakMemory, keyspaceHits: hits, keyspaceMisses: misses, hitRatioPercent: hitRatio };
    } catch (err: any) {
      this.logger.warn(`Redis INFO failed: ${err.message}`);
      return { error: err.message };
    }
  }

  private async getBullStats() {
    const queues: Queue[] = [
      this.q1, this.q2, this.q3, this.q4, this.q5, this.q6,
      this.q7, this.q8, this.q9, this.q10, this.q11, this.q12,
    ];
    const names = [
      'document-processing', 'embedding-generation', 'graph-building',
      'analytics-aggregation', 'memory-summarization', 'cost-aggregation',
      'push-notifications', 'voice-processing', 'adaptive-mastery',
      'exam-generation', 'admin-user-export', 'stripe-sync',
    ];

    const results = await Promise.allSettled(
      queues.map((q) => q.getJobCounts('active', 'waiting', 'failed')),
    );

    return results.reduce<Record<string, unknown>>((acc, r, i) => {
      acc[names[i]] = r.status === 'fulfilled'
        ? r.value
        : { error: (r as PromiseRejectedResult).reason?.message };
      return acc;
    }, {});
  }

  private async getFastApiStats() {
    try {
      const res = await fetch(`${this.aiServiceUrl}/admin/stats`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err: any) {
      this.logger.warn(`FastAPI /admin/stats failed: ${err.message}`);
      return { error: err.message };
    }
  }

  // -- GET /admin/system/config -------------------------------------------------

  async listConfigs() {
    return this.prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
  }

  async getConfig(key: string) {
    const cfg = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!cfg) throw new NotFoundException(`SystemConfig key "${key}" not found`);
    return cfg;
  }

  // -- POST /admin/system/config ------------------------------------------------

  async createConfig(data: { key: string; value: string; description?: string }, updatedBy: string) {
    return this.prisma.systemConfig.create({
      data: { key: data.key, value: data.value, description: data.description, updatedBy },
    });
  }

  // -- PATCH /admin/system/config/:key -----------------------------------------

  async updateConfig(key: string, value: string, updatedBy: string) {
    const existing = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`SystemConfig key "${key}" not found`);
    return this.prisma.systemConfig.update({
      where: { key },
      data: { value, updatedBy },
    });
  }

  // -- DELETE /admin/system/config/:key ----------------------------------------

  async deleteConfig(key: string) {
    const existing = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`SystemConfig key "${key}" not found`);
    await this.prisma.systemConfig.delete({ where: { key } });
    return { success: true };
  }
}
