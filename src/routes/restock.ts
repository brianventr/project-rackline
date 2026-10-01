import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { draftRestockPurchases, loadRestockNeeds } from "../db/restock";
import type { AppEnv } from "../lib/types";
import { requireString } from "../lib/http";
import { requireOwner } from "../lib/org";
import { poolKey, poolLabel } from "../domain/restock";

export const restockRoute = new Hono<AppEnv>();

function present(need: Awaited<ReturnType<typeof loadRestockNeeds>>[number]) {
  return {
    itemId: need.itemId,
    sku: need.sku,
    name: need.name,
    pool: need.pool.kind,
    poolKey: poolKey(need.pool),
    poolLabel: poolLabel(need.pool),
    clientId: need.pool.kind === "client" ? need.pool.clientId : null,
    vendorId: need.vendorId,
    vendorName: need.vendorName,
    makeDays: need.makeDays,
    transitDays: need.transitDays,
    leadDays: need.leadDays,
    learned: need.learned,
    suggestedQty: need.suggestedQty,
    orderByAt: need.orderByAt,
    gap: need.gap,
  };
}

restockRoute.get("/restock", async (c) => {
  const warehouseId = requireString(c.req.query("warehouseId"), "warehouseId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [org] = await db
    .select({ restockPolicy: schema.organizations.restockPolicy })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  const needs = org?.restockPolicy === "off" ? [] : await loadRestockNeeds(db, organizationId, warehouseId);
  return c.json({ policy: org?.restockPolicy ?? "alert", needs: needs.map(present) });
});

/** Opens draft purchases for due restocks. Does not send them. */
restockRoute.post("/restock/draft", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ warehouseId?: string }>().catch(() => ({}) as { warehouseId?: string });
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const result = await draftRestockPurchases(db, organizationId, warehouseId);
  return c.json({ created: result.created, needs: result.needs.map(present) });
});
