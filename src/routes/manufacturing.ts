import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation, requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { planCompleteWorkOrder } from "../domain/manufacturing";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { canCompleteWorkOrder } from "../domain/status";
import { loadAsBuiltForRef } from "../db/as-built";

export const manufacturingRoute = new Hono<AppEnv>();

async function bomWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [bom] = await db
    .select({
      id: schema.boms.id,
      itemId: schema.boms.itemId,
      createdAt: schema.boms.createdAt,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.boms)
    .innerJoin(schema.items, eq(schema.items.id, schema.boms.itemId))
    .where(and(eq(schema.boms.id, id), eq(schema.boms.organizationId, organizationId)))
    .limit(1);
  if (!bom) notFound("BOM not found");
  const lines = await db
    .select({
      id: schema.bomLines.id,
      itemId: schema.bomLines.itemId,
      qty: schema.bomLines.qty,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.bomLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.bomLines.itemId))
    .where(eq(schema.bomLines.bomId, id));
  return { ...bom, lines };
}

manufacturingRoute.get("/boms", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const headers = await db
    .select({
      id: schema.boms.id,
      itemId: schema.boms.itemId,
      sku: schema.items.sku,
      itemName: schema.items.name,
      createdAt: schema.boms.createdAt,
    })
    .from(schema.boms)
    .innerJoin(schema.items, eq(schema.items.id, schema.boms.itemId))
    .where(eq(schema.boms.organizationId, organizationId));

  const result = [];
  for (const bom of headers) {
    result.push(await bomWithLines(db, organizationId, bom.id));
  }
  return c.json(result);
});

manufacturingRoute.post("/boms", async (c) => {
  const body = await c.req.json<{
    itemId?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const itemId = requireString(body.itemId, "itemId");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("BOM needs at least one component");
  }
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const parent = await getOrgItem(db, organizationId, itemId);
  if (parent.type !== "finished" && parent.type !== "wip") {
    badRequest("BOM parent must be a finished or WIP item");
  }

  const id = newId();
  const lines = [];
  for (const line of body.lines) {
    const componentId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Component quantity must be positive");
    if (componentId === itemId) badRequest("An item cannot be a component of itself");
    await getOrgItem(db, organizationId, componentId);
    lines.push({ id: newId(), bomId: id, itemId: componentId, qty });
  }

  try {
    await db.batch([
      db.insert(schema.boms).values({
        id,
        organizationId,
        itemId,
        createdAt: Date.now(),
      }),
      ...lines.map((line) => db.insert(schema.bomLines).values(line)),
    ]);
  } catch {
    return c.json({ error: "A BOM already exists for this item" }, 409);
  }

  return c.json(await bomWithLines(db, organizationId, id), 201);
});

manufacturingRoute.delete("/boms/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await bomWithLines(db, organizationId, c.req.param("id"));
  await db
    .delete(schema.boms)
    .where(and(eq(schema.boms.id, c.req.param("id")), eq(schema.boms.organizationId, organizationId)));
  return c.json({ ok: true });
});

