import { Hono } from "hono";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner, isItemType, isLocationType, getOrgLocation } from "../lib/org";
import { badRequest, requireInt, requireString, optionalInt, optionalString } from "../lib/http";
import { newId } from "../lib/ids";
import { suggestPlacement } from "../domain/map-layout";

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

catalogRoute.patch("/warehouses/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    name?: string;
    mapWidth?: number;
    mapDepth?: number;
    mapHeight?: number;
  }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = c.req.param("id");
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, id), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  if (!warehouse) badRequest("Warehouse not found");

  const patch: { name?: string; mapWidth?: number; mapDepth?: number; mapHeight?: number } = {};
  const name = optionalString(body.name);
  if (name) patch.name = name;
  const mapWidth = optionalInt(body.mapWidth, "mapWidth");
  if (mapWidth !== undefined) {
    if (mapWidth <= 0) badRequest("mapWidth must be positive");
    patch.mapWidth = mapWidth;
  }
  const mapDepth = optionalInt(body.mapDepth, "mapDepth");
  if (mapDepth !== undefined) {
    if (mapDepth <= 0) badRequest("mapDepth must be positive");
    patch.mapDepth = mapDepth;
  }
  const mapHeight = optionalInt(body.mapHeight, "mapHeight");
  if (mapHeight !== undefined) {
    if (mapHeight <= 0) badRequest("mapHeight must be positive");
    patch.mapHeight = mapHeight;
  }
  if (Object.keys(patch).length === 0) badRequest("No warehouse fields to update");

  const [row] = await db
    .update(schema.warehouses)
    .set(patch)
    .where(eq(schema.warehouses.id, id))
    .returning();
  return c.json(row);
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
      barcode: schema.locations.barcode,
      area: schema.locations.area,
      aisle: schema.locations.aisle,
      rack: schema.locations.rack,
      bay: schema.locations.bay,
      level: schema.locations.level,
      posX: schema.locations.posX,
      posY: schema.locations.posY,
      posZ: schema.locations.posZ,
      sizeX: schema.locations.sizeX,
      sizeY: schema.locations.sizeY,
      sizeZ: schema.locations.sizeZ,
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
    barcode?: string;
    area?: string;
    aisle?: string;
    rack?: string;
    bay?: string;
    level?: number;
    posX?: number;
    posY?: number;
    posZ?: number;
    sizeX?: number;
    sizeY?: number;
    sizeZ?: number;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const code = requireString(body.code, "code").toUpperCase();
  const name = requireString(body.name, "name");
  const type = requireString(body.type, "type");
  if (!isLocationType(type)) badRequest("Invalid location type");
  const barcode = (optionalString(body.barcode) ?? code).toUpperCase();

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  if (!warehouse) badRequest("Warehouse not found");

  const existing = await db
    .select()
    .from(schema.locations)
    .where(and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.warehouseId, warehouseId)));
  const placement = suggestPlacement(
    existing,
    {
      type,
      area: optionalString(body.area),
      aisle: optionalString(body.aisle),
      rack: optionalString(body.rack),
      bay: optionalString(body.bay),
      level: optionalInt(body.level, "level"),
      posX: optionalInt(body.posX, "posX"),
      posY: optionalInt(body.posY, "posY"),
      posZ: optionalInt(body.posZ, "posZ"),
      sizeX: optionalInt(body.sizeX, "sizeX"),
      sizeY: optionalInt(body.sizeY, "sizeY"),
      sizeZ: optionalInt(body.sizeZ, "sizeZ"),
    },
    warehouse,
  );

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
        barcode,
        area: placement.area,
        aisle: placement.aisle,
        rack: placement.rack,
        bay: placement.bay,
        level: placement.level,
        posX: placement.posX,
        posY: placement.posY,
        posZ: placement.posZ,
        sizeX: placement.sizeX,
        sizeY: placement.sizeY,
        sizeZ: placement.sizeZ,
      })
      .returning();
    return c.json(row, 201);
  } catch {
    return c.json({ error: "Location code or barcode already exists in this warehouse" }, 409);
  }
});

