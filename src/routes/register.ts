import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { createAuth } from "../lib/auth";
import { provisionOrganization } from "../lib/org";
import { HttpError, requireString } from "../lib/http";
import type { AppEnv } from "../lib/types";
import { originFrom } from "../lib/types";
import { redirectWithSession, safeNextPath } from "./session";

export const registerRoute = new Hono<AppEnv>();

registerRoute.post("/register", async (c) => {
  const type = c.req.header("content-type") || "";
  const form = type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data");
  const raw = (form ? await c.req.parseBody() : await c.req.json()) as Record<string, unknown>;
  const fail = (message: string, status: 400 | 401 | 403 | 409 = 400) => {
    if (form) return c.redirect(`/signup?error=${encodeURIComponent(message)}`);
    return c.json({ error: message }, status);
  };
  let name: string;
  let email: string;
  let password: string;
  let organizationName: string;
  try {
    name = requireString(raw.name, "name");
    email = requireString(raw.email, "email");
    password = requireString(raw.password, "password");
    organizationName = requireString(raw.organizationName, "organizationName");
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message, 400);
    throw err;
  }
  if (password.length < 8) {
    return fail("Password must be at least 8 characters");
  }

  const db = c.get("db");
  const origin = originFrom(c.req.url);
  const auth = createAuth(db, c.env, origin);
  const result = await auth.api.signUpEmail({
    body: { name, email, password },
    headers: c.req.raw.headers,
    asResponse: true,
  });

  if (!result.ok) {
    const payload = (await result.json().catch(() => ({ message: "Sign up failed" }))) as {
      message?: string;
      error?: { message?: string };
    };
    return fail(payload.error?.message || payload.message || "Sign up failed", result.status as 400);
  }

  const signed = (await result.clone().json()) as { user?: { id: string } };
  const userId = signed.user?.id;
  if (userId) {
    const existing = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, userId))
      .limit(1);
    if (existing.length === 0) {
      await provisionOrganization(db, userId, organizationName);
    }
  }

  if (form) return redirectWithSession(result, safeNextPath(raw.next));
  return result;
});
