import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";

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
  return c.json({
    user,
    organization: org,
    role: c.get("role"),
    warehouses,
  });
});
