import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { SCOPES_KEY } from '../decorators/scopes.decorator';
import { ApiKeyContext } from '../decorators/api-key-context.decorator';
import { ApiKeyCacheService } from '../api-key-cache.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheService: ApiKeyCacheService,
    @InjectQueue('api-key-usage') private readonly usageQueue: Queue,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // ─── 1. Extract raw Bearer token ──────────────────────────────────
    const authHeader: string | undefined = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'Missing or malformed Authorization header.',
      });
    }

    const rawKey = authHeader.slice(7).trim();

    if (!rawKey.startsWith('sk_')) {
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'Authorization token is not a valid API key.',
      });
    }

    // ─── 2. SHA-256 hash for lookup ────────────────────────────────────
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    // ─── 3. Redis cache lookup → fallback to DB ────────────────────────
    let cached: ApiKeyContext & {
      status: string;
      expiresAt: string | null;
    };

    try {
      cached = await this.cacheService.resolve(keyHash);
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'API key not found or has been revoked.',
      });
    }

    // ─── 4. Validate status ────────────────────────────────────────────
    if (cached.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: `API key is ${cached.status.toLowerCase()}.`,
      });
    }

    // ─── 5. Validate expiry ────────────────────────────────────────────
    if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'API key has expired.',
      });
    }

    // ─── 6. Check requested scopes via @Scopes() decorator ────────────
    const requiredScopes: string[] = this.reflector.getAllAndOverride<string[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? [];

    if (requiredScopes.length > 0) {
      const hasAll = requiredScopes.every((s) => cached.scopes.includes(s));
      if (!hasAll) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_SCOPES',
          message: `Required scopes: [${requiredScopes.join(', ')}]. Key has: [${cached.scopes.join(', ')}].`,
        });
      }
    }

    // ─── 7. Attach context to request ─────────────────────────────────
    const apiKeyCtx: ApiKeyContext = {
      keyId: cached.keyId,
      orgId: cached.orgId,
      userId: cached.userId,
      scopes: cached.scopes,
    };
    request.apiKeyContext = apiKeyCtx;

    // ─── 8. Async lastUsedAt update via BullMQ (non-blocking) ─────────
    this.usageQueue
      .add(
        'update-last-used',
        { keyId: cached.keyId },
        {
          removeOnComplete: true,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      )
      .catch((err) =>
        this.logger.warn(`Failed to enqueue lastUsedAt update: ${err.message}`),
      );

    return true;
  }
}
