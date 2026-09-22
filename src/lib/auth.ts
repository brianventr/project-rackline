import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { AppDb } from "../db/stock";
import * as schema from "../db/schema";
import { resetMailFor } from "../domain/auth-mail";
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

export function createAuth(
  db: AppDb,
  env: { BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string; MAIL_API_KEY?: string; MAIL_FROM?: string },
  origin: string,
) {
  return betterAuth({
    secret: resolveAuthSecret(env, origin),
    baseURL: origin || env.BETTER_AUTH_URL || "http://localhost:5173",
    trustedOrigins: [origin, env.BETTER_AUTH_URL, "http://localhost:5173", "http://127.0.0.1:5173"].filter(
      (value): value is string => Boolean(value),
    ),
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
