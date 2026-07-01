import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CacheService } from '../../common/services/cache.service';
import { PlanType } from '@prisma/client';

interface RateLimits {
  min: number;
  day: number;
}

const LIMITS: Record<'free' | 'pro' | 'premium', RateLimits> = {
  free: { min: 10, day: 100 },
  pro: { min: 60, day: 5000 },
  premium: { min: 300, day: 50000 },
};

@Injectable()
export class APIRateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(APIRateLimitInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly cacheService: CacheService,
    @InjectQueue('api-key-usage') private readonly usageQueue: Queue,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const path = request.path || request.url || '';

    // Only apply rate limiting to /api/public/* routes
    if (!path.startsWith('/api/public/')) {
      return next.handle();
    }

    const apiKeyCtx = (request as any).apiKeyContext;
    if (!apiKeyCtx) {
      // If no API Key Context is attached (e.g. guard bypassed or failed), let it pass
      return next.handle();
    }

    const { keyId, orgId } = apiKeyCtx;
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return next.handle();
    }

    const rawKey = authHeader.slice(7).trim();
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    // ─── 1. Resolve Plan & Limits ──────────────────────────────────────────
    let plan: any = null;
    try {
      plan = await this.resolvePlanForOrg(orgId);
    } catch (err: any) {
      this.logger.error(`Error resolving plan for organization ${orgId}: ${err.message}`);
    }

    const tier = this.getTier(plan?.type);
    const limits = LIMITS[tier];

    // ─── 2. Sliding Window Rate Limiting (Pipeline) ────────────────────────
    const minKey = `ratelimit:api:${keyHash}:min`;
    const dayKey = `ratelimit:api:${keyHash}:day`;

    let countMin = 0;
    let ttlMin = 60;
    let countDay = 0;
    let ttlDay = 86400;

    try {
      const client = this.redisService.getClient();
      const pipeline = client.pipeline();
      pipeline.incr(minKey);
      pipeline.expire(minKey, 60, 'NX');
      pipeline.ttl(minKey);
      pipeline.incr(dayKey);
      pipeline.expire(dayKey, 86400, 'NX');
      pipeline.ttl(dayKey);

      const results = await pipeline.exec();
      if (results) {
        countMin = (results[0]?.[1] as number) ?? 0;
        ttlMin = (results[2]?.[1] as number) ?? 60;
        countDay = (results[3]?.[1] as number) ?? 0;
        ttlDay = (results[5]?.[1] as number) ?? 86400;
      }
    } catch (err: any) {
      this.logger.warn(`Redis rate limit pipeline failed (fail-open): ${err.message}`);
      return next.handle();
    }

    // ─── 3. Exceeded check ─────────────────────────────────────────────────
    if (countMin > limits.min || countDay > limits.day) {
      const retryAfter = countMin > limits.min ? ttlMin : ttlDay;
      response.setHeader('Retry-After', String(Math.max(1, retryAfter)));
      throw new HttpException(
        {
          success: false,
          message: `API rate limit exceeded for tier ${tier.toUpperCase()}. Limits: ${limits.min}/min, ${limits.day}/day.`,
          retryAfter: Math.max(1, retryAfter),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ─── 4. Set Rate Limit Headers on Pass ─────────────────────────────────
    response.setHeader('X-RateLimit-Limit', limits.min);
    response.setHeader('X-RateLimit-Remaining', Math.max(0, limits.min - countMin));
    response.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + Math.max(0, ttlMin));

    // ─── 5. Measure Latency and Log Usage ──────────────────────────────────
    const startMs = Date.now();
    const method = request.method;
    const endpoint = request.route?.path ?? request.url;

    return next.handle().pipe(
      tap(() => {
        const latencyMs = Date.now() - startMs;
        const statusCode = response.statusCode || 200;
        this.enqueueUsageLog(keyId, endpoint, method, statusCode, latencyMs);
      }),
      catchError((err) => {
        const latencyMs = Date.now() - startMs;
        const statusCode = err instanceof HttpException ? err.getStatus() : 500;
        this.enqueueUsageLog(keyId, endpoint, method, statusCode, latencyMs);
        return throwError(() => err);
      }),
    );
  }

  private async resolvePlanForOrg(orgId: string): Promise<any> {
    const cacheKey = `plan:org:${orgId}`;

    try {
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) return cached;
    } catch (err: any) {
      this.logger.warn(`Failed to get plan from cache: ${err.message}`);
    }

    const orgSub = await this.prisma.subscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: true },
    });

    let resolvedPlan: any = null;
    if (orgSub?.plan) {
      resolvedPlan = {
        id: orgSub.plan.id,
        name: orgSub.plan.name,
        type: orgSub.plan.type,
        limits: orgSub.plan.limits,
        maxUsers: orgSub.plan.maxUsers,
        currentPeriodTokensUsed: orgSub.currentPeriodTokensUsed ?? 0,
      };
    } else {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        include: { plan: true },
      });
      if (org?.plan) {
        resolvedPlan = {
          id: org.plan.id,
          name: org.plan.name,
          type: org.plan.type,
          limits: org.plan.limits,
        };
      } else {
        const freePlan = await this.prisma.plan.findFirst({
          where: { type: PlanType.FREE },
        });
        resolvedPlan = freePlan
          ? {
              id: freePlan.id,
              name: freePlan.name,
              type: freePlan.type,
              limits: freePlan.limits,
            }
          : { type: PlanType.FREE };
      }
    }

    try {
      await this.cacheService.set(cacheKey, resolvedPlan, 900); // 15 min TTL
    } catch (err: any) {
      this.logger.warn(`Failed to set plan cache: ${err.message}`);
    }

    return resolvedPlan;
  }

  private getTier(planType: string | undefined): 'free' | 'pro' | 'premium' {
    const t = planType?.toUpperCase();
    if (t === 'PRO') return 'pro';
    if (t === 'TEAM' || t === 'ENTERPRISE' || t === 'PREMIUM') return 'premium';
    return 'free';
  }

  private enqueueUsageLog(
    keyId: string,
    endpoint: string,
    method: string,
    statusCode: number,
    latencyMs: number,
  ) {
    this.usageQueue
      .add(
        'log-usage',
        { keyId, endpoint, method, statusCode, latencyMs },
        {
          removeOnComplete: true,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      )
      .catch((err) =>
        this.logger.warn(`Failed to enqueue usage log: ${err.message}`),
      );
  }
}
