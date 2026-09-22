import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";

export const auditRoute = new Hono<AppEnv>();

auditRoute.get("/audit", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const limitRaw = Number(c.req.query("limit") ?? 100);
  const limit = Number.isInteger(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 100;
  const rows = await db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.organizationId, organizationId))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(limit);
  return c.json(rows);
});
