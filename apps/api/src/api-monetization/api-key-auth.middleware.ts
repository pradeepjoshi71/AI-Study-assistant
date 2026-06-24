import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ApiKeysService } from './api-keys.service';

/**
 * Middleware that authenticates requests using API keys.
 * Applied only to routes prefixed with /api/v1/external/* (public monetized API).
 *
 * Authorization header format: Bearer sk_live_xxxxx
 */
@Injectable()
export class ApiKeyAuthMiddleware implements NestMiddleware {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer sk_')) {
      throw new UnauthorizedException('Missing or invalid API key. Use: Authorization: Bearer sk_live_...');
    }

    const rawKey = authHeader.replace('Bearer ', '').trim();

    const { apiKey } = await this.apiKeys.validateKey(rawKey);

    // Attach API key context to request for downstream use
    (req as any).apiKeyContext = {
      apiKeyId: apiKey.id,
      organizationId: apiKey.organizationId,
      permissions: apiKey.permissions,
    };

    next();
  }
}
