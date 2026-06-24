import { PlanType } from '@prisma/client';

export interface OverageRates {
  tokenOverageRateMicro: number;     // per 1000 tokens
  documentOverageRateCents: number;  // per document
  apiCallOverageRateMicro: number;   // per call
  storageOverageRateCents: number;   // per GB
}

export const OVERAGE_RATES: Record<PlanType, OverageRates> = {
  FREE: {
    tokenOverageRateMicro: 0,
    documentOverageRateCents: 0,
    apiCallOverageRateMicro: 0,
    storageOverageRateCents: 0,
  },
  PRO: {
    tokenOverageRateMicro: 2,       // $0.000002 per token overage ($2 per M tokens)
    documentOverageRateCents: 10,   // $0.10 per document overage
    apiCallOverageRateMicro: 100,   // $0.0001 per API call overage
    storageOverageRateCents: 25,    // $0.25 per GB overage
  },
  TEAM: {
    tokenOverageRateMicro: 1,       // $0.000001 per token ($1 per M tokens)
    documentOverageRateCents: 5,    // $0.05 per document
    apiCallOverageRateMicro: 50,    // $0.00005 per API call
    storageOverageRateCents: 15,    // $0.15 per GB
  },
  ENTERPRISE: {
    tokenOverageRateMicro: 0,
    documentOverageRateCents: 0,
    apiCallOverageRateMicro: 0,
    storageOverageRateCents: 0,
  },
};
