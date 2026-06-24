import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  /** Maximum requests allowed within the window */
  limit: number;
  /** Sliding window duration in seconds */
  window: number;
}

/**
 * Apply to a controller class or individual route handler to enforce
 * a per-user Redis sliding-window rate limit.
 *
 * @example
 * @RateLimit({ limit: 20, window: 60 })   // 20 req/min
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

