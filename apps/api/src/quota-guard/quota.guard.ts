import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QuotaService } from './quota.service';
import { QUOTA_KEY } from './decorators/quota.decorator';

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly quota: QuotaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Read quota type from @RequiresQuota() decorator
    const quotaType = this.reflector.getAllAndOverride<string>(QUOTA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!quotaType) return true; // no quota configured on this endpoint

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const organizationId = user?.organizationId || request.apiKeyContext?.organizationId;

    if (!organizationId) return true; // unauthenticated — other guards handle this

    const result = await this.quota.checkQuota(organizationId, quotaType as any);

    if (!result.allowed) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Quota Exceeded',
          message: `You have reached your ${result.limitName} limit (${result.used}/${result.limit}). Resets at ${result.resetAt}`,
          quota: {
            type: result.limitName,
            used: result.used,
            limit: result.limit,
            resetAt: result.resetAt,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
