import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RedisService } from '../../redis/redis.service';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';

/**
 * Per-user, per-endpoint Redis sliding-window rate limit guard.
 *
 * Apply via @UseGuards(RateLimitGuard) + @RateLimit({ limit, window }) on a
 * controller or route. Routes without @RateLimit metadata pass through.
 *
 * Implementation: atomic INCR + EXPIRE (single pipeline) — safe under concurrency.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Read metadata from handler → then controller (decorator can be on either)
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RateLimit decorator → pass through
    if (!options) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const userId: string = (req as any).user?.id ?? (req.ip ?? 'anon');
    const endpoint = `${req.method}:${req.route?.path ?? req.url}`;
    const key = `rate:${userId}:${endpoint}`;

    try {
      const client = this.redis.getClient();

      // Atomic pipeline: INCR → EXPIRE (only set TTL on first call)
      const pipeline = client.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, options.window, 'NX'); // NX = only set if not exists
      const results = await pipeline.exec();

      const count = (results?.[0]?.[1] as number) ?? 0;

      if (count > options.limit) {
        this.logger.warn(
          `Rate limit exceeded: userId=${userId} endpoint="${endpoint}" count=${count}/${options.limit}`,
        );
        res.setHeader('Retry-After', String(options.window));
        throw new HttpException(
          {
            success: false,
            message: `Rate limit exceeded. Maximum ${options.limit} requests per ${options.window}s.`,
            retryAfter: options.window,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Attach rate limit headers for client visibility
      res.setHeader('X-RateLimit-Limit', options.limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, options.limit - count));
      res.setHeader('X-RateLimit-Window', options.window);

      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis failure → fail open (don't block the user on infra issues)
      this.logger.warn(`RateLimitGuard Redis error (fail-open): ${(err as Error).message}`);
      return true;
    }
  }
}

