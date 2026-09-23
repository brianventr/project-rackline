import { Hono } from "hono";
import { and, desc, eq, gt, inArray, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner, isItemType, isLocationType, isSlotRole, getOrgLocation, getOrgItem } from "../lib/org";
import { badRequest, requireInt, requireString, optionalInt, optionalString, optionalFloat } from "../lib/http";
import { newId } from "../lib/ids";
import { suggestPlacement } from "../domain/map-layout";
import { parseTimeZone } from "../domain/time-zone";
import { suggestReplenishments } from "../domain/replenishment";
import { suggestPutawayJobs, suggestPutawayBay } from "../domain/directed-putaway";
import { loadPutawayBaysByItem } from "../db/putaway-bays";
import { loadUnputawayReceivedCartons } from "../db/asn-packages";
import { countVariance } from "../domain/blind-count";
import { applyHoldsToOnHand, matchingHoldForMove } from "../domain/holds";
import { loadHeldLotQuantities, loadOpenHolds } from "../db/holds";
import { annotateAtp, atpOnHand, loadOpenAllocations } from "../db/allocations";
import { addUtcDays, EXPIRING_WITHIN_DAYS, utcYyyymmdd } from "../domain/expiry";
import { CERT_EXPIRING_WITHIN_DAYS, isCertExpiring } from "../domain/equipment";
import { loadAsBuiltForItem } from "../db/as-built";
import { loadDocumentNumber } from "../db/equipment";
import { originColumns, resolveOrigin } from "../domain/geo";
import { loadReorderQueue } from "../db/reorder";
import { loadRunwayThisWeek } from "../db/runway";
import { dailyTrend } from "../domain/trends";
import { mediaItemKey, normalizeImageUrl } from "../domain/media";
import { deleteManagedMedia, putMediaFile, readUploadedFile } from "../lib/media-store";

export const catalogRoute = new Hono<AppEnv>();

function parseBaselineShipRate(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const rate = optionalFloat(value, "baselineShipRate");
  if (rate == null || rate < 0) badRequest("Baseline ship rate cannot be negative");
  return rate === 0 ? null : rate;
}

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
    shipFromAddress?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    timeZone?: string | null;
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

  const patch: {
    name?: string;
    mapWidth?: number;
    mapDepth?: number;
    mapHeight?: number;
    shipFromAddress?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    lat?: number | null;
    lng?: number | null;
    timeZone?: string;
  } = {};
  const name = optionalString(body.name);
  if (name) patch.name = name;
  if ("shipFromAddress" in body) {
    patch.shipFromAddress =
      typeof body.shipFromAddress === "string" ? body.shipFromAddress.trim() || null : null;
  }
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
  if ("city" in body) patch.city = optionalString(body.city) ?? null;
  if ("region" in body) patch.region = optionalString(body.region) ?? null;
  if ("country" in body) patch.country = optionalString(body.country) ?? null;
  if ("timeZone" in body) {
    try {
      patch.timeZone = parseTimeZone(body.timeZone);
    } catch (err) {
      badRequest(err instanceof Error ? err.message : "Invalid timezone");
    }
  }
  if ("city" in body || "region" in body || "country" in body) {
    const next = {
      city: patch.city !== undefined ? patch.city : warehouse.city,
      region: patch.region !== undefined ? patch.region : warehouse.region,
      country: patch.country !== undefined ? patch.country : warehouse.country,
    };
    Object.assign(patch, originColumns(resolveOrigin(next)));
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
      slotRole: schema.locations.slotRole,
      zoneId: schema.locations.zoneId,
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
    slotRole?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const code = requireString(body.code, "code").toUpperCase();
  const name = requireString(body.name, "name");
  const type = requireString(body.type, "type");
  if (!isLocationType(type)) badRequest("Invalid location type");
  const slotRole = optionalString(body.slotRole) ?? "none";
  if (!isSlotRole(slotRole)) badRequest("Invalid slot role");
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
        slotRole,
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
    slotRole?: string;
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
  const slotRole = optionalString(body.slotRole);
  if (slotRole) {
    if (!isSlotRole(slotRole)) badRequest("Invalid slot role");
    patch.slotRole = slotRole;
  }

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
  const lots = await db
    .select({
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      lotCode: schema.lotBalances.lotCode,
      qty: schema.lotBalances.qty,
      expiresOn: schema.lotBalances.expiresOn,
    })
    .from(schema.lotBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.lotBalances.locationId))
    .where(
      and(eq(schema.lotBalances.organizationId, organizationId), eq(schema.lotBalances.itemId, item.id)),
    );
  const serialRows = await db
    .select({
      serialCode: schema.serials.serialCode,
      status: schema.serials.status,
      locationId: schema.serials.locationId,
      locationCode: schema.locations.code,
    })
    .from(schema.serials)
    .leftJoin(schema.locations, eq(schema.locations.id, schema.serials.locationId))
    .where(and(eq(schema.serials.organizationId, organizationId), eq(schema.serials.itemId, item.id)));
  const genealogy = await loadAsBuiltForItem(db, organizationId, item.id);
  const located = onHand.map((row) => ({ ...row, itemId: item.id }));
  const openHolds = await loadOpenHolds(db, organizationId);
  const heldLotQtys = await loadHeldLotQuantities(db, organizationId, openHolds);
  const available = applyHoldsToOnHand(located, openHolds, heldLotQtys);
  const allocations = await loadOpenAllocations(db, organizationId);
  return c.json({
    ...item,
    onHand: annotateAtp(located, allocations, available),
    lots: lots.map((row) => ({
      ...row,
      usedIn: genealogy.filter(
        (link) => link.componentItemId === item.id && link.componentLotCode === row.lotCode,
      ),
    })),
    serials: serialRows.map((row) => ({
      ...row,
      builtFrom: genealogy.filter((link) => link.parentSerial === row.serialCode),
      usedIn: genealogy.filter((link) => link.componentSerial === row.serialCode),
    })),
  });
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
      imageUrl: schema.items.imageUrl,
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
    baselineShipRate?: number | null;
    barcode?: string;
    pickMin?: number;
    trackLot?: boolean;
    trackSerial?: boolean;
    catchWeight?: boolean;
    trackExpiry?: boolean;
    imageUrl?: string | null;
  }>();
  const sku = requireString(body.sku, "sku").toUpperCase();
  const name = requireString(body.name, "name");
  const type = requireString(body.type, "type");
  if (!isItemType(type)) badRequest("Invalid item type");
  const barcode = (optionalString(body.barcode) ?? sku).toUpperCase();
  const reorderPoint = body.reorderPoint === undefined ? 0 : requireInt(body.reorderPoint, "reorderPoint");
  if (reorderPoint < 0) badRequest("Reorder point cannot be negative");
  const pickMin = body.pickMin === undefined ? 0 : requireInt(body.pickMin, "pickMin");
  if (pickMin < 0) badRequest("Pick min cannot be negative");
  const baselineShipRate = parseBaselineShipRate(body.baselineShipRate);
  let imageUrl: string | null = null;
  if ("imageUrl" in body) imageUrl = normalizeImageUrl(body.imageUrl);
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
        baselineShipRate: baselineShipRate ?? null,
        pickMin,
        trackLot: Boolean(body.trackLot) || Boolean(body.trackExpiry),
        trackSerial: Boolean(body.trackSerial),
        catchWeight: Boolean(body.catchWeight),
        trackExpiry: Boolean(body.trackExpiry),
        imageUrl,
      })
      .returning();
    return c.json(row, 201);
  } catch {
    return c.json({ error: "SKU or barcode already exists" }, 409);
  }
});