catalogRoute.patch("/locations/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    name?: string;
    barcode?: string;
    area?: string;
    aisle?: string | null;
    rack?: string | null;
    bay?: string | null;
    level?: number;
    posX?: number;
    posY?: number;
    posZ?: number;
    sizeX?: number;
    sizeY?: number;
    sizeZ?: number;
  }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgLocation(db, organizationId, c.req.param("id"));

  const patch: Record<string, string | number | null> = {};
  const name = optionalString(body.name);
  if (name) patch.name = name;
  const barcode = optionalString(body.barcode);
  if (barcode) patch.barcode = barcode.toUpperCase();
  const area = optionalString(body.area);
  if (area) patch.area = area;
  if (body.aisle !== undefined) patch.aisle = body.aisle ? String(body.aisle).trim().toUpperCase() : null;
  if (body.rack !== undefined) patch.rack = body.rack ? String(body.rack).trim() : null;
  if (body.bay !== undefined) patch.bay = body.bay ? String(body.bay).trim() : null;
  const level = optionalInt(body.level, "level");
  if (level !== undefined) patch.level = level;
  const posX = optionalInt(body.posX, "posX");
  if (posX !== undefined) patch.posX = posX;
  const posY = optionalInt(body.posY, "posY");
  if (posY !== undefined) patch.posY = posY;
  const posZ = optionalInt(body.posZ, "posZ");
  if (posZ !== undefined) patch.posZ = posZ;
  const sizeX = optionalInt(body.sizeX, "sizeX");
  if (sizeX !== undefined) patch.sizeX = sizeX;
  const sizeY = optionalInt(body.sizeY, "sizeY");
  if (sizeY !== undefined) patch.sizeY = sizeY;
  const sizeZ = optionalInt(body.sizeZ, "sizeZ");
  if (sizeZ !== undefined) patch.sizeZ = sizeZ;

  if (Object.keys(patch).length === 0) badRequest("No location fields to update");

  try {
    const [row] = await db
      .update(schema.locations)
      .set(patch as Partial<typeof schema.locations.$inferInsert>)
      .where(and(eq(schema.locations.id, c.req.param("id")), eq(schema.locations.organizationId, organizationId)))
      .returning();
    return c.json(row);
  } catch {
    return c.json({ error: "Barcode already exists" }, 409);
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

catalogRoute.get("/items/:id", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [item] = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.id, c.req.param("id")), eq(schema.items.organizationId, organizationId)))
    .limit(1);
  if (!item) return c.json({ error: "Item not found" }, 404);
  const onHand = await db
    .select({
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      barcode: schema.locations.barcode,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(eq(schema.inventoryBalances.organizationId, organizationId), eq(schema.inventoryBalances.itemId, item.id)),
    );
  return c.json({ ...item, onHand });
});

catalogRoute.get("/locations/:id", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const location = await getOrgLocation(db, organizationId, c.req.param("id"));
  const contents = await db
    .select({
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      itemType: schema.items.type,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        eq(schema.inventoryBalances.locationId, location.id),
      ),
    );
  return c.json({ ...location, contents });
});

catalogRoute.post("/items", async (c) => {
  const body = await c.req.json<{
    sku?: string;
    name?: string;
    type?: string;
    reorderPoint?: number;
    barcode?: string;
  }>();
  const sku = requireString(body.sku, "sku").toUpperCase();
  const name = requireString(body.name, "name");
  const type = requireString(body.type, "type");
  if (!isItemType(type)) badRequest("Invalid item type");
  const barcode = (optionalString(body.barcode) ?? sku).toUpperCase();
  const reorderPoint = body.reorderPoint === undefined ? 0 : requireInt(body.reorderPoint, "reorderPoint");
  if (reorderPoint < 0) badRequest("Reorder point cannot be negative");
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
        barcode,
        createdAt: Date.now(),
        reorderPoint,
      })
      .returning();
    return c.json(row, 201);
  } catch {
    return c.json({ error: "SKU or barcode already exists" }, 409);
  }
});

catalogRoute.patch("/items/:id", async (c) => {
  const body = await c.req.json<{ reorderPoint?: number; name?: string; barcode?: string }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const patch: { reorderPoint?: number; name?: string; barcode?: string } = {};
  if (body.reorderPoint !== undefined) {
    const reorderPoint = requireInt(body.reorderPoint, "reorderPoint");
    if (reorderPoint < 0) badRequest("Reorder point cannot be negative");
    patch.reorderPoint = reorderPoint;
  }
  if (body.name !== undefined) patch.name = requireString(body.name, "name");
  const barcode = optionalString(body.barcode);
  if (barcode) patch.barcode = barcode.toUpperCase();
  if (Object.keys(patch).length === 0) badRequest("Nothing to update");
  try {
    const [row] = await db
      .update(schema.items)
      .set(patch)
      .where(and(eq(schema.items.id, c.req.param("id")), eq(schema.items.organizationId, organizationId)))
      .returning();
    if (!row) return c.json({ error: "Item not found" }, 404);
    return c.json(row);
  } catch {
    return c.json({ error: "Barcode already exists" }, 409);
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
      warehouseId: schema.locations.warehouseId,
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
  const refId = c.req.query("refId");
  const fromLoc = alias(schema.locations, "from_loc");
  const toLoc = alias(schema.locations, "to_loc");
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
      fromLocationCode: fromLoc.code,
      toLocationCode: toLoc.code,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryMovements.itemId))
    .leftJoin(fromLoc, eq(fromLoc.id, schema.inventoryMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, schema.inventoryMovements.toLocationId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        refId ? eq(schema.inventoryMovements.refId, refId) : undefined,
      ),
    )
    .orderBy(desc(schema.inventoryMovements.createdAt))
    .limit(100);
  return c.json(rows);
});

