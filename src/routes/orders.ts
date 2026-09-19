import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { chainPlans, planPick, type MovementDraft, type StockPlan } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { fulfillShopifyOrder } from "../domain/shopify-fulfill";
import { canPackOrder, canPickOrder, canShipOrder, canStartPack, canStartPick } from "../domain/status";
import {
  applyPartialPick,
  hasUnpicked,
  isFullyPicked,
  remainingToPick,
  suggestPickBay,
  OverPickError,
  type PickLine,
  type StockedBay,
} from "../domain/partial-pick";

export const ordersRoute = new Hono<AppEnv>();

function asPickLine(line: { id: string; sku: string; qty: number; qtyPicked: number }): PickLine {
  return {
    lineId: line.id,
    sku: line.sku,
    qtyOrdered: line.qty,
    qtyPicked: line.qtyPicked,
  };
}

async function suggestedByItem(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  itemIds: string[],
): Promise<Map<string, StockedBay[]>> {
  const byItem = new Map<string, StockedBay[]>();
  if (itemIds.length === 0) return byItem;
  const rows = await db
    .select({
      itemId: schema.inventoryBalances.itemId,
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      barcode: schema.locations.barcode,
      qty: schema.inventoryBalances.qty,
      type: schema.locations.type,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(eq(schema.inventoryBalances.organizationId, organizationId), inArray(schema.inventoryBalances.itemId, itemIds)),
    );
  for (const row of rows) {
    const list = byItem.get(row.itemId) ?? [];
    list.push({
      locationId: row.locationId,
      locationCode: row.locationCode,
      locationName: row.locationName,
      barcode: row.barcode,
      qty: row.qty,
      type: row.type,
    });
    byItem.set(row.itemId, list);
  }
  return byItem;
}

function withRemaining<T extends { id: string; sku: string; qty: number; qtyPicked: number }>(line: T) {
  return { ...line, remaining: remainingToPick(asPickLine(line)) };
}

async function withSuggestions<T extends { id: string; itemId: string; sku: string; qty: number; qtyPicked: number }>(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  lines: T[],
) {
  const bays = await suggestedByItem(
    db,
    organizationId,
    [...new Set(lines.map((line) => line.itemId))],
  );
  return lines.map((line) => {
    const remaining = remainingToPick(asPickLine(line));
    const suggested = remaining > 0 ? suggestPickBay(bays.get(line.itemId) ?? [], remaining) : null;
    return {
      ...line,
      remaining,
      suggestedLocation: suggested
        ? {
            locationId: suggested.locationId,
            locationCode: suggested.locationCode,
            locationName: suggested.locationName,
            barcode: suggested.barcode,
            qty: suggested.qty,
          }
        : null,
    };
  });
}

async function orderWithLines(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  id: string,
  options: { suggest?: boolean } = { suggest: true },
) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, id), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  if (!order) notFound("Order not found");
  const lines = await db
    .select({
      id: schema.orderLines.id,
      itemId: schema.orderLines.itemId,
      qty: schema.orderLines.qty,
      qtyPicked: schema.orderLines.qtyPicked,
      sku: schema.items.sku,
      itemName: schema.items.name,
      shopifyLineItemId: schema.orderLines.shopifyLineItemId,
      shopifyFulfillmentLineItemId: schema.orderLines.shopifyFulfillmentLineItemId,
    })
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(eq(schema.orderLines.orderId, id));
  return {
    ...order,
    lines: options.suggest ? await withSuggestions(db, organizationId, lines) : lines.map(withRemaining),
  };
}

ordersRoute.get("/orders", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.organizationId, organizationId))
    .orderBy(desc(schema.orders.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.orderLines.id,
      orderId: schema.orderLines.orderId,
      itemId: schema.orderLines.itemId,
      qty: schema.orderLines.qty,
      qtyPicked: schema.orderLines.qtyPicked,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(
      inArray(
        schema.orderLines.orderId,
        rows.map((row) => row.id),
      ),
    );
  const byOrder = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byOrder.get(line.orderId) ?? [];
    list.push(line);
    byOrder.set(line.orderId, list);
  }
  return c.json(
    rows.map((row) => ({
      ...row,
      lines: (byOrder.get(row.id) ?? []).map(withRemaining),
    })),
  );
});

ordersRoute.get("/orders/:id", async (c) => {
  return c.json(await orderWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

ordersRoute.post("/orders", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    customerName?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const customerName = requireString(body.customerName, "customerName");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one order line is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = newId();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), orderId: id, itemId, qty, qtyPicked: 0 });
  }

  await db.batch([
    db.insert(schema.orders).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("ORD"),
      customerName,
      status: "open",
      createdAt: Date.now(),
    }),
    ...lines.map((line) => db.insert(schema.orderLines).values(line)),
  ]);

  return c.json(await orderWithLines(db, organizationId, id), 201);
});