catalogRoute.patch("/items/:id", async (c) => {
  const body = await c.req.json<{
    reorderPoint?: number;
    name?: string;
    barcode?: string;
    pickMin?: number;
    trackLot?: boolean;
    trackSerial?: boolean;
    catchWeight?: boolean;
    trackExpiry?: boolean;
    stockUom?: string;
    altUom?: string | null;
    altPerStock?: number | null;
    baselineShipRate?: number | null;
    imageUrl?: string | null;
  }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const existing = await getOrgItem(db, organizationId, c.req.param("id"));
  const patch: {
    reorderPoint?: number;
    name?: string;
    barcode?: string;
    pickMin?: number;
    trackLot?: boolean;
    trackSerial?: boolean;
    catchWeight?: boolean;
    trackExpiry?: boolean;
    stockUom?: string;
    altUom?: string | null;
    altPerStock?: number | null;
    baselineShipRate?: number | null;
    imageUrl?: string | null;
  } = {};
  if (body.reorderPoint !== undefined) {
    const reorderPoint = requireInt(body.reorderPoint, "reorderPoint");
    if (reorderPoint < 0) badRequest("Reorder point cannot be negative");
    patch.reorderPoint = reorderPoint;
  }
  if (body.pickMin !== undefined) {
    const pickMin = requireInt(body.pickMin, "pickMin");
    if (pickMin < 0) badRequest("Pick min cannot be negative");
    patch.pickMin = pickMin;
  }
  if (body.baselineShipRate !== undefined) {
    patch.baselineShipRate = parseBaselineShipRate(body.baselineShipRate) ?? null;
  }
  if (body.name !== undefined) patch.name = requireString(body.name, "name");
  const barcode = optionalString(body.barcode);
  if (barcode) patch.barcode = barcode.toUpperCase();
  if (body.trackLot !== undefined) patch.trackLot = Boolean(body.trackLot);
  if (body.trackSerial !== undefined) patch.trackSerial = Boolean(body.trackSerial);
  if (body.catchWeight !== undefined) patch.catchWeight = Boolean(body.catchWeight);
  if (body.trackExpiry !== undefined) {
    patch.trackExpiry = Boolean(body.trackExpiry);
    if (patch.trackExpiry) patch.trackLot = true;
  }
  if (body.stockUom !== undefined) patch.stockUom = requireString(body.stockUom, "stockUom");
  if (body.altUom !== undefined) patch.altUom = body.altUom?.trim() || null;
  if (body.altPerStock !== undefined) {
    if (body.altPerStock === null) patch.altPerStock = null;
    else {
      const altPerStock = requireInt(body.altPerStock, "altPerStock");
      if (altPerStock <= 0) badRequest("altPerStock must be positive");
      patch.altPerStock = altPerStock;
    }
  }
  if ("imageUrl" in body) patch.imageUrl = normalizeImageUrl(body.imageUrl);
  if (Object.keys(patch).length === 0) badRequest("Nothing to update");
  if (patch.imageUrl !== undefined && existing.imageUrl && existing.imageUrl !== patch.imageUrl) {
    await deleteManagedMedia(c.env.MEDIA, existing.imageUrl);
  }
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

catalogRoute.post("/items/:id/image", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const item = await getOrgItem(db, organizationId, c.req.param("id"));
  const file = await readUploadedFile(c.req.raw);
  const key = mediaItemKey(organizationId, item.id);
  const imageUrl = await putMediaFile(c.env.MEDIA, key, file);
  if (item.imageUrl && item.imageUrl !== imageUrl) {
    await deleteManagedMedia(c.env.MEDIA, item.imageUrl);
  }
  const [row] = await db
    .update(schema.items)
    .set({ imageUrl })
    .where(and(eq(schema.items.id, item.id), eq(schema.items.organizationId, organizationId)))
    .returning();
  return c.json(row);
});

catalogRoute.delete("/items/:id/image", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const item = await getOrgItem(db, organizationId, c.req.param("id"));
  await deleteManagedMedia(c.env.MEDIA, item.imageUrl);
  const [row] = await db
    .update(schema.items)
    .set({ imageUrl: null })
    .where(and(eq(schema.items.id, item.id), eq(schema.items.organizationId, organizationId)))
    .returning();
  return c.json(row);
});