catalogRoute.get("/dashboard", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId") || undefined;

  const [onHand] = await db
    .select({
      units: sql<number>`coalesce(sum(${schema.inventoryBalances.qty}), 0)`,
      bins: sql<number>`count(*)`,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );

  const [skuCount] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));

  const receiptWhere = and(
    eq(schema.receipts.organizationId, organizationId),
    inArray(schema.receipts.status, ["draft", "receiving"]),
    warehouseId ? eq(schema.receipts.warehouseId, warehouseId) : undefined,
  );
  const orderWhere = and(
    eq(schema.orders.organizationId, organizationId),
    sql`${schema.orders.status} not in ('shipped', 'cancelled')`,
    warehouseId ? eq(schema.orders.warehouseId, warehouseId) : undefined,
  );
  const woWhere = and(
    eq(schema.workOrders.organizationId, organizationId),
    inArray(schema.workOrders.status, ["draft", "in_progress"]),
    warehouseId ? eq(schema.workOrders.warehouseId, warehouseId) : undefined,
  );
  const transferWhere = and(
    eq(schema.transfers.organizationId, organizationId),
    inArray(schema.transfers.status, ["draft", "in_progress"]),
    warehouseId ? eq(schema.transfers.warehouseId, warehouseId) : undefined,
  );
  const countWhere = and(
    eq(schema.cycleCounts.organizationId, organizationId),
    inArray(schema.cycleCounts.status, ["draft", "counting"]),
    warehouseId ? eq(schema.cycleCounts.warehouseId, warehouseId) : undefined,
  );

  const openReceiptRows = await db.select().from(schema.receipts).where(receiptWhere).orderBy(desc(schema.receipts.createdAt));
  const openOrderRows = await db.select().from(schema.orders).where(orderWhere).orderBy(desc(schema.orders.createdAt));
  const openWorkOrderRows = await db
    .select({
      id: schema.workOrders.id,
      number: schema.workOrders.number,
      itemId: schema.workOrders.itemId,
      qty: schema.workOrders.qty,
      status: schema.workOrders.status,
      sku: schema.items.sku,
      itemName: schema.items.name,
      sourceLocationId: schema.workOrders.sourceLocationId,
      outputLocationId: schema.workOrders.outputLocationId,
      createdAt: schema.workOrders.createdAt,
    })
    .from(schema.workOrders)
    .innerJoin(schema.items, eq(schema.items.id, schema.workOrders.itemId))
    .where(woWhere)
    .orderBy(desc(schema.workOrders.createdAt));

  const fromLoc = alias(schema.locations, "from_loc");
  const toLoc = alias(schema.locations, "to_loc");
  const openTransferRows = await db
    .select({
      id: schema.transfers.id,
      number: schema.transfers.number,
      status: schema.transfers.status,
      fromLocationId: schema.transfers.fromLocationId,
      toLocationId: schema.transfers.toLocationId,
      fromCode: fromLoc.code,
      toCode: toLoc.code,
      notes: schema.transfers.notes,
      createdAt: schema.transfers.createdAt,
    })
    .from(schema.transfers)
    .innerJoin(fromLoc, eq(fromLoc.id, schema.transfers.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, schema.transfers.toLocationId))
    .where(transferWhere)
    .orderBy(desc(schema.transfers.createdAt));

  const openCountRows = await db
    .select({
      id: schema.cycleCounts.id,
      number: schema.cycleCounts.number,
      status: schema.cycleCounts.status,
      locationId: schema.cycleCounts.locationId,
      locationCode: schema.locations.code,
      notes: schema.cycleCounts.notes,
      createdAt: schema.cycleCounts.createdAt,
    })
    .from(schema.cycleCounts)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.cycleCounts.locationId))
    .where(countWhere)
    .orderBy(desc(schema.cycleCounts.createdAt));

  const shopifyExceptions = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        eq(schema.orders.source, "shopify"),
        or(eq(schema.orders.shopifySyncStatus, "failed"), eq(schema.orders.shopifySyncStatus, "pending_fulfill")),
        warehouseId ? eq(schema.orders.warehouseId, warehouseId) : undefined,
      ),
    )
    .orderBy(desc(schema.orders.createdAt));

  const [shopifyOpen] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        eq(schema.orders.source, "shopify"),
        sql`${schema.orders.status} not in ('shipped', 'cancelled')`,
        warehouseId ? eq(schema.orders.warehouseId, warehouseId) : undefined,
      ),
    );

  const onHandByItem = await db
    .select({
      itemId: schema.inventoryBalances.itemId,
      qty: sql<number>`coalesce(sum(${schema.inventoryBalances.qty}), 0)`,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    )
    .groupBy(schema.inventoryBalances.itemId);

  const catalog = await db
    .select({
      id: schema.items.id,
      sku: schema.items.sku,
      name: schema.items.name,
      reorderPoint: schema.items.reorderPoint,
    })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));

  const qtyByItem = new Map(onHandByItem.map((row) => [row.itemId, Number(row.qty)]));
  const lowStock = catalog
    .filter((item) => item.reorderPoint > 0 && (qtyByItem.get(item.id) ?? 0) <= item.reorderPoint)
    .map((item) => ({
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      onHand: qtyByItem.get(item.id) ?? 0,
      reorderPoint: item.reorderPoint,
    }));

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

  const hotBays = await db
    .select({
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      units: sql<number>`coalesce(sum(${schema.inventoryBalances.qty}), 0)`,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
        gt(schema.inventoryBalances.qty, 0),
      ),
    )
    .groupBy(schema.locations.id, schema.locations.code, schema.locations.name)
    .orderBy(desc(sql`coalesce(sum(${schema.inventoryBalances.qty}), 0)`))
    .limit(6);

  return c.json({
    onHandUnits: Number(onHand?.units ?? 0),
    binRows: Number(onHand?.bins ?? 0),
    skuCount: Number(skuCount?.n ?? 0),
    openReceipts: openReceiptRows.length,
    openOrders: openOrderRows.length,
    openWorkOrders: openWorkOrderRows.length,
    shopifyOpenOrders: Number(shopifyOpen?.n ?? 0),
    openTransfers: openTransferRows.length,
    openCycleCounts: openCountRows.length,
    lowStock,
    recent,
    hotBays: hotBays.map((row) => ({ ...row, units: Number(row.units) })),
    queues: {
      receipts: openReceiptRows,
      orders: openOrderRows,
      workOrders: openWorkOrderRows,
      putaways: openTransferRows,
      counts: openCountRows,
      shopifyExceptions,
    },
  });
});
