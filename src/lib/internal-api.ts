import { Hono } from "hono";
import type { Context } from "hono";
import { mapDomainError } from "./error-response";
import type { AppEnv } from "./types";

export type InternalOk<T> = { ok: true; status: number; body: T };
export type InternalErr = { ok: false; status: number; error: string; code?: string; body: Record<string, unknown> };
export type InternalResult<T> = InternalOk<T> | InternalErr;

/**
 * Runs another route's handlers in-process as the same signed-in user, so composite actions
 * keep every guard, 409, job claim, and side effect of the single-step endpoints.
 */
export function internalApi(c: Context<AppEnv>, routes: Hono<AppEnv>[]) {
  const inner = new Hono<AppEnv>();
  inner.onError((err, ic) => {
    const mapped = mapDomainError(err);
    if (mapped) return ic.json(mapped.body, mapped.status);
    console.error(err);
    return ic.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  });
  inner.use("*", async (ic, next) => {
    ic.set("db", c.get("db"));
    ic.set("origin", c.get("origin"));
    ic.set("user", c.get("user"));
    ic.set("organizationId", c.get("organizationId"));
    ic.set("role", c.get("role"));
    await next();
  });
  for (const route of routes) inner.route("/", route);

  let executionCtx: Context<AppEnv>["executionCtx"] | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    executionCtx = undefined;
  }

  return async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<InternalResult<T>> {
    const res = await inner.request(
      path,
      {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      c.env,
      executionCtx,
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, status: res.status, body: json as T };
    return {
      ok: false,
      status: res.status,
      error: typeof json.error === "string" ? json.error : `Request failed (${res.status})`,
      code: typeof json.code === "string" ? json.code : undefined,
      body: json,
    };
  };
}