catalogRoute.delete("/items/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const item = await getOrgItem(db, organizationId, c.req.param("id")).catch(() => null);
  if (item) await deleteManagedMedia(c.env.MEDIA, item.imageUrl);
  await db
    .delete(schema.items)
    .where(and(eq(schema.items.id, c.req.param("id")), eq(schema.items.organizationId, organizationId)));
  return c.json({ ok: true });
});

catalogRoute.get("/inventory", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const clientId = c.req.query("clientId");
  if (clientId) {
    const stock = await db
      .select({
        qty: schema.clientBalances.qty,
        updatedAt: schema.clientBalances.updatedAt,
        itemId: schema.items.id,
        sku: schema.items.sku,
        itemName: schema.items.name,
        imageUrl: schema.items.imageUrl,
        locationId: schema.locations.id,
        locationCode: schema.locations.code,
        locationName: schema.locations.name,
        warehouseId: schema.locations.warehouseId,
      })
      .from(schema.clientBalances)
      .innerJoin(schema.items, eq(schema.items.id, schema.clientBalances.itemId))
      .innerJoin(schema.locations, eq(schema.locations.id, schema.clientBalances.locationId))
      .where(
        and(eq(schema.clientBalances.organizationId, organizationId), eq(schema.clientBalances.clientId, clientId)),
      )
      .orderBy(schema.items.sku, schema.locations.code);
    return c.json(stock);
  }
  const rows = await db
    .select({
      id: schema.inventoryBalances.id,
      qty: schema.inventoryBalances.qty,
      updatedAt: schema.inventoryBalances.updatedAt,
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      itemType: schema.items.type,
      imageUrl: schema.items.imageUrl,
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
  const openHolds = await loadOpenHolds(db, organizationId);
  const heldLotQtys = await loadHeldLotQuantities(db, organizationId, openHolds);
  const available = applyHoldsToOnHand(rows, openHolds, heldLotQtys);
  const allocations = await loadOpenAllocations(db, organizationId);
  return c.json(annotateAtp(rows, allocations, available));
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
      createdBy: schema.inventoryMovements.createdBy,
      createdByName: schema.user.name,
      sku: schema.items.sku,
      itemName: schema.items.name,
      fromLocationId: schema.inventoryMovements.fromLocationId,
      toLocationId: schema.inventoryMovements.toLocationId,
      fromLocationCode: fromLoc.code,
      toLocationCode: toLoc.code,
      lotCode: schema.inventoryMovements.lotCode,
      serialsJson: schema.inventoryMovements.serialsJson,
      weightGrams: schema.inventoryMovements.weightGrams,
      expiresOn: schema.inventoryMovements.expiresOn,
      equipmentId: schema.inventoryMovements.equipmentId,
      assignmentId: schema.inventoryMovements.assignmentId,
      equipmentCode: schema.equipment.code,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryMovements.itemId))
    .leftJoin(schema.user, eq(schema.user.id, schema.inventoryMovements.createdBy))
    .leftJoin(fromLoc, eq(fromLoc.id, schema.inventoryMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, schema.inventoryMovements.toLocationId))
    .leftJoin(schema.equipment, eq(schema.equipment.id, schema.inventoryMovements.equipmentId))
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
  const purchaseWhere = and(
    eq(schema.purchases.organizationId, organizationId),
    inArray(schema.purchases.status, ["draft", "ordered", "receiving"]),
    warehouseId ? eq(schema.purchases.warehouseId, warehouseId) : undefined,
  );
  const returnWhere = and(
    eq(schema.rmas.organizationId, organizationId),
    inArray(schema.rmas.status, ["open", "receiving"]),
    warehouseId ? eq(schema.rmas.warehouseId, warehouseId) : undefined,
  );
  const replenishWhere = and(
    eq(schema.replenishments.organizationId, organizationId),
    inArray(schema.replenishments.status, ["draft", "in_progress"]),
    warehouseId ? eq(schema.replenishments.warehouseId, warehouseId) : undefined,
  );
  const kitWhere = and(
    eq(schema.kitBuilds.organizationId, organizationId),
    inArray(schema.kitBuilds.status, ["draft", "in_progress"]),
    warehouseId ? eq(schema.kitBuilds.warehouseId, warehouseId) : undefined,
  );
  const vendorReturnWhere = and(
    eq(schema.vendorReturns.organizationId, organizationId),
    inArray(schema.vendorReturns.status, ["open", "returning"]),
    warehouseId ? eq(schema.vendorReturns.warehouseId, warehouseId) : undefined,
  );
  const waveWhere = and(
    eq(schema.waves.organizationId, organizationId),
    inArray(schema.waves.status, ["draft", "released", "picking"]),
    warehouseId ? eq(schema.waves.warehouseId, warehouseId) : undefined,
  );
  const asnWhere = and(
    eq(schema.asns.organizationId, organizationId),
    inArray(schema.asns.status, ["draft", "expected", "receiving"]),
    warehouseId ? eq(schema.asns.warehouseId, warehouseId) : undefined,
  );
  const yardWhere = and(
    eq(schema.yardVisits.organizationId, organizationId),
    inArray(schema.yardVisits.status, ["expected", "checked_in", "at_dock"]),
    warehouseId ? eq(schema.yardVisits.warehouseId, warehouseId) : undefined,
  );

  const openReceiptRows = await db.select().from(schema.receipts).where(receiptWhere).orderBy(desc(schema.receipts.createdAt));
  const openOrderRows = await db.select().from(schema.orders).where(orderWhere).orderBy(desc(schema.orders.createdAt));
  const openWorkOrderRows = await db
    .select({
      id: schema.workOrders.id,
      number: schema.workOrders.number,
      itemId: schema.workOrders.itemId,
      qty: schema.workOrders.qty,
      qtyCompleted: schema.workOrders.qtyCompleted,
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
      fromBarcode: fromLoc.barcode,
      toBarcode: toLoc.barcode,
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

  const countVarianceRows = await db
    .select({
      id: schema.cycleCountLines.id,
      countId: schema.cycleCounts.id,
      number: schema.cycleCounts.number,
      status: schema.cycleCounts.status,
      locationId: schema.cycleCounts.locationId,
      locationCode: schema.locations.code,
      sku: schema.items.sku,
      itemName: schema.items.name,
      systemQty: schema.cycleCountLines.systemQty,
      countedQty: schema.cycleCountLines.countedQty,
      postedAt: schema.cycleCounts.postedAt,
      warehouseId: schema.cycleCounts.warehouseId,
    })
    .from(schema.cycleCountLines)
    .innerJoin(schema.cycleCounts, eq(schema.cycleCounts.id, schema.cycleCountLines.cycleCountId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.cycleCounts.locationId))
    .innerJoin(schema.items, eq(schema.items.id, schema.cycleCountLines.itemId))
    .where(
      and(
        eq(schema.cycleCounts.organizationId, organizationId),
        eq(schema.cycleCounts.status, "posted"),
        ne(schema.cycleCountLines.countedQty, schema.cycleCountLines.systemQty),
        warehouseId ? eq(schema.cycleCounts.warehouseId, warehouseId) : undefined,
      ),
    )
    .orderBy(desc(schema.cycleCounts.postedAt));
  const countVariances = countVarianceRows.map((row) => ({
    ...row,
    variance: countVariance(row.countedQty, row.systemQty),
  }));

  const openPurchaseRows = await db.select().from(schema.purchases).where(purchaseWhere).orderBy(desc(schema.purchases.createdAt));
  const openReturnRows = await db.select().from(schema.rmas).where(returnWhere).orderBy(desc(schema.rmas.createdAt));
  const openVendorReturnRows = await db
    .select({
      id: schema.vendorReturns.id,
      number: schema.vendorReturns.number,
      vendorName: schema.vendorReturns.vendorName,
      status: schema.vendorReturns.status,
      purchaseId: schema.vendorReturns.purchaseId,
      warehouseId: schema.vendorReturns.warehouseId,
      createdAt: schema.vendorReturns.createdAt,
    })
    .from(schema.vendorReturns)
    .where(vendorReturnWhere)
    .orderBy(desc(schema.vendorReturns.createdAt));

  const rplFrom = alias(schema.locations, "rpl_from");
  const rplTo = alias(schema.locations, "rpl_to");
  const openReplenishRows = await db
    .select({
      id: schema.replenishments.id,
      number: schema.replenishments.number,
      status: schema.replenishments.status,
      itemId: schema.replenishments.itemId,
      qty: schema.replenishments.qty,
      qtyMoved: schema.replenishments.qtyMoved,
      fromLocationId: schema.replenishments.fromLocationId,
      toLocationId: schema.replenishments.toLocationId,
      fromCode: rplFrom.code,
      toCode: rplTo.code,
      sku: schema.items.sku,
      itemName: schema.items.name,
      createdAt: schema.replenishments.createdAt,
      warehouseId: schema.replenishments.warehouseId,
    })
    .from(schema.replenishments)
    .innerJoin(schema.items, eq(schema.items.id, schema.replenishments.itemId))
    .innerJoin(rplFrom, eq(rplFrom.id, schema.replenishments.fromLocationId))
    .innerJoin(rplTo, eq(rplTo.id, schema.replenishments.toLocationId))
    .where(replenishWhere)
    .orderBy(desc(schema.replenishments.createdAt));

  const openKitRows = await db
    .select({
      id: schema.kitBuilds.id,
      number: schema.kitBuilds.number,
      itemId: schema.kitBuilds.itemId,
      qty: schema.kitBuilds.qty,
      qtyCompleted: schema.kitBuilds.qtyCompleted,
      status: schema.kitBuilds.status,
      sku: schema.items.sku,
      itemName: schema.items.name,
      sourceLocationId: schema.kitBuilds.sourceLocationId,
      outputLocationId: schema.kitBuilds.outputLocationId,
      createdAt: schema.kitBuilds.createdAt,
      warehouseId: schema.kitBuilds.warehouseId,
    })
    .from(schema.kitBuilds)
    .innerJoin(schema.items, eq(schema.items.id, schema.kitBuilds.itemId))
    .where(kitWhere)
    .orderBy(desc(schema.kitBuilds.createdAt));

  const holdWhere = and(
    eq(schema.inventoryHolds.organizationId, organizationId),
    eq(schema.inventoryHolds.status, "open"),
    warehouseId ? eq(schema.inventoryHolds.warehouseId, warehouseId) : undefined,
  );
  const openHoldRows = await db
    .select({
      id: schema.inventoryHolds.id,
      warehouseId: schema.inventoryHolds.warehouseId,
      number: schema.inventoryHolds.number,
      status: schema.inventoryHolds.status,
      locationId: schema.inventoryHolds.locationId,
      itemId: schema.inventoryHolds.itemId,
      lotCode: schema.inventoryHolds.lotCode,
      reason: schema.inventoryHolds.reason,
      notes: schema.inventoryHolds.notes,
      createdAt: schema.inventoryHolds.createdAt,
      releasedAt: schema.inventoryHolds.releasedAt,
      locationCode: schema.locations.code,
      locationBarcode: schema.locations.barcode,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.inventoryHolds)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryHolds.locationId))
    .leftJoin(schema.items, eq(schema.items.id, schema.inventoryHolds.itemId))
    .where(holdWhere)
    .orderBy(desc(schema.inventoryHolds.createdAt));

  const openWaveRows = await db.select().from(schema.waves).where(waveWhere).orderBy(desc(schema.waves.createdAt));
  const openAsnRows = await db.select().from(schema.asns).where(asnWhere).orderBy(desc(schema.asns.createdAt));
  const openYardRows = await db
    .select()
    .from(schema.yardVisits)
    .where(yardWhere)
    .orderBy(desc(schema.yardVisits.createdAt));

  const checkoutWhere = and(
    eq(schema.equipmentAssignments.organizationId, organizationId),
    eq(schema.equipmentAssignments.status, "open"),
    warehouseId ? eq(schema.equipmentAssignments.warehouseId, warehouseId) : undefined,
  );
  const openCheckoutRaw = await db
    .select({
      id: schema.equipmentAssignments.id,
      number: schema.equipmentAssignments.number,
      equipmentId: schema.equipmentAssignments.equipmentId,
      equipmentCode: schema.equipment.code,
      equipmentName: schema.equipment.name,
      operatorUserId: schema.equipmentAssignments.operatorUserId,
      operatorName: schema.user.name,
      status: schema.equipmentAssignments.status,
      shift: schema.equipmentAssignments.shift,
      refType: schema.equipmentAssignments.refType,
      refId: schema.equipmentAssignments.refId,
      startedAt: schema.equipmentAssignments.startedAt,
      warehouseId: schema.equipmentAssignments.warehouseId,
    })
    .from(schema.equipmentAssignments)
    .innerJoin(schema.equipment, eq(schema.equipment.id, schema.equipmentAssignments.equipmentId))
    .innerJoin(schema.user, eq(schema.user.id, schema.equipmentAssignments.operatorUserId))
    .where(checkoutWhere)
    .orderBy(desc(schema.equipmentAssignments.startedAt));
  const openCheckoutRows = await Promise.all(
    openCheckoutRaw.map(async (row) => ({
      ...row,
      taskNumber: await loadDocumentNumber(db, organizationId, row.refType, row.refId),
    })),
  );

  const outOfServiceRows = await db
    .select()
    .from(schema.equipment)
    .where(
      and(
        eq(schema.equipment.organizationId, organizationId),
        eq(schema.equipment.status, "out_of_service"),
        warehouseId ? eq(schema.equipment.warehouseId, warehouseId) : undefined,
      ),
    );
  const certRows = await db
    .select({
      id: schema.operatorCertifications.id,
      userId: schema.operatorCertifications.userId,
      userName: schema.user.name,
      class: schema.operatorCertifications.class,
      expiresOn: schema.operatorCertifications.expiresOn,
    })
    .from(schema.operatorCertifications)
    .innerJoin(schema.user, eq(schema.user.id, schema.operatorCertifications.userId))
    .where(eq(schema.operatorCertifications.organizationId, organizationId));
  const today = utcYyyymmdd();
  const expiringCerts = certRows.filter((row) => isCertExpiring(row.expiresOn, today, CERT_EXPIRING_WITHIN_DAYS));

  const slotLocations = await db
    .select({
      id: schema.locations.id,
      code: schema.locations.code,
      warehouseId: schema.locations.warehouseId,
      slotRole: schema.locations.slotRole,
      aisle: schema.locations.aisle,
      rack: schema.locations.rack,
    })
    .from(schema.locations)
    .where(
      and(
        eq(schema.locations.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );
  const replenishOnHand = await db
    .select({
      locationId: schema.inventoryBalances.locationId,
      itemId: schema.inventoryBalances.itemId,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );
  const replenishItems = await db
    .select({
      id: schema.items.id,
      sku: schema.items.sku,
      name: schema.items.name,
      pickMin: schema.items.pickMin,
    })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));
  const openHolds = await loadOpenHolds(db, organizationId, warehouseId);
  const replenishSuggestions = suggestReplenishments({
    locations: slotLocations,
    onHand: await atpOnHand(db, organizationId, replenishOnHand, { warehouseId }),
    items: replenishItems,
  }).filter(
    (job) =>
      !matchingHoldForMove(openHolds, job.fromLocationId, job.itemId) &&
      !matchingHoldForMove(openHolds, job.toLocationId, job.itemId),
  );

  const stagingRows = await db
    .select({
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      locationName: schema.locations.name,
      barcode: schema.locations.barcode,
      type: schema.locations.type,
      warehouseId: schema.locations.warehouseId,
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
        gt(schema.inventoryBalances.qty, 0),
        inArray(schema.locations.type, ["receiving", "shipping", "production"]),
      ),
    );

  const putawaySuggestions = [];
  const availableStaging = (await atpOnHand(db, organizationId, stagingRows, { warehouseId })).filter((row) => row.qty > 0);
  const stagingByWarehouse = new Map<string, typeof availableStaging>();
  for (const row of availableStaging) {
    const list = stagingByWarehouse.get(row.warehouseId) ?? [];
    list.push(row);
    stagingByWarehouse.set(row.warehouseId, list);
  }
  for (const [whId, rows] of stagingByWarehouse) {
    const itemIds = [...new Set(rows.map((row) => row.itemId))];
    const baysByItem = await loadPutawayBaysByItem(db, organizationId, whId, itemIds);
    const byLocation = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byLocation.get(row.locationId) ?? [];
      list.push(row);
      byLocation.set(row.locationId, list);
    }
    for (const [locationId, contents] of byLocation) {
      const first = contents[0]!;
      const jobs = suggestPutawayJobs(
        { id: locationId, code: first.locationCode, barcode: first.barcode, type: first.type },
        contents,
        baysByItem,
      );
      for (const job of jobs) {
        if (!job.suggested) continue;
        putawaySuggestions.push({
          itemId: job.itemId,
          sku: job.sku,
          itemName: job.itemName,
          qty: job.qty,
          fromLocationId: job.fromLocationId,
          fromCode: job.fromCode,
          fromBarcode: job.fromBarcode,
          toLocationId: job.suggested.locationId,
          toCode: job.suggested.locationCode,
          toBarcode: job.suggested.barcode,
          warehouseId: whId,
        });
      }
    }
  }

  const cartonPutaways = [];
  const unputawayCartons = await loadUnputawayReceivedCartons(db, organizationId, warehouseId ? { warehouseId } : {});
  const cartonFromLocations = new Set(unputawayCartons.map((row) => row.locationId));
  if (unputawayCartons.length > 0) {
    const cartonItemIds = [...new Set(unputawayCartons.flatMap((row) => row.lines.map((line) => line.itemId)))];
    const cartonWarehouseIds = [...new Set(unputawayCartons.map((row) => row.warehouseId))];
    const baysByWarehouse = new Map<string, Awaited<ReturnType<typeof loadPutawayBaysByItem>>>();
    for (const whId of cartonWarehouseIds) {
      baysByWarehouse.set(whId, await loadPutawayBaysByItem(db, organizationId, whId, cartonItemIds));
    }
    for (const pkg of unputawayCartons) {
      const baysByItem = baysByWarehouse.get(pkg.warehouseId) ?? new Map();
      const lines = pkg.lines.map((line) => {
        const suggested = suggestPutawayBay(baysByItem.get(line.itemId) ?? [], pkg.locationId);
        return {
          itemId: line.itemId,
          sku: line.sku,
          itemName: line.itemName,
          qty: line.qty,
          lotCode: line.lotCode,
          toLocationId: suggested?.locationId ?? null,
          toCode: suggested?.locationCode ?? null,
          toBarcode: suggested?.barcode ?? null,
        };
      });
      cartonPutaways.push({
        asnId: pkg.asnId,
        asnNumber: pkg.asnNumber,
        packageId: pkg.id,
        packageNumber: pkg.number,
        sscc: pkg.sscc,
        fromLocationId: pkg.locationId,
        fromCode: pkg.fromCode,
        fromBarcode: pkg.fromBarcode,
        warehouseId: pkg.warehouseId,
        lines,
      });
    }
  }

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

  const trackerPackageExceptions = await db
    .select({
      id: schema.orderPackages.id,
      orderId: schema.orders.id,
      number: schema.orders.number,
      packageNumber: schema.orderPackages.number,
      trackingNumber: schema.orderPackages.trackingNumber,
      trackerStatus: schema.orderPackages.trackerStatus,
      warehouseId: schema.orders.warehouseId,
    })
    .from(schema.orderPackages)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderPackages.orderId))
    .where(
      and(
        eq(schema.orderPackages.organizationId, organizationId),
        eq(schema.orderPackages.trackerStatus, "exception"),
        warehouseId ? eq(schema.orders.warehouseId, warehouseId) : undefined,
      ),
    );
  const trackerOrderExceptions = await db
    .select({
      id: schema.orders.id,
      orderId: schema.orders.id,
      number: schema.orders.number,
      trackingNumber: schema.orders.trackingNumber,
      trackerStatus: schema.orders.trackerStatus,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        eq(schema.orders.trackerStatus, "exception"),
        warehouseId ? eq(schema.orders.warehouseId, warehouseId) : undefined,
      ),
    );
  const packagedExceptionOrders = new Set(trackerPackageExceptions.map((row) => row.orderId));
  const trackerExceptions = [
    ...trackerPackageExceptions.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      number: row.number,
      packageNumber: row.packageNumber,
      trackingNumber: row.trackingNumber,
      trackerStatus: row.trackerStatus ?? "exception",
    })),
    ...trackerOrderExceptions
      .filter((row) => !packagedExceptionOrders.has(row.orderId))
      .map((row) => ({
        id: row.id,
        orderId: row.orderId,
        number: row.number,
        packageNumber: null as string | null,
        trackingNumber: row.trackingNumber,
        trackerStatus: row.trackerStatus ?? "exception",
      })),
  ];

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

  const reorder = await loadReorderQueue(db, organizationId, warehouseId);
  const lowStock = reorder.lowStock;
  const runwayThisWeek = await loadRunwayThisWeek(db, organizationId, warehouseId);

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

  const trendWarehouse = await db
    .select({ timeZone: schema.warehouses.timeZone })
    .from(schema.warehouses)
    .where(
      and(
        eq(schema.warehouses.organizationId, organizationId),
        warehouseId ? eq(schema.warehouses.id, warehouseId) : undefined,
      ),
    )
    .limit(1);
  const trendZone = trendWarehouse[0]?.timeZone || "UTC";
  const trendNow = Date.now();
  const trendFromLoc = alias(schema.locations, "trend_from");
  const trendToLoc = alias(schema.locations, "trend_to");
  const trendRows = await db
    .select({
      type: schema.inventoryMovements.type,
      qty: schema.inventoryMovements.qty,
      createdAt: schema.inventoryMovements.createdAt,
      refId: schema.inventoryMovements.refId,
      refType: schema.inventoryMovements.refType,
      fromWarehouseId: trendFromLoc.warehouseId,
      toWarehouseId: trendToLoc.warehouseId,
    })
    .from(schema.inventoryMovements)
    .leftJoin(trendFromLoc, eq(trendFromLoc.id, schema.inventoryMovements.fromLocationId))
    .leftJoin(trendToLoc, eq(trendToLoc.id, schema.inventoryMovements.toLocationId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        gt(schema.inventoryMovements.createdAt, trendNow - 8 * 24 * 60 * 60 * 1000),
        inArray(schema.inventoryMovements.type, ["receive", "pick", "ship", "wo_produce", "kit_produce"]),
      ),
    )
    .limit(20000);
  const trend = dailyTrend(
    trendRows.filter(
      (row) =>
        row.refType !== "seed" &&
        (!warehouseId || row.fromWarehouseId === warehouseId || row.toWarehouseId === warehouseId || (!row.fromWarehouseId && !row.toWarehouseId)),
    ),
    trendNow,
    trendZone,
  );

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

  const [allocated] = await db
    .select({
      units: sql<number>`coalesce(sum(${schema.inventoryAllocations.qty}), 0)`,
    })
    .from(schema.inventoryAllocations)
    .where(
      and(
        eq(schema.inventoryAllocations.organizationId, organizationId),
        eq(schema.inventoryAllocations.status, "open"),
        warehouseId ? eq(schema.inventoryAllocations.warehouseId, warehouseId) : undefined,
      ),
    );

  const horizon = addUtcDays(utcYyyymmdd(), EXPIRING_WITHIN_DAYS);
  const expiringLots = await db
    .select({
      locationId: schema.locations.id,
      locationCode: schema.locations.code,
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      lotCode: schema.lotBalances.lotCode,
      qty: schema.lotBalances.qty,
      expiresOn: schema.lotBalances.expiresOn,
    })
    .from(schema.lotBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.lotBalances.itemId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.lotBalances.locationId))
    .where(
      and(
        eq(schema.lotBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
        gt(schema.lotBalances.qty, 0),
        lte(schema.lotBalances.expiresOn, horizon),
      ),
    )
    .orderBy(schema.lotBalances.expiresOn)
    .limit(20);

  return c.json({
    onHandUnits: Number(onHand?.units ?? 0),
    binRows: Number(onHand?.bins ?? 0),
    skuCount: Number(skuCount?.n ?? 0),
    allocatedUnits: Number(allocated?.units ?? 0),
    openReceipts: openReceiptRows.length,
    openOrders: openOrderRows.length,
    openWorkOrders: openWorkOrderRows.length,
    shopifyOpenOrders: Number(shopifyOpen?.n ?? 0),
    openTransfers: openTransferRows.length,
    putawayDue: putawaySuggestions.filter((row) => !cartonFromLocations.has(row.fromLocationId)).length + cartonPutaways.length,
    openCycleCounts: openCountRows.length,
    countVariances: countVariances.length,
    openHolds: openHoldRows.length,
    openPurchases: openPurchaseRows.length,
    openReturns: openReturnRows.length,
    openVendorReturns: openVendorReturnRows.length,
    openReplenishments: openReplenishRows.length,
    openKits: openKitRows.length,
    openWaves: openWaveRows.length,
    openAsns: openAsnRows.length,
    openYard: openYardRows.length,
    openCheckouts: openCheckoutRows.length,
    outOfService: outOfServiceRows.length,
    expiringCerts: expiringCerts.length,
    replenishDue: replenishSuggestions.length,
    expiringLots: expiringLots.length,
    lowStock,
    runwayThisWeek,
    recent,
    trend,
    timeZone: trendZone,
    hotBays: hotBays.map((row) => ({ ...row, units: Number(row.units) })),
    queues: {
      receipts: openReceiptRows,
      orders: openOrderRows,
      workOrders: openWorkOrderRows,
      putaways: openTransferRows,
      counts: openCountRows,
      countVariances,
      holds: openHoldRows,
      purchases: openPurchaseRows,
      returns: openReturnRows,
      vendorReturns: openVendorReturnRows,
      replenishments: openReplenishRows,
      kits: openKitRows,
      waves: openWaveRows,
      asns: openAsnRows,
      yard: openYardRows,
      checkouts: openCheckoutRows,
      outOfService: outOfServiceRows,
      expiringCerts,
      shopifyExceptions,
      trackerExceptions,
      expiringLots,
      cartonPutaways,
    },
    replenishSuggestions,
    putawaySuggestions: putawaySuggestions.filter((row) => !cartonFromLocations.has(row.fromLocationId)),
    cartonPutaways,
  });
});
