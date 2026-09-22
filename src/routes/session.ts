import { Hono } from "hono";
import { createAuth } from "../lib/auth";
import type { AppEnv } from "../lib/types";
import { originFrom } from "../lib/types";

export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/today";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) {
    return "/today";
  }
  return value;
}

export function redirectWithSession(result: Response, next: string): Response {
  const headers = new Headers();
  const cookies =
    typeof result.headers.getSetCookie === "function" ? result.headers.getSetCookie() : [];
  if (cookies.length === 0) {
    const single = result.headers.get("set-cookie");
    if (single) headers.append("set-cookie", single);
  } else {
    for (const cookie of cookies) headers.append("set-cookie", cookie);
  }
  headers.set("location", next);
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 302, headers });
}

export const sessionRoute = new Hono<AppEnv>();

sessionRoute.post("/session/login", async (c) => {
  const body = await c.req.parseBody();
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const next = safeNextPath(body.next);
  const origin = originFrom(c.req.url);
  const auth = createAuth(c.get("db"), c.env, origin);
  const result = await auth.api.signInEmail({
    body: { email, password },
    headers: c.req.raw.headers,
    asResponse: true,
  });
  if (!result.ok) {
    const payload = (await result.json().catch(() => ({ message: "Sign in failed" }))) as {
      message?: string;
    };
    const message = payload.message || "Sign in failed";
    return c.redirect(`/login?error=${encodeURIComponent(message)}`);
  }
  return redirectWithSession(result, next);
});
