import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type { AppDb } from "../db/stock";
import * as schema from "../db/schema";
import { resetMailFor } from "../domain/auth-mail";
import { signInAudit } from "../domain/audit";
import { isSignupSession } from "../domain/team-status";
import { newId } from "./ids";
import { sendMail } from "./mail";

const LOCAL_DEV_SECRET = "dev-only-local-secret-do-not-use-in-prod-32ch";

export function resolveAuthSecret(env: { BETTER_AUTH_SECRET?: string }, origin: string): string {
  const fromEnv = env.BETTER_AUTH_SECRET?.trim() ?? "";
  if (fromEnv.length >= 32) return fromEnv;
  if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
    return LOCAL_DEV_SECRET;
  }
  throw new Error("BETTER_AUTH_SECRET must be set (32+ characters)");
}

function timeOf(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number(value);
}

/**
 * Audit a sign-in in every org the person belongs to, so the Team list still knows they have used
 * Rackline after sign-out deletes the session row. The agentless session a server-side sign-up
 * opens (a team invite, the demo seed) is nobody signing in, so it is skipped, as `GET /api/team`
 * skips it. Never fails the sign-in.
 */
export async function recordSignIn(
  db: AppDb,
  session: { userId: string; createdAt: unknown; userAgent?: string | null },
  endpointPath: unknown,
): Promise<void> {
  try {
    const [person] = await db
      .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, createdAt: schema.user.createdAt })
      .from(schema.user)
      .where(eq(schema.user.id, session.userId))
      .limit(1);
    if (!person) return;
    if (isSignupSession({ createdAt: timeOf(session.createdAt), userAgent: session.userAgent }, timeOf(person.createdAt))) {
      return;
    }
    const orgs = await db
      .select({ organizationId: schema.memberships.organizationId })
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, person.id));
    if (!orgs.length) return;
    const event = signInAudit(endpointPath);
    const now = Date.now();
    await db.insert(schema.auditEvents).values(
      orgs.map((row) => ({
        id: newId(),
        organizationId: row.organizationId,
        actorUserId: person.id,
        actorEmail: person.email,
        actorName: person.name,
        ...event,
        payloadJson: null,
        createdAt: now,
      })),
    );
  } catch (err) {
    console.error("sign-in audit write failed", err);
  }
}

export function createAuth(
  db: AppDb,
  env: { BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string; MAIL_API_KEY?: string; MAIL_FROM?: string },
  origin: string,
) {
  return betterAuth({
    secret: resolveAuthSecret(env, origin),
    baseURL: origin || env.BETTER_AUTH_URL || "http://localhost:5173",
    trustedOrigins: [origin, "http://localhost:5173", "http://127.0.0.1:5173"].filter(Boolean),
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        const apiKey = env.MAIL_API_KEY?.trim();
        const from = env.MAIL_FROM?.trim();
        const mail = resetMailFor(user, url);
        if (apiKey && from) {
          await sendMail({
            apiKey,
            from,
            to: user.email,
            subject: mail.subject,
            text: mail.text,
          });
          return;
        }
        console.info(`[auth] password reset for ${user.email}: ${url}`);
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session, context) => {
            await recordSignIn(db, session, (context as { path?: unknown } | null)?.path);
          },
        },
      },
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: origin.startsWith("https"),
        path: "/",
        httpOnly: true,
      },
    },
  });
}
