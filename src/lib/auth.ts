import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { AppDb } from "../db/stock";
import * as schema from "../db/schema";

export function createAuth(db: AppDb, env: { BETTER_AUTH_SECRET: string; BETTER_AUTH_URL?: string }, origin: string) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origin || env.BETTER_AUTH_URL || "http://localhost:5173",
    trustedOrigins: [
      origin,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ].filter(Boolean),
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
