import { Hono } from "hono";
import { and, desc, eq, not, sql } from "drizzle-orm";
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
  type InviteKind,
  inviteMailText,
  mailConfigured,
  notePendingInvite,
  parseTeamInvite,
  randomPassword,
  resolveInvitePassword,
  TeamInviteError,
} from "../domain/auth-mail";
import { latestActivity, SIGNUP_SESSION_WINDOW_MS, teamMemberStatus } from "../domain/team-status";
import { SIGN_IN_CODE } from "../domain/audit";

export const teamRoute = new Hono<AppEnv>();

function inviteHttp(err: unknown): never {
  if (err instanceof TeamInviteError) {
    throw new HttpError(err.status, err.message, err.code);
  }
  throw err;
}

/**
 * Mirrors `isSignupSession`: the agentless session better-auth opens when the server signs
 * someone up (an invite, the demo seed). Nobody holds that cookie, so it is not a sign-in.
 */
const signupSession = sql`(trim(coalesce(${schema.session.userAgent}, '')) = '' and ${schema.session.createdAt} - ${schema.user.createdAt} < ${SIGNUP_SESSION_WINDOW_MS})`;

/**
 * How many of the org's newest audited writes to read for "last active". Bounded because
 * audit_events has no actor index: an unbounded per-person max would scan the whole log.
 */
const RECENT_WRITES_WINDOW = 2_000;

teamRoute.get("/team", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  // Sign-out deletes the session row, so sessions alone forget anyone who signed out. Records that
  // outlive it also count: their audited sign-ins (`recordSignIn`; indexed by code, all time), stock
  // moves they made here (indexed, all time) and their audited writes among the org's newest
  // RECENT_WRITES_WINDOW.
  const recentWrites = db
    .select({ actorUserId: schema.auditEvents.actorUserId, createdAt: schema.auditEvents.createdAt })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.organizationId, organizationId))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(RECENT_WRITES_WINDOW)
    .as("recent_writes");
  const movements = schema.inventoryMovements;
  const audit = schema.auditEvents;
  const [rows, writes, signIns] = await Promise.all([
    // One grouped read: each member with their latest real session and latest stock move.
    db
      .select({
        id: schema.memberships.id,
        role: schema.memberships.role,
        floorVerbs: schema.memberships.floorVerbs,
        userId: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        sessionAt: sql<number | null>`max(${schema.session.updatedAt})`,
        movedAt: sql<number | null>`(select max(${movements.createdAt}) from ${movements} where ${movements.organizationId} = ${organizationId} and ${movements.createdBy} = ${schema.memberships.userId})`,
      })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .leftJoin(schema.session, and(eq(schema.session.userId, schema.memberships.userId), not(signupSession)))
      .where(eq(schema.memberships.organizationId, organizationId))
      .groupBy(schema.memberships.id),
    db
      .select({ userId: recentWrites.actorUserId, at: sql<number | null>`max(${recentWrites.createdAt})` })
      .from(recentWrites)
      .groupBy(recentWrites.actorUserId),
    db
      .select({ userId: audit.actorUserId, at: sql<number | null>`max(${audit.createdAt})` })
      .from(audit)
      .where(and(eq(audit.organizationId, organizationId), eq(audit.code, SIGN_IN_CODE)))
      .groupBy(audit.actorUserId),
  ]);
  const wroteAt = new Map<string, number | null>();
  for (const row of writes) if (row.userId) wroteAt.set(row.userId, row.at);
  const signedInAt = new Map<string, number | null>();
  for (const row of signIns) if (row.userId) signedInAt.set(row.userId, row.at);
  return c.json(
    rows.map((row) => {
      const lastActiveAt = latestActivity([
        row.sessionAt,
        row.movedAt,
        wroteAt.get(row.userId),
        signedInAt.get(row.userId),
      ]);
      return {
        id: row.id,
        role: row.role,
        floorVerbs: parseFloorVerbs(row.floorVerbs, row.role),
        userId: row.userId,
        name: row.name,
        email: row.email,
        lastActiveAt,
        status: teamMemberStatus(lastActiveAt),
      };
    }),
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

  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  const organizationName = org?.name || "your warehouse";

  let invite: InviteKind = resolved.emailed ? "created" : "password";
  if (resolved.emailed) {
    notePendingInvite(parsed.email, organizationName);
    const reset = await auth.api
      .requestPasswordReset({
        body: { email: parsed.email, redirectTo: `${origin}/reset-password` },
      })
      .catch(() => null);
    invite = reset ? "emailed" : "created";
  } else if (canMail) {
    await sendMail({
      apiKey: c.env.MAIL_API_KEY!,
      from: c.env.MAIL_FROM!,
      to: parsed.email,
      subject: `You were added to ${organizationName}`,
      text: inviteMailText({
        name: parsed.name,
        organizationName,
        url: `${origin}/login`,
        setPassword: false,
      }),
    }).catch(() => undefined);
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

  // A fresh invite has not signed in yet, whatever session sign-up opened on the server.
  return c.json({ ...row, lastActiveAt: null, status: teamMemberStatus(null), invite }, 201);
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
