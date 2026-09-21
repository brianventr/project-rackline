import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { coveringHold, HOLD_REASONS } from "../domain/holds";
import { normalizeLotCode } from "../domain/lots";
import { canReleaseHold } from "../domain/status";
import { loadOpenHolds } from "../db/holds";
import { guardFloorJob, syncDocumentJob } from "../db/jobs";
import { scheduleShopifySellableSync } from "../db/shopify-sellable";

export const holdsRoute = new Hono<AppEnv>();

async function holdWithScope(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select({
      id: schema.inventoryHolds.id,
      organizationId: schema.inventoryHolds.organizationId,
      warehouseId: schema.inventoryHolds.warehouseId,
      number: schema.inventoryHolds.number,
      status: schema.inventoryHolds.status,
      locationId: schema.inventoryHolds.locationId,
      itemId: schema.inventoryHolds.itemId,
      lotCode: schema.inventoryHolds.lotCode,
      serialCode: schema.inventoryHolds.serialCode,
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
    .where(and(eq(schema.inventoryHolds.id, id), eq(schema.inventoryHolds.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Hold not found");
  return row;
}

holdsRoute.get("/holds", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.inventoryHolds.id,
      warehouseId: schema.inventoryHolds.warehouseId,
      number: schema.inventoryHolds.number,
      status: schema.inventoryHolds.status,
      locationId: schema.inventoryHolds.locationId,
      itemId: schema.inventoryHolds.itemId,
      lotCode: schema.inventoryHolds.lotCode,
      serialCode: schema.inventoryHolds.serialCode,
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
    .where(eq(schema.inventoryHolds.organizationId, organizationId))
    .orderBy(desc(schema.inventoryHolds.createdAt));
  return c.json(rows);
});

holdsRoute.get("/holds/:id", async (c) => {
  return c.json(await holdWithScope(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

holdsRoute.post("/holds", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    locationId?: string;
    itemId?: string;
    lotCode?: string;
    reason?: string;
    notes?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const locationId = requireString(body.locationId, "locationId");
  const reason = requireString(body.reason, "reason");
  if (!(HOLD_REASONS as readonly string[]).includes(reason)) {
    badRequest("Reason must be QC, Damaged, Count variance, or Recall");
  }
  const itemId = body.itemId?.trim() || null;
  const lotCode = body.lotCode?.trim() ? normalizeLotCode(body.lotCode) : null;
  if (lotCode && !itemId) badRequest("Lot holds require a SKU");

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const location = await getOrgLocation(db, organizationId, locationId);
  if (location.warehouseId !== warehouseId) badRequest("Location must be in the selected warehouse");
  if (itemId) {
    const item = await getOrgItem(db, organizationId, itemId);
    if (lotCode && !item.trackLot) badRequest(`${item.sku} is not lot-tracked`);
  }

  const open = await loadOpenHolds(db, organizationId, warehouseId);
  const existing = coveringHold(open, locationId, itemId, lotCode);
  if (existing) conflict(`Already on hold (${existing.number}: ${existing.reason})`);

  const [row] = await db
    .insert(schema.inventoryHolds)
    .values({
      id: newId(),
      organizationId,
      warehouseId,
      number: docNumber("HLD"),
      status: "open",
      locationId,
      itemId,
      lotCode,
      reason,
      notes: body.notes?.trim() || null,
      createdAt: Date.now(),
    })
    .returning();

  const created = await holdWithScope(db, organizationId, row.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: created.warehouseId,
    refType: "hold",
    refId: created.id,
    status: created.status,
    number: created.number,
    title: created.reason,
    fromLocationId: created.locationId,
    itemId: created.itemId,
    createdAt: created.createdAt,
  });
  if (created.itemId) {
    await scheduleShopifySellableSync(db, organizationId, [created.itemId]);
  } else {
    await scheduleShopifySellableSync(db, organizationId);
  }
  return c.json(created, 201);
});

holdsRoute.post("/holds/:id/release", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const hold = await holdWithScope(db, organizationId, c.req.param("id"));
  if (!canReleaseHold(hold.status)) conflict("Hold is already released");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: hold.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "hold",
    refId: hold.id,
    verb: "hold",
    number: hold.number,
    title: hold.reason,
    fromLocationId: hold.locationId,
    itemId: hold.itemId,
    createdAt: hold.createdAt,
  });
  await db
    .update(schema.inventoryHolds)
    .set({ status: "released", releasedAt: Date.now() })
    .where(eq(schema.inventoryHolds.id, hold.id));
  const released = await holdWithScope(db, organizationId, hold.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: released.warehouseId,
    refType: "hold",
    refId: released.id,
    status: released.status,
    number: released.number,
    title: released.reason,
    fromLocationId: released.locationId,
    itemId: released.itemId,
    createdAt: released.createdAt,
  });
  if (released.itemId) {
    await scheduleShopifySellableSync(db, organizationId, [released.itemId]);
  } else {
    await scheduleShopifySellableSync(db, organizationId);
  }
  return c.json(released);
});
