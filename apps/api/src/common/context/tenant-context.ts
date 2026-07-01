import { AsyncLocalStorage } from "async_hooks";

export interface TenantContext {
  tenantId: string;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();
