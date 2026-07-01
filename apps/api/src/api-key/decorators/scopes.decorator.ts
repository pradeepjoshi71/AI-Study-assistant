import { SetMetadata } from '@nestjs/common';

export const SCOPES_KEY = 'api_key_scopes';

/**
 * Declare which scopes are required to access this route via API key.
 * Example: @Scopes('chat:read', 'quiz:write')
 */
export const Scopes = (...scopes: string[]) =>
  SetMetadata(SCOPES_KEY, scopes);
