import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiKeyGuard } from '../../api-key/guards/api-key.guard';
import { ApiKeyCacheService } from '../../api-key/api-key-cache.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyOrJwtAuthGuard extends ApiKeyGuard {
  constructor(
    reflector: Reflector,
    cacheService: ApiKeyCacheService,
    @InjectQueue('api-key-usage') usageQueue: Queue,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    super(reflector, cacheService, usageQueue);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token.startsWith('sk_')) {
        // Fall back to standard ApiKeyGuard behavior
        return super.canActivate(context);
      } else {
        // Validate as standard session JWT token
        try {
          const secret = this.configService.get<string>('JWT_ACCESS_SECRET', 'access_secret_12345');
          const payload = this.jwtService.verify(token, { secret });
          if (payload) {
            // Populate simulated apiKeyContext
            request.apiKeyContext = {
              keyId: 'jwt_session',
              orgId: payload.organizationId ?? payload.sub,
              userId: payload.sub,
              scopes: ['*'], // grant all scopes for authenticated UI users
            };
            return true;
          }
        } catch (err) {
          throw new UnauthorizedException('Invalid or expired access token');
        }
      }
    }

    throw new UnauthorizedException('Missing or malformed Authorization header.');
  }
}
