import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from '../feature-flags.service';
import { FEATURE_FLAG_KEY } from '../decorators/feature-flag.decorator';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const featureKey = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!featureKey) return true; // No feature flag restriction configured

    const request = context.switchToHttp().getRequest();
    const organizationId = request.user?.organizationId || request.apiKeyContext?.organizationId;

    if (!organizationId) {
      throw new ForbiddenException('Organization context missing for feature evaluation');
    }

    const userId: string = request.user?.sub || '';
    const enabled = await this.featureFlags.isEnabled(featureKey, userId, organizationId);

    if (!enabled) {
      throw new ForbiddenException(
        `Feature access restricted: "${featureKey}" is not enabled for your organization's subscription plan.`,
      );
    }

    return true;
  }
}
