import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/** Extends Express Request to carry the correlation ID */
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Injects a request-scoped X-Correlation-ID into every HTTP request.
 * - Reads from incoming X-Correlation-ID header if present (forwarded from gateway/client)
 * - Generates a new UUID v4 otherwise
 * - Attaches to req.correlationId for downstream use in logs
 * - Echoes the ID in the response header for client-side tracing
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const id = (req.headers['x-correlation-id'] as string) || randomUUID();
    req.correlationId = id;
    res.setHeader('X-Correlation-ID', id);
    next();
  }
}