ordersRoute.post("/orders/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canStartPick(order.status)) conflict("Order is not open to start picking");
  await db.update(schema.orders).set({ status: "picking" }).where(eq(schema.orders.id, order.id));
  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/pick", async (c) => {
  const body = await c.req.json<{ locationId?: string; lines?: { lineId?: string; qty?: number }[] }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canPickOrder(order.status)) conflict("Order is not open for picking");
  if (!hasUnpicked(order.lines.map(asPickLine))) conflict("Order has nothing remaining to pick");
  await getOrgLocation(db, organizationId, locationId);

  const incoming =
    Array.isArray(body.lines) && body.lines.length > 0
      ? body.lines.map((line) => ({
          lineId: requireString(line.lineId, "lineId"),
          qty: requireInt(line.qty, "qty"),
        }))
      : order.lines
          .map((line) => ({ lineId: line.id, qty: line.remaining }))
          .filter((line) => line.qty > 0);

  let applied;
  try {
    applied = applyPartialPick(order.lines.map(asPickLine), incoming);
  } catch (err) {
    if (err instanceof OverPickError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid pick");
  }

  const postedByLine = new Map(applied.posted.map((row) => [row.lineId, row.qty]));
  const pickLines = order.lines
    .filter((line) => (postedByLine.get(line.id) ?? 0) > 0)
    .map((line) => ({
      itemId: line.itemId,
      sku: line.sku,
      qty: postedByLine.get(line.id)!,
    }));

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    pickLines.map((line) => ({ locationId, itemId: line.itemId })),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    pickLines.map(
      (line) => (balances) =>
        planPick({
          itemId: line.itemId,
          sku: line.sku,
          locationId,
          qty: line.qty,
          refId: order.id,
          balances,
        }),
    ),
  );

  const now = Date.now();
  const fully = isFullyPicked(applied.next);
  const qtyPickedByLine = new Map(applied.next.map((line) => [line.lineId, line.qtyPicked]));

  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      ...order.lines.map((line) =>
        db
          .update(schema.orderLines)
          .set({ qtyPicked: qtyPickedByLine.get(line.id) ?? line.qtyPicked })
          .where(eq(schema.orderLines.id, line.id)),
      ),
      db
        .update(schema.orders)
        .set({
          status: fully ? "picked" : "picking",
          pickLocationId: locationId,
          pickedAt: fully ? now : order.pickedAt,
        })
        .where(eq(schema.orders.id, order.id)),
    ],
  });

  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/pack", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canPackOrder(order.status)) conflict("Order must be picked before packing");
  const now = Date.now();
  await db
    .update(schema.orders)
    .set({ status: "packed", packedAt: now })
    .where(eq(schema.orders.id, order.id));
  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/start-pack", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canStartPack(order.status)) conflict("Order must be picked before packing");
  await db.update(schema.orders).set({ status: "packing" }).where(eq(schema.orders.id, order.id));
  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/ship", async (c) => {
  const body = await c.req.json<{
    trackingNumber?: string;
    trackingCompany?: string;
    trackingUrl?: string;
  }>().catch(() => ({} as { trackingNumber?: string; trackingCompany?: string; trackingUrl?: string }));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"), { suggest: false });
  if (!canShipOrder(order.status)) conflict("Order must be packed before shipping");
  const locationId = order.pickLocationId;
  if (!locationId) conflict("Pick location missing");

  const movements: MovementDraft[] = order.lines.map((line) => ({
    type: "ship",
    itemId: line.itemId,
    qty: line.qty,
    fromLocationId: locationId,
    refType: "order",
    refId: order.id,
  }));
  const plan: StockPlan = { balances: new Map(), movements };
  const now = Date.now();
  const trackingNumber = body.trackingNumber?.trim() || null;
  const trackingCompany = body.trackingCompany?.trim() || null;
  const trackingUrl = body.trackingUrl?.trim() || null;
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded: new Map(),
    plan,
    extra: [
      db
        .update(schema.orders)
        .set({
          status: "shipped",
          shippedAt: now,
          trackingNumber,
          trackingCompany,
          trackingUrl,
          shopifySyncStatus: order.source === "shopify" ? "pending_fulfill" : order.shopifySyncStatus,
        })
        .where(eq(schema.orders.id, order.id)),
    ],
  });

  let shopify;
  if (order.source === "shopify") {
    shopify = await fulfillShopifyOrder(db, organizationId, order.id);
  }
  return c.json({ ...(await orderWithLines(db, organizationId, order.id)), shopify });
});

ordersRoute.post("/orders/:id/shopify/fulfill", async (c) => {
  const result = await fulfillShopifyOrder(c.get("db"), c.get("organizationId")!, c.req.param("id"));
  const order = await orderWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id"));
  return c.json({ ...order, shopify: result }, result.status === "failed" ? 409 : 200);
});
