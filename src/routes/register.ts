import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { createAuth } from "../lib/auth";
import { provisionOrganization } from "../lib/org";
import { requireString } from "../lib/http";
import type { AppEnv } from "../lib/types";
import { originFrom } from "../lib/types";

export const registerRoute = new Hono<AppEnv>();

registerRoute.post("/register", async (c) => {
  const body = await c.req.json<{
    name?: string;
    email?: string;
    password?: string;
    organizationName?: string;
  }>();
  const name = requireString(body.name, "name");
  const email = requireString(body.email, "email");
  const password = requireString(body.password, "password");
  const organizationName = requireString(body.organizationName, "organizationName");
  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
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
    return c.json(
      { error: payload.error?.message || payload.message || "Sign up failed" },
      result.status as 400,
    );
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

  return result;
});
