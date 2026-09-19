import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, requireString } from "../lib/http";
import { requireOwner } from "../lib/org";
import { createAuth } from "../lib/auth";
import { newId } from "../lib/ids";
import { originFrom } from "../lib/types";

export const teamRoute = new Hono<AppEnv>();

teamRoute.get("/team", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.memberships.id,
      role: schema.memberships.role,
      userId: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(eq(schema.memberships.organizationId, organizationId));
  return c.json(rows);
});

teamRoute.post("/team", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    name?: string;
    email?: string;
    password?: string;
    role?: string;
  }>();
  const name = requireString(body.name, "name");
  const email = requireString(body.email, "email").toLowerCase();
  const password = requireString(body.password, "password");
  const role = (body.role || "operator").trim();
  if (role !== "owner" && role !== "operator") badRequest("Role must be owner or operator");
  if (password.length < 8) badRequest("Password must be at least 8 characters");

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [existingUser] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (existingUser) {
    const [membership] = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.userId, existingUser.id)))
      .limit(1);
    if (membership) conflict("That person is already on this team");
    conflict("That email already has a Rackline login. Invite them from a fresh email for now.");
  }

  const origin = originFrom(c.req.url);
  const auth = createAuth(db, c.env, origin);
  const result = await auth.api.signUpEmail({
    body: { name, email, password },
    headers: new Headers(),
    asResponse: true,
  });
  if (!result.ok) {
    const payload = (await result.json().catch(() => ({ message: "Could not create teammate" }))) as {
      message?: string;
      error?: { message?: string };
    };
    return c.json({ error: payload.error?.message || payload.message || "Could not create teammate" }, 400);
  }
  const signed = (await result.clone().json()) as { user?: { id: string } };
  const userId = signed.user?.id;
  if (!userId) return c.json({ error: "Could not create teammate" }, 400);

  await db.insert(schema.memberships).values({
    id: newId(),
    organizationId,
    userId,
    role,
  });

  const [row] = await db
    .select({
      id: schema.memberships.id,
      role: schema.memberships.role,
      userId: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.userId, userId)))
    .limit(1);

  return c.json(row, 201);
});
