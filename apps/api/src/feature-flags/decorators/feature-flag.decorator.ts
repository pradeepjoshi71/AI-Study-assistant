import { SetMetadata } from '@nestjs/common';

export const FEATURE_FLAG_KEY = 'required_feature_flag';

/**
 * Decorator to gate access to an endpoint based on an organization feature flag.
 *
 * @example
 * @RequiresFeature('knowledge_graph')
 */
export const RequiresFeature = (featureKey: string) =>
  SetMetadata(FEATURE_FLAG_KEY, featureKey);
