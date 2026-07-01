import { Request } from 'express';

export interface ApiMeta {
  requestId: string;
  version: 'v1';
  rateLimit: {
    limit: number;
    remaining: number;
    reset: number; // Unix timestamp seconds
  };
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  meta: ApiMeta;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Builds the standard v1 response envelope.
 * rateLimit fields are injected from the request object (set by TieredThrottlerGuard).
 */
export function envelope<T>(
  data: T,
  req: Request,
  meta?: Partial<ApiMeta>,
): ApiEnvelope<T> {
  return {
    success: true,
    data,
    meta: buildMeta(req, meta),
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  req: Request,
  details?: unknown,
): ApiEnvelope<never> {
  return {
    success: false,
    meta: buildMeta(req),
    error: { code, message, details },
  };
}

function buildMeta(req: Request, override?: Partial<ApiMeta>): ApiMeta {
  // ThrottlerGuard adds these headers to the response; we read them back
  // from the response object if set. Graceful fallback to 0.
  const res = (req as any).res;
  const limit = parseInt((res?.getHeader?.('X-RateLimit-Limit') as string) ?? '0', 10) || 0;
  const remaining = parseInt((res?.getHeader?.('X-RateLimit-Remaining') as string) ?? '0', 10) || 0;
  const reset = parseInt((res?.getHeader?.('X-RateLimit-Reset') as string) ?? '0', 10) || 0;

  return {
    requestId: crypto.randomUUID(),
    version: 'v1',
    rateLimit: { limit, remaining, reset },
    ...override,
  };
}
