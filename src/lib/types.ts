import type { AppDb } from "../db/stock";
import type { createAuth } from "./auth";
import type { Role } from "../db/schema";

export type Bindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET?: string;
  MEDIA?: R2Bucket;
};

export type Variables = {
  db: AppDb;
  origin: string;
  user?: { id: string; name: string; email: string };
  organizationId?: string;
  role?: Role;
  auth?: ReturnType<typeof createAuth>;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export function originFrom(url: string): string {
  return new URL(url).origin;
}