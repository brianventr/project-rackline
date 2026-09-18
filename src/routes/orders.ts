import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { chainPlans, planPick, type MovementDraft, type StockPlan } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";

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
    })
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(eq(schema.orderLines.orderId, id));
  return { ...order, lines };
}

ordersRoute.get("/orders", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.orders.createdAt));
  return c.json(rows);
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
    lines.push({ id: newId(), orderId: id, itemId, qty });
  }

  await db.batch([
    db.insert(schema.orders).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("ORD"),
      customerName,
      status: "draft",
      createdAt: Date.now(),
    }),
    ...lines.map((line) => db.insert(schema.orderLines).values(line)),
  ]);

  return c.json(await orderWithLines(db, organizationId, id), 201);
});

ordersRoute.post("/orders/:id/pick", async (c) => {
  const body = await c.req.json<{ locationId?: string }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"));
  if (order.status !== "draft") conflict("Order is not open for picking");
  await getOrgLocation(db, organizationId, locationId);

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    order.lines.map((line) => ({ locationId, itemId: line.itemId })),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    order.lines.map((line) => (balances) =>
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

ordersRoute.post("/orders/:id/ship", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const order = await orderWithLines(db, organizationId, c.req.param("id"));
  if (order.status !== "picked") conflict("Order must be picked before shipping");
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
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded: new Map(),
    plan,
    extra: [
      db.update(schema.orders).set({ status: "shipped", shippedAt: now }).where(eq(schema.orders.id, order.id)),
    ],
  });

  return c.json(await orderWithLines(db, organizationId, order.id));
});
