import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ApiKeyContext {
  keyId: string;
  orgId: string;
  userId: string | null;
  scopes: string[];
}

/**
 * Extracts the validated API key context attached to the request by APIKeyGuard.
 * Usage: @ApiKeyCtx() ctx: ApiKeyContext
 */
export const ApiKeyCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKeyContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiKeyContext as ApiKeyContext;
  },
);
