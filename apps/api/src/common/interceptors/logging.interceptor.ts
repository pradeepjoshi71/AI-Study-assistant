import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { Request, Response } from 'express';

/**
 * Global logging interceptor:
 * - Emits structured JSON log line for every request (latency, status, correlationId)
 * - Asynchronously writes a RequestLog row to PostgreSQL for audit trail
 * - Non-blocking: DB write errors are silently swallowed
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const { method, url, correlationId } = req as Request & { correlationId?: string };
    const userId = (req as any).user?.id ?? null;
    const tenantId = (req as any).user?.tenantId ?? null;
    const startMs = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this._log(method, url, res.statusCode, startMs, correlationId, userId, tenantId),
        error: (err) => this._log(method, url, err.status ?? 500, startMs, correlationId, userId, tenantId, err.message),
      }),
    );
  }

  private _log(
    method: string,
    path: string,
    statusCode: number,
    startMs: number,
    correlationId?: string,
    userId?: string | null,
    tenantId?: string | null,
    errorMessage?: string,
  ): void {
    const latencyMs = Date.now() - startMs;

    // Structured JSON log — compatible with CloudWatch / Datadog / Loki
    this.logger.log(
      JSON.stringify({
        correlationId,
        method,
        path,
        statusCode,
        latencyMs,
        userId,
        tenantId,
        ...(errorMessage ? { errorMessage } : {}),
      }),
    );

    // Async DB write — fire-and-forget
    this.prisma.requestLog
      .create({
        data: {
          correlationId: correlationId ?? 'unknown',
          tenantId,
          userId,
          method,
          path,
          statusCode,
          latencyMs,
          errorMessage: errorMessage ?? null,
        },
      })
      .catch(() => {}); // Never block the response on DB write failure
  }
}

