import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest } from "../lib/http";
import { requireOwner } from "../lib/org";
import { parseOperatingMode } from "../domain/operating-mode";

export const organizationRoute = new Hono<AppEnv>();

organizationRoute.patch("/organization", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ operatingMode?: unknown }>();
  let operatingMode;
  try {
    operatingMode = parseOperatingMode(body.operatingMode);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid operating mode");
  }
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await db
    .update(schema.organizations)
    .set({ operatingMode })
    .where(eq(schema.organizations.id, organizationId));
  const [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return c.json(org);
});
