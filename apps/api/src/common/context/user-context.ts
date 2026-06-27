import { AsyncLocalStorage } from "async_hooks";

export interface UserContext {
  userId: string;
  orgId?: string;
}

export const userContextStorage = new AsyncLocalStorage<UserContext>();
