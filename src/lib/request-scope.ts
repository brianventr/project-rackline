import { AsyncLocalStorage } from "node:async_hooks";
import type { Bindings } from "./types";

/** The request's `waitUntil`, so stock and order handlers can finish webhook delivery after the response. */
export type RequestScope = {
  env: Bindings;
  waitUntil(promise: Promise<unknown>): void;
};

const storage = new AsyncLocalStorage<RequestScope>();

export function runInRequestScope<T>(scope: RequestScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function currentRequestScope(): RequestScope | undefined {
  return storage.getStore();
}
