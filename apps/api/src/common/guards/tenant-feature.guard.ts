import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

export const FEATURE_KEY = "requires_feature";
export const RequiresFeature = (feature: string) =>
  SetMetadata(FEATURE_KEY, feature);

@Injectable()
export class TenantFeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFeature = this.reflector.getAllAndOverride<string>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const features = request.tenantFeatures;

    // Default features if not present in request context (e.g. for non-tenant routes or platform fallback)
    const hasFeature = features && features[requiredFeature] === true;

    if (!hasFeature) {
      throw new ForbiddenException({
        statusCode: 403,
        message: `Feature '${requiredFeature}' is disabled for this tenant`,
        code: "FEATURE_DISABLED",
      });
    }

    return true;
  }
}
