import { SetMetadata } from '@nestjs/common';

export const QUOTA_KEY = 'quota_type';

/**
 * Decorator to enforce a quota check on an endpoint.
 *
 * @example
 * @RequiresQuota('chat')    // checks daily chat limit
 * @RequiresQuota('api_call') // checks daily API call limit
 */
export const RequiresQuota = (quotaType: 'chat' | 'api_call' | 'tokens') =>
  SetMetadata(QUOTA_KEY, quotaType);
