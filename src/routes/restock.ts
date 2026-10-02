import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { draftRestockPurchases, loadRestockBoard } from "../db/restock";
import type { AppEnv } from "../lib/types";
import { requireString } from "../lib/http";
import { requireOwner } from "../lib/org";
import { poolKey, poolLabel } from "../domain/restock";

export const restockRoute = new Hono<AppEnv>();

function present(need: Awaited<ReturnType<typeof loadRestockBoard>>[number]) {
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
    rate: need.rate,
    daysOfCover: need.daysOfCover,
    suggestedQty: need.suggestedQty,
    orderByAt: need.orderByAt,
    due: need.due,
    gap: need.gap,
    purchaseId: need.purchaseId,
    purchaseNumber: need.purchaseNumber,
    asnId: need.asnId,
    asnNumber: need.asnNumber,
    asnMilestone: need.asnMilestone,
    freightAt: need.freightAt,
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
  const rows = await loadRestockBoard(db, organizationId, warehouseId);
  return c.json({ policy: org?.restockPolicy ?? "alert", rows: rows.map(present) });
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
