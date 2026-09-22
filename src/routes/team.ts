import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, HttpError, notFound } from "../lib/http";
import { requireOwner } from "../lib/org";
import { createAuth } from "../lib/auth";
import { newId } from "../lib/ids";
import { originFrom } from "../lib/types";
import { sendMail } from "../lib/mail";
import { FLOOR_VERBS, isFloorVerb, parseFloorVerbs, serializeFloorVerbs, type FloorVerb } from "../domain/jobs";
import {
  inviteMailText,
  mailConfigured,
  parseTeamInvite,
  randomPassword,
  resolveInvitePassword,
  TeamInviteError,
} from "../domain/auth-mail";

export const teamRoute = new Hono<AppEnv>();

function inviteHttp(err: unknown): never {
  if (err instanceof TeamInviteError) {
    throw new HttpError(err.status, err.message, err.code);
  }
  throw err;
}

teamRoute.get("/team", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.memberships.id,
      role: schema.memberships.role,
      floorVerbs: schema.memberships.floorVerbs,
      userId: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(eq(schema.memberships.organizationId, organizationId));
  return c.json(
    rows.map((row) => ({
      ...row,
      floorVerbs: parseFloorVerbs(row.floorVerbs, row.role),
    })),
  );
});

teamRoute.post("/team", async (c) => {
  requireOwner(c.get("role"));
  let parsed;
  try {
    parsed = parseTeamInvite(await c.req.json<Record<string, unknown>>().catch(() => ({})));
  } catch (err) {
    inviteHttp(err);
  }
  const canMail = mailConfigured(c.env);
  let resolved;
  try {
    resolved = resolveInvitePassword(parsed.password, canMail, randomPassword);
  } catch (err) {
    inviteHttp(err);
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [existingUser] = await db.select().from(schema.user).where(eq(schema.user.email, parsed.email)).limit(1);
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
    body: { name: parsed.name, email: parsed.email, password: resolved.password },
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
    role: parsed.role,
  });

  let invite: "emailed" | "password" = resolved.emailed ? "emailed" : "password";
  if (resolved.emailed) {
    const reset = await auth.api.requestPasswordReset({
      body: { email: parsed.email, redirectTo: `${origin}/reset-password` },
    }).catch((err: unknown) => {
      throw new HttpError(409, err instanceof Error ? err.message : "Could not send invite email", "MAIL_FAILED");
    });
    if (!reset) conflict("Could not send invite email", "MAIL_FAILED");
    invite = "emailed";
  } else if (canMail) {
    const [org] = await db
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);
    await sendMail({
      apiKey: c.env.MAIL_API_KEY!,
      from: c.env.MAIL_FROM!,
      to: parsed.email,
      subject: `You were added to ${org?.name || "Rackline"}`,
      text: inviteMailText({
        name: parsed.name,
        organizationName: org?.name || "your warehouse",
        url: `${origin}/login`,
        setPassword: false,
      }),
    }).catch(() => undefined);
    invite = "emailed";
  }

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

  return c.json({ ...row, invite }, 201);
});

teamRoute.patch("/team/:userId", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ floorVerbs?: string[] | null }>().catch(() => ({}) as { floorVerbs?: string[] | null });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const userId = c.req.param("userId");
  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.userId, userId)))
    .limit(1);
  if (!membership) notFound("Teammate not found");
  let floorVerbs: string | null = membership.floorVerbs;
  if (body.floorVerbs !== undefined) {
    if (body.floorVerbs === null) {
      floorVerbs = null;
    } else {
      const allowed = body.floorVerbs.filter((row): row is FloorVerb => isFloorVerb(row));
      if (allowed.length === 0) badRequest("Pick at least one floor verb");
      floorVerbs = serializeFloorVerbs(allowed.length === FLOOR_VERBS.length ? null : allowed);
    }
  }
  await db.update(schema.memberships).set({ floorVerbs }).where(eq(schema.memberships.id, membership.id));
  const [row] = await db
    .select({
      id: schema.memberships.id,
      role: schema.memberships.role,
      floorVerbs: schema.memberships.floorVerbs,
      userId: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(eq(schema.memberships.id, membership.id))
    .limit(1);
  return c.json({ ...row, floorVerbs: parseFloorVerbs(row?.floorVerbs, row?.role || "operator") });
});