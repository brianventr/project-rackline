import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, requireString } from "../lib/http";
import { requireOwner } from "../lib/org";
import { newId } from "../lib/ids";
import { CARRIER_SERVICES } from "../domain/shipping-label";

export const carriersRoute = new Hono<AppEnv>();

carriersRoute.get("/carriers", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const accounts = await db
    .select()
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.organizationId, organizationId));
  return c.json({
    services: CARRIER_SERVICES,
    accounts,
  });
});

carriersRoute.post("/carriers", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ carrier?: string; accountNumber?: string; mode?: string }>();
  const carrier = requireString(body.carrier, "carrier").toLowerCase();
  const accountNumber = requireString(body.accountNumber, "accountNumber");
  const mode = body.mode?.trim() === "live" ? "live" : "demo";
  if (!CARRIER_SERVICES.some((row) => row.id === carrier || row.company.toLowerCase() === carrier)) {
    badRequest("Unknown carrier");
  }
  const serviceId = CARRIER_SERVICES.find((row) => row.id === carrier || row.company.toLowerCase() === carrier)!.id;
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const now = Date.now();
  const [existing] = await db
    .select()
    .from(schema.carrierAccounts)
    .where(
      and(eq(schema.carrierAccounts.organizationId, organizationId), eq(schema.carrierAccounts.carrier, serviceId)),
    )
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(schema.carrierAccounts)
      .set({ accountNumber, mode })
      .where(eq(schema.carrierAccounts.id, existing.id))
      .returning();
    return c.json(row);
  }
  const id = newId();
  await db.insert(schema.carrierAccounts).values({
    id,
    organizationId,
    carrier: serviceId,
    accountNumber,
    mode,
    createdAt: now,
  });
  const [row] = await db.select().from(schema.carrierAccounts).where(eq(schema.carrierAccounts.id, id)).limit(1);
  return c.json(row, 201);
});
