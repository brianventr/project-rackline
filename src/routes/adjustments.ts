import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { newId } from "../lib/ids";
import { planAdjust } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";

export const adjustmentsRoute = new Hono<AppEnv>();

adjustmentsRoute.post("/adjustments", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    itemId?: string;
    qtyDelta?: number;
    reason?: string;
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const itemId = requireString(body.itemId, "itemId");
  const qtyDelta = requireInt(body.qtyDelta, "qtyDelta");
  const reason = requireString(body.reason, "reason");

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const item = await getOrgItem(db, organizationId, itemId);
  await getOrgLocation(db, organizationId, locationId);

  const loaded = await loadBalanceMap(db, organizationId, [{ locationId, itemId }]);
  const plan = planAdjust({
    itemId,
    sku: item.sku,
    locationId,
    qtyDelta,
    reason,
    refId: newId(),
    balances: qtyMap(loaded),
  });

  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now: Date.now(),
    loaded,
    plan,
  });

  return c.json({ ok: true });
});