async function workOrderWithItem(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select({
      id: schema.workOrders.id,
      number: schema.workOrders.number,
      itemId: schema.workOrders.itemId,
      qty: schema.workOrders.qty,
      status: schema.workOrders.status,
      warehouseId: schema.workOrders.warehouseId,
      sourceLocationId: schema.workOrders.sourceLocationId,
      outputLocationId: schema.workOrders.outputLocationId,
      createdAt: schema.workOrders.createdAt,
      completedAt: schema.workOrders.completedAt,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.workOrders)
    .innerJoin(schema.items, eq(schema.items.id, schema.workOrders.itemId))
    .where(and(eq(schema.workOrders.id, id), eq(schema.workOrders.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Work order not found");
  const asBuilt = await loadAsBuiltForRef(db, organizationId, row.id);
  return { ...row, asBuilt };
}

manufacturingRoute.get("/work-orders", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.workOrders.id,
      number: schema.workOrders.number,
      itemId: schema.workOrders.itemId,
      qty: schema.workOrders.qty,
      status: schema.workOrders.status,
      warehouseId: schema.workOrders.warehouseId,
      sourceLocationId: schema.workOrders.sourceLocationId,
      outputLocationId: schema.workOrders.outputLocationId,
      createdAt: schema.workOrders.createdAt,
      completedAt: schema.workOrders.completedAt,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.workOrders)
    .innerJoin(schema.items, eq(schema.items.id, schema.workOrders.itemId))
    .where(eq(schema.workOrders.organizationId, organizationId))
    .orderBy(desc(schema.workOrders.createdAt));
  return c.json(rows);
});

manufacturingRoute.get("/work-orders/:id", async (c) => {
  return c.json(await workOrderWithItem(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

manufacturingRoute.post("/work-orders", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    itemId?: string;
    qty?: number;
    sourceLocationId?: string;
    outputLocationId?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const itemId = requireString(body.itemId, "itemId");
  const qty = requireInt(body.qty, "qty");
  const sourceLocationId = requireString(body.sourceLocationId, "sourceLocationId");
  const outputLocationId = requireString(body.outputLocationId, "outputLocationId");
  if (qty <= 0) badRequest("Quantity must be positive");

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgItem(db, organizationId, itemId);
  await getOrgLocation(db, organizationId, sourceLocationId);
  await getOrgLocation(db, organizationId, outputLocationId);

  const [bom] = await db
    .select()
    .from(schema.boms)
    .where(and(eq(schema.boms.organizationId, organizationId), eq(schema.boms.itemId, itemId)))
    .limit(1);
  if (!bom) badRequest("Create a BOM for this item before releasing a work order");

  const [row] = await db
    .insert(schema.workOrders)
    .values({
      id: newId(),
      organizationId,
      warehouseId,
      number: docNumber("WO"),
      itemId,
      qty,
      status: "draft",
      sourceLocationId,
      outputLocationId,
      createdAt: Date.now(),
    })
    .returning();

  return c.json(row, 201);
});

manufacturingRoute.post("/work-orders/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const wo = await workOrderWithItem(db, organizationId, c.req.param("id"));
  if (wo.status !== "draft") conflict("Work order is not a draft");
  await db.update(schema.workOrders).set({ status: "in_progress" }).where(eq(schema.workOrders.id, wo.id));
  return c.json(await workOrderWithItem(db, organizationId, wo.id));
});

manufacturingRoute.post("/work-orders/:id/complete", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const wo = await workOrderWithItem(db, organizationId, c.req.param("id"));
  if (!canCompleteWorkOrder(wo.status)) conflict("Work order already completed");

  const [bom] = await db
    .select()
    .from(schema.boms)
    .where(and(eq(schema.boms.organizationId, organizationId), eq(schema.boms.itemId, wo.itemId)))
    .limit(1);
  if (!bom) badRequest("BOM is missing");

  const components = await db
    .select({
      itemId: schema.bomLines.itemId,
      qty: schema.bomLines.qty,
      sku: schema.items.sku,
    })
    .from(schema.bomLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.bomLines.itemId))
    .where(eq(schema.bomLines.bomId, bom.id));

  const pairs = [
    ...components.map((line) => ({ locationId: wo.sourceLocationId, itemId: line.itemId })),
    { locationId: wo.outputLocationId, itemId: wo.itemId },
  ];
  const loaded = await loadBalanceMap(db, organizationId, pairs);
  const plan = planCompleteWorkOrder({
    workOrderId: wo.id,
    finishedItemId: wo.itemId,
    finishedSku: wo.sku,
    qty: wo.qty,
    sourceLocationId: wo.sourceLocationId,
    outputLocationId: wo.outputLocationId,
    bomLines: components,
    balances: qtyMap(loaded),
  });

  const now = Date.now();
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.workOrders)
        .set({ status: "completed", completedAt: now })
        .where(eq(schema.workOrders.id, wo.id)),
    ],
  });

  return c.json(await workOrderWithItem(db, organizationId, wo.id));
});
