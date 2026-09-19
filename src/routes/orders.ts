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
import { buildShippingLabel, isCarrierService, resolveCarrier } from "../domain/shipping-label";
import { parseSerialList } from "../domain/lots";

export const ordersRoute = new Hono<AppEnv>();

async function orderWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
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
      sku: schema.items.sku,
      itemName: schema.items.name,
      shopifyLineItemId: schema.orderLines.shopifyLineItemId,
      shopifyFulfillmentLineItemId: schema.orderLines.shopifyFulfillmentLineItemId,
    })
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(eq(schema.orderLines.orderId, id));
  return { ...order, lines };
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
  return c.json(rows.map((row) => ({ ...row, lines: byOrder.get(row.id) ?? [] })));
});

ordersRoute.get("/orders/:id", async (c) => {
  return c.json(await orderWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

ordersRoute.post("/orders", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    customerName?: string;
    shipToAddress?: string;
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
    lines.push({ id: newId(), orderId: id, itemId, qty });
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
      shipToAddress: body.shipToAddress?.trim() || null,
    }),
    ...lines.map((line) => db.insert(schema.orderLines).values(line)),
  ]);

  return c.json(await orderWithLines(db, organizationId, id), 201);
});

ordersRoute.post("/orders/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"));
  if (!canStartPick(order.status)) conflict("Order is not open to start picking");
  await db.update(schema.orders).set({ status: "picking" }).where(eq(schema.orders.id, order.id));
  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/pick", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: { itemId?: string; lotCode?: string; serials?: string | string[] }[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"));
  if (!canPickOrder(order.status)) conflict("Order is not open for picking");
  await getOrgLocation(db, organizationId, locationId);

  const traceByItem = new Map(
    (body.lines ?? []).map((line) => [
      requireString(line.itemId, "itemId"),
      {
        lotCode: line.lotCode?.trim() || null,
        serials: parseSerialList(line.serials),
      },
    ]),
  );

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    order.lines.map((line) => ({ locationId, itemId: line.itemId })),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    order.lines.map((line) => (balances) => {
      const trace = traceByItem.get(line.itemId);
      return planPick({
        itemId: line.itemId,
        sku: line.sku,
        locationId,
        qty: line.qty,
        refId: order.id,
        balances,
        lotCode: trace?.lotCode,
        serials: trace?.serials.length ? trace.serials : null,
      });
    }),
  );

  const now = Date.now();
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.orders)
        .set({ status: "picked", pickLocationId: locationId, pickedAt: now })
        .where(eq(schema.orders.id, order.id)),
    ],
  });

  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.post("/orders/:id/pack", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"));
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
  const order = await orderWithLines(db, organizationId, c.req.param("id"));
  if (!canStartPack(order.status)) conflict("Order must be picked before packing");
  await db.update(schema.orders).set({ status: "packing" }).where(eq(schema.orders.id, order.id));
  return c.json(await orderWithLines(db, organizationId, order.id));
});

ordersRoute.get("/orders/:id/label", async (c) => {
  const order = await orderWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id"));
  return c.json(buildShippingLabel(order));
});

ordersRoute.post("/orders/:id/label", async (c) => {
  const body = await c.req
    .json<{
      trackingNumber?: string;
      trackingCompany?: string;
      trackingUrl?: string;
      carrierService?: string;
      shipToAddress?: string;
    }>()
    .catch(
      () =>
        ({}) as {
          trackingNumber?: string;
          trackingCompany?: string;
          trackingUrl?: string;
          carrierService?: string;
          shipToAddress?: string;
        },
    );
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"));
  const status = order.status === "draft" ? "open" : order.status;
  if (status === "cancelled") conflict("Cancelled orders cannot take a label");
  const carrierService =
    body.carrierService?.trim() || order.carrierService || "rackline_ground";
  if (!isCarrierService(carrierService)) badRequest("Unknown carrier service");
  const carrier = resolveCarrier(carrierService);
  const shipToAddress = body.shipToAddress?.trim() || order.shipToAddress;
  const label = buildShippingLabel({
    ...order,
    shipToAddress,
    trackingNumber: body.trackingNumber?.trim() || order.trackingNumber,
    trackingCompany: body.trackingCompany?.trim() || order.trackingCompany || carrier.company,
    trackingUrl: body.trackingUrl?.trim() || order.trackingUrl,
    carrierService,
  });
  await db
    .update(schema.orders)
    .set({
      trackingNumber: label.trackingNumber,
      trackingCompany: label.carrierCompany,
      trackingUrl: label.trackingUrl,
      carrierService: label.carrierServiceId,
      shipToAddress: label.shipToAddress,
    })
    .where(eq(schema.orders.id, order.id));
  return c.json(buildShippingLabel(await orderWithLines(db, organizationId, order.id)));
});

ordersRoute.post("/orders/:id/ship", async (c) => {
  const body = await c.req.json<{
    trackingNumber?: string;
    trackingCompany?: string;
    trackingUrl?: string;
    carrierService?: string;
    shipToAddress?: string;
  }>().catch(() => ({} as {
    trackingNumber?: string;
    trackingCompany?: string;
    trackingUrl?: string;
    carrierService?: string;
    shipToAddress?: string;
  }));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"));
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
  const carrierService = body.carrierService?.trim() || order.carrierService || "rackline_ground";
  if (!isCarrierService(carrierService)) badRequest("Unknown carrier service");
  const label = buildShippingLabel({
    ...order,
    shipToAddress: body.shipToAddress?.trim() || order.shipToAddress,
    trackingNumber: body.trackingNumber?.trim() || order.trackingNumber,
    trackingCompany: body.trackingCompany?.trim() || order.trackingCompany,
    trackingUrl: body.trackingUrl?.trim() || order.trackingUrl,
    carrierService,
  });
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
          trackingNumber: label.trackingNumber,
          trackingCompany: label.carrierCompany,
          trackingUrl: label.trackingUrl,
          carrierService: label.carrierServiceId,
          shipToAddress: label.shipToAddress,
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
