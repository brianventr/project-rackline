/** Runtime comes from the Workers `nodejs_compat` flag. The Workers types package does not ship this module. */
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}
