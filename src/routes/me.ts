import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { parseFloorVerbs } from "../domain/jobs";

export const meRoute = new Hono<AppEnv>();

meRoute.get("/me", async (c) => {
  const db = c.get("db");
  const user = c.get("user")!;
  const organizationId = c.get("organizationId")!;
  const [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  const warehouses = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId));
  const [membership] = await db
    .select({
      floorVerbs: schema.memberships.floorVerbs,
      role: schema.memberships.role,
      clientId: schema.memberships.clientId,
    })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.userId, user.id)))
    .limit(1);
  return c.json({
    user,
    organization: org,
    role: c.get("role"),
    clientId: c.get("clientId") ?? membership?.clientId ?? null,
    floorVerbs: parseFloorVerbs(membership?.floorVerbs, c.get("role") || "operator"),
    warehouses,
  });
});
