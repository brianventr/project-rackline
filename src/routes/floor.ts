import { Hono } from "hono";
import { and, eq, gt } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, notFound, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation, getOrgLocationByScan } from "../lib/org";
import { newId } from "../lib/ids";
import { parseScan } from "../domain/barcodes";
import { chainPlans, planMove } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";

export const floorRoute = new Hono<AppEnv>();

floorRoute.get("/map", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId");

  const warehouses = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId));
  const warehouse = warehouseId
    ? warehouses.find((row) => row.id === warehouseId)
    : warehouses[0];
  if (!warehouse) notFound("Warehouse not found");

  const locationRows = await db
    .select()
    .from(schema.locations)
    .where(
      and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.warehouseId, warehouse.id)),
    )
    .orderBy(schema.locations.code);

  const balances = await db
    .select({
      locationId: schema.inventoryBalances.locationId,
      qty: schema.inventoryBalances.qty,
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      itemType: schema.items.type,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .where(and(eq(schema.inventoryBalances.organizationId, organizationId), gt(schema.inventoryBalances.qty, 0)));

  const byLocation = new Map<string, typeof balances>();
  for (const row of balances) {
    const list = byLocation.get(row.locationId) ?? [];
    list.push(row);
    byLocation.set(row.locationId, list);
  }

  return c.json({
    warehouse: {
      id: warehouse.id,
      name: warehouse.name,
      mapWidth: warehouse.mapWidth,
      mapDepth: warehouse.mapDepth,
      mapHeight: warehouse.mapHeight,
    },
    warehouses: warehouses.map((row) => ({
      id: row.id,
      name: row.name,
      mapWidth: row.mapWidth,
      mapDepth: row.mapDepth,
      mapHeight: row.mapHeight,
    })),
    locations: locationRows.map((location) => {
      const contents = byLocation.get(location.id) ?? [];
      return {
        ...location,
        unitsOnHand: contents.reduce((sum, row) => sum + row.qty, 0),
        skuCount: contents.length,
        contents: contents.map((row) => ({
          itemId: row.itemId,
          sku: row.sku,
          itemName: row.itemName,
          itemType: row.itemType,
          qty: row.qty,
        })),
      };
    }),
  });
});

floorRoute.get("/scan", async (c) => {
  const raw = requireString(c.req.query("code"), "code");
  const parsed = parseScan(raw);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;

  if (parsed.kind !== "item") {
    const location = await getOrgLocationByScan(db, organizationId, parsed.value);
    if (location) {
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
            gt(schema.inventoryBalances.qty, 0),
          ),
        );
      return c.json({ kind: "location" as const, location, contents });
    }
    if (parsed.kind === "location") notFound("No location matches that barcode");
  }

  const [item] = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), eq(schema.items.sku, parsed.value)))
    .limit(1);
  if (!item) notFound("No location or item matches that barcode");

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
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        eq(schema.inventoryBalances.itemId, item.id),
        gt(schema.inventoryBalances.qty, 0),
      ),
    );

  return c.json({ kind: "item" as const, item, onHand });
});

floorRoute.post("/moves", async (c) => {
  const body = await c.req.json<{
    fromLocationId?: string;
    toLocationId?: string;
    fromBarcode?: string;
    toBarcode?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;

  const from =
    (body.fromLocationId ? await getOrgLocation(db, organizationId, requireString(body.fromLocationId, "fromLocationId")) : null) ??
    (body.fromBarcode
      ? await getOrgLocationByScan(db, organizationId, parseScan(requireString(body.fromBarcode, "fromBarcode")).value)
      : null);
  const to =
    (body.toLocationId ? await getOrgLocation(db, organizationId, requireString(body.toLocationId, "toLocationId")) : null) ??
    (body.toBarcode
      ? await getOrgLocationByScan(db, organizationId, parseScan(requireString(body.toBarcode, "toBarcode")).value)
      : null);

  if (!from) badRequest("Scan or choose a from location");
  if (!to) badRequest("Scan or choose a to location");
  if (from.id === to.id) badRequest("From and to locations must differ");
  if (from.warehouseId !== to.warehouseId) badRequest("Locations must be in the same warehouse");

  const onHand = await db
    .select({
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        eq(schema.inventoryBalances.locationId, from.id),
        gt(schema.inventoryBalances.qty, 0),
      ),
    );

  if (onHand.length === 0) badRequest(`${from.code} is empty`);

  const requested = body.lines?.length
    ? body.lines.map((line) => {
        const itemId = requireString(line.itemId, "itemId");
        const qty = typeof line.qty === "number" ? line.qty : Number(line.qty);
        if (!Number.isInteger(qty) || qty <= 0) badRequest("Move quantity must be a positive integer");
        const row = onHand.find((entry) => entry.itemId === itemId);
        if (!row) badRequest("Item is not in the from location");
        if (qty > row.qty) badRequest(`Only ${row.qty} of ${row.sku} in ${from.code}`);
        return { itemId, sku: row.sku, itemName: row.itemName, qty };
      })
    : onHand.map((row) => ({ itemId: row.itemId, sku: row.sku, itemName: row.itemName, qty: row.qty }));

  for (const line of requested) {
    await getOrgItem(db, organizationId, line.itemId);
  }

  const pairs = requested.flatMap((line) => [
    { locationId: from.id, itemId: line.itemId },
    { locationId: to.id, itemId: line.itemId },
  ]);
  const loaded = await loadBalanceMap(db, organizationId, pairs);
  const refId = newId();
  const plan = chainPlans(
    qtyMap(loaded),
    requested.map(
      (line) => (balances) =>
        planMove({
          itemId: line.itemId,
          sku: line.sku,
          qty: line.qty,
          fromLocationId: from.id,
          toLocationId: to.id,
          refId,
          balances,
        }),
    ),
  );

  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now: Date.now(),
    loaded,
    plan,
  });

  return c.json({
    ok: true,
    refId,
    from: { id: from.id, code: from.code, name: from.name, barcode: from.barcode },
    to: { id: to.id, code: to.code, name: to.name, barcode: to.barcode },
    moved: requested,
  });
});
