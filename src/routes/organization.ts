import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest } from "../lib/http";
import { requireOwner } from "../lib/org";
import { parseOperatingMode } from "../domain/operating-mode";
import { parseBrandColor, parseLogoUrl } from "../domain/branding";

export const organizationRoute = new Hono<AppEnv>();

organizationRoute.patch("/organization", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ operatingMode?: unknown; brandColor?: unknown; logoUrl?: unknown }>();
  const patch: Partial<typeof schema.organizations.$inferInsert> = {};
  try {
    if ("operatingMode" in body) patch.operatingMode = parseOperatingMode(body.operatingMode);
    if ("brandColor" in body) patch.brandColor = parseBrandColor(body.brandColor);
    if ("logoUrl" in body) patch.logoUrl = parseLogoUrl(body.logoUrl);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid organization settings");
  }
  if (Object.keys(patch).length === 0) badRequest("No organization fields to update");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await db.update(schema.organizations).set(patch).where(eq(schema.organizations.id, organizationId));
  const [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return c.json(org);
});
