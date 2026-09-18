import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner, isItemType, isLocationType, getOrgLocation } from "../lib/org";
import { badRequest, requireString } from "../lib/http";
import { newId } from "../lib/ids";

export const catalogRoute = new Hono<AppEnv>();

catalogRoute.get("/warehouses", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId));
  return c.json(rows);
});

catalogRoute.post("/warehouses", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ name?: string }>();
  const name = requireString(body.name, "name");
  const [row] = await c
    .get("db")
    .insert(schema.warehouses)
    .values({
      id: newId(),
      organizationId: c.get("organizationId")!,
      name,
      createdAt: Date.now(),
    })
    .returning();
  return c.json(row, 201);
});

catalogRoute.get("/locations", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.locations.id,
      code: schema.locations.code,
      name: schema.locations.name,
      type: schema.locations.type,
      warehouseId: schema.locations.warehouseId,
      warehouseName: schema.warehouses.name,
    })
    .from(schema.locations)
    .innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.locations.warehouseId))
    .where(eq(schema.locations.organizationId, organizationId))
    .orderBy(schema.locations.code);
  return c.json(rows);
});

catalogRoute.post("/locations", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    code?: string;
    name?: string;
    type?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const code = requireString(body.code, "code").toUpperCase();
  const name = requireString(body.name, "name");
  const type = requireString(body.type, "type");
  if (!isLocationType(type)) badRequest("Invalid location type");

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  if (!warehouse) badRequest("Warehouse not found");

  try {
    const [row] = await db
      .insert(schema.locations)
      .values({
        id: newId(),
        organizationId,
        warehouseId,
        code,
        name,
        type,
      })
      .returning();
    return c.json(row, 201);
  } catch {
    return c.json({ error: "Location code already exists in this warehouse" }, 409);
  }
});

catalogRoute.delete("/locations/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgLocation(db, organizationId, c.req.param("id"));
  await db
    .delete(schema.locations)
    .where(and(eq(schema.locations.id, c.req.param("id")), eq(schema.locations.organizationId, organizationId)));
  return c.json({ ok: true });
});

catalogRoute.get("/items", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId))
    .orderBy(schema.items.sku);
  return c.json(rows);
});

catalogRoute.post("/items", async (c) => {
  const body = await c.req.json<{ sku?: string; name?: string; type?: string }>();
  const sku = requireString(body.sku, "sku").toUpperCase();
  const name = requireString(body.name, "name");
  const type = requireString(body.type, "type");
  if (!isItemType(type)) badRequest("Invalid item type");
  try {
    const [row] = await c
      .get("db")
      .insert(schema.items)
      .values({
        id: newId(),
        organizationId: c.get("organizationId")!,
        sku,
        name,
        type,
        createdAt: Date.now(),
      })
      .returning();
    return c.json(row, 201);
  } catch {
    return c.json({ error: "SKU already exists" }, 409);
  }
});

catalogRoute.delete("/items/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await db
    .delete(schema.items)
    .where(and(eq(schema.items.id, c.req.param("id")), eq(schema.items.organizationId, organizationId)));
  return c.json({ ok: true });
});

catalogRoute.get("/inventory", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.inventoryBalances.id,
      qty: schema.inventoryBalances.qty,
      updatedAt: schema.inventoryBalances.updatedAt,
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      itemType: schema.items.type,
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      locationType: schema.locations.type,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(eq(schema.inventoryBalances.organizationId, organizationId))
    .orderBy(schema.items.sku, schema.locations.code);
  return c.json(rows);
});

catalogRoute.get("/movements", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.inventoryMovements.id,
      type: schema.inventoryMovements.type,
      qty: schema.inventoryMovements.qty,
      refType: schema.inventoryMovements.refType,
      refId: schema.inventoryMovements.refId,
      reason: schema.inventoryMovements.reason,
      createdAt: schema.inventoryMovements.createdAt,
      sku: schema.items.sku,
      itemName: schema.items.name,
      fromLocationId: schema.inventoryMovements.fromLocationId,
      toLocationId: schema.inventoryMovements.toLocationId,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryMovements.itemId))
    .where(eq(schema.inventoryMovements.organizationId, organizationId))
    .orderBy(desc(schema.inventoryMovements.createdAt))
    .limit(50);
  return c.json(rows);
});

catalogRoute.get("/dashboard", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;

  const [onHand] = await db
    .select({
      units: sql<number>`coalesce(sum(${schema.inventoryBalances.qty}), 0)`,
      bins: sql<number>`count(*)`,
    })
    .from(schema.inventoryBalances)
    .where(eq(schema.inventoryBalances.organizationId, organizationId));

  const [skuCount] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));

  const [openReceipts] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.receipts)
    .where(and(eq(schema.receipts.organizationId, organizationId), eq(schema.receipts.status, "draft")));

  const [openOrders] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.orders)
    .where(
      and(eq(schema.orders.organizationId, organizationId), sql`${schema.orders.status} != 'shipped'`),
    );

  const [openWorkOrders] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.workOrders)
    .where(and(eq(schema.workOrders.organizationId, organizationId), eq(schema.workOrders.status, "draft")));

  const recent = await db
    .select({
      id: schema.inventoryMovements.id,
      type: schema.inventoryMovements.type,
      qty: schema.inventoryMovements.qty,
      createdAt: schema.inventoryMovements.createdAt,
      sku: schema.items.sku,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryMovements.itemId))
    .where(eq(schema.inventoryMovements.organizationId, organizationId))
    .orderBy(desc(schema.inventoryMovements.createdAt))
    .limit(8);

  return c.json({
    onHandUnits: Number(onHand?.units ?? 0),
    binRows: Number(onHand?.bins ?? 0),
    skuCount: Number(skuCount?.n ?? 0),
    openReceipts: Number(openReceipts?.n ?? 0),
    openOrders: Number(openOrders?.n ?? 0),
    openWorkOrders: Number(openWorkOrders?.n ?? 0),
    recent,
  });
});
