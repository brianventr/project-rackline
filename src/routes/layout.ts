import { Hono, type Context } from "hono";
import { and, eq, gt, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { isLocationType, requireOwner } from "../lib/org";
import { badRequest, conflict, notFound, requireString, optionalInt, optionalString } from "../lib/http";
import { newId } from "../lib/ids";
import {
  defaultAreaSpec,
  defaultRackSpec,
  expandArea,
  expandRack,
  isRotation,
  normalizeAisle,
  normalizeRack,
  padBay,
  type LocationDraft,
  type RackSpec,
  validateDrafts,
} from "../domain/rack-builder";

export const layoutRoute = new Hono<AppEnv>();

type LayoutContext = Context<AppEnv>;

async function warehouseFor(c: LayoutContext, warehouseId: string) {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  if (!warehouse) notFound("Warehouse not found");
  return warehouse;
}

async function locationsInWarehouse(c: LayoutContext, warehouseId: string) {
  const db = c.get("db");
  return db
    .select()
    .from(schema.locations)
    .where(
      and(
        eq(schema.locations.organizationId, c.get("organizationId")!),
        eq(schema.locations.warehouseId, warehouseId),
      ),
    );
}

async function occupiedIds(c: LayoutContext, locationIds: string[]): Promise<Set<string>> {
  if (locationIds.length === 0) return new Set();
  const rows = await c
    .get("db")
    .select({ locationId: schema.inventoryBalances.locationId })
    .from(schema.inventoryBalances)
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, c.get("organizationId")!),
        inArray(schema.inventoryBalances.locationId, locationIds),
        gt(schema.inventoryBalances.qty, 0),
      ),
    );
  return new Set(rows.map((row) => row.locationId));
}

function specFromBody(body: Record<string, unknown>, base?: Partial<RackSpec>): RackSpec {
  const rotationRaw = optionalInt(body.rotation, "rotation");
  if (rotationRaw !== undefined && !isRotation(rotationRaw)) badRequest("rotation must be 0, 90, 180, or 270");
  return defaultRackSpec({
    ...base,
    aisle: optionalString(body.aisle) ?? base?.aisle,
    rack: optionalString(body.rack) ?? base?.rack,
    posX: optionalInt(body.posX, "posX") ?? base?.posX,
    posY: optionalInt(body.posY, "posY") ?? base?.posY,
    rotation: rotationRaw ?? base?.rotation,
    bays: optionalInt(body.bays, "bays") ?? base?.bays,
    levels: optionalInt(body.levels, "levels") ?? base?.levels,
    bayWidth: optionalInt(body.bayWidth, "bayWidth") ?? base?.bayWidth,
    bayDepth: optionalInt(body.bayDepth, "bayDepth") ?? base?.bayDepth,
    bayPitch: optionalInt(body.bayPitch, "bayPitch") ?? base?.bayPitch,
    levelHeight: optionalInt(body.levelHeight, "levelHeight") ?? base?.levelHeight,
  });
}

async function insertDrafts(c: LayoutContext, warehouseId: string, drafts: LocationDraft[]) {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const created = [];
  for (const draft of drafts) {
    const [row] = await db
      .insert(schema.locations)
      .values({
        id: newId(),
        organizationId,
        warehouseId,
        code: draft.code,
        name: draft.name,
        type: draft.type,
        barcode: draft.barcode,
        area: draft.area,
        aisle: draft.aisle,
        rack: draft.rack,
        bay: draft.bay,
        level: draft.level,
        posX: draft.posX,
        posY: draft.posY,
        posZ: draft.posZ,
        sizeX: draft.sizeX,
        sizeY: draft.sizeY,
        sizeZ: draft.sizeZ,
      })
      .returning();
    created.push(row);
  }
  return created;
}

layoutRoute.post("/layout/racks", async (c) => {
  requireOwner(c.get("role"));
  const body = (await c.req.json()) as Record<string, unknown>;
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const warehouse = await warehouseFor(c, warehouseId);
  const spec = specFromBody(body);
  const drafts = expandRack(spec);
  const existing = await locationsInWarehouse(c, warehouseId);
  const issue = validateDrafts(drafts, existing, warehouse);
  if (issue) {
    if (issue.code === "collision-code") conflict(issue.message);
    badRequest(issue.message);
  }
  try {
    const created = await insertDrafts(c, warehouseId, drafts);
    return c.json({ spec, locations: created, count: created.length }, 201);
  } catch {
    return c.json({ error: "A bay code on that rack already exists" }, 409);
  }
});

layoutRoute.patch("/layout/racks", async (c) => {
  requireOwner(c.get("role"));
  const body = (await c.req.json()) as Record<string, unknown>;
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const fromAisle = normalizeAisle(requireString(body.fromAisle ?? body.aisle, "aisle"));
  const fromRack = normalizeRack(requireString(body.fromRack ?? body.rack, "rack"));
  const warehouse = await warehouseFor(c, warehouseId);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;

  const current = (await locationsInWarehouse(c, warehouseId)).filter(
    (row) => row.aisle === fromAisle && row.rack === fromRack,
  );
  if (current.length === 0) notFound("Rack not found");

  const sample = current[0]!;
  const uniqueBays = new Set(current.map((row) => row.bay)).size;
  const uniqueLevels = new Set(current.map((row) => row.level)).size;
  const spec = specFromBody(body, {
    aisle: fromAisle,
    rack: fromRack,
    posX: sample.posX,
    posY: sample.posY,
    bays: uniqueBays,
    levels: uniqueLevels,
    bayWidth: sample.sizeY,
    bayDepth: sample.sizeX,
    bayPitch: sample.sizeY,
    levelHeight: sample.sizeZ,
  });
  const drafts = expandRack(spec);
  const ignoreIds = new Set(current.map((row) => row.id));
  const existing = await locationsInWarehouse(c, warehouseId);
  const issue = validateDrafts(drafts, existing, warehouse, ignoreIds);
  if (issue) {
    if (issue.code === "collision-code") conflict(issue.message);
    badRequest(issue.message);
  }

  const bySlot = new Map(current.map((row) => [`${padBay(row.bay ?? "01")}:${row.level}`, row]));
  const wanted = new Set(drafts.map((draft) => `${padBay(draft.bay ?? "01")}:${draft.level}`));
  const removed = current.filter((row) => !wanted.has(`${padBay(row.bay ?? "01")}:${row.level}`));
  const blocked = await occupiedIds(
    c,
    removed.map((row) => row.id),
  );
  if (blocked.size > 0) {
    conflict("Empty those bays before shrinking the rack.");
  }

  for (const draft of drafts) {
    const key = `${padBay(draft.bay ?? "01")}:${draft.level}`;
    const match = bySlot.get(key);
    if (match) {
      await db
        .update(schema.locations)
        .set({
          code: draft.code,
          name: draft.name,
          barcode: draft.barcode,
          area: draft.area,
          aisle: draft.aisle,
          rack: draft.rack,
          bay: draft.bay,
          level: draft.level,
          posX: draft.posX,
          posY: draft.posY,
          posZ: draft.posZ,
          sizeX: draft.sizeX,
          sizeY: draft.sizeY,
          sizeZ: draft.sizeZ,
        })
        .where(and(eq(schema.locations.id, match.id), eq(schema.locations.organizationId, organizationId)));
    } else {
      await insertDrafts(c, warehouseId, [draft]);
    }
  }
  for (const row of removed) {
    await db
      .delete(schema.locations)
      .where(and(eq(schema.locations.id, row.id), eq(schema.locations.organizationId, organizationId)));
  }
  return c.json({ spec, count: drafts.length });
});

layoutRoute.delete("/layout/racks", async (c) => {
  requireOwner(c.get("role"));
  const body = (await c.req.json()) as Record<string, unknown>;
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const aisle = normalizeAisle(requireString(body.aisle, "aisle"));
  const rack = normalizeRack(requireString(body.rack, "rack"));
  await warehouseFor(c, warehouseId);
  const current = (await locationsInWarehouse(c, warehouseId)).filter((row) => row.aisle === aisle && row.rack === rack);
  if (current.length === 0) notFound("Rack not found");
  const blocked = await occupiedIds(
    c,
    current.map((row) => row.id),
  );
  if (blocked.size > 0) conflict("Move stock off this rack before deleting it.");
  const db = c.get("db");
  await db.delete(schema.locations).where(
    inArray(
      schema.locations.id,
      current.map((row) => row.id),
    ),
  );
  return c.json({ ok: true, count: current.length });
});

layoutRoute.post("/layout/areas", async (c) => {
  requireOwner(c.get("role"));
  const body = (await c.req.json()) as Record<string, unknown>;
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const type = requireString(body.type, "type");
  if (!isLocationType(type) || type === "storage") badRequest("Area type must be receiving, production, or shipping");
  const warehouse = await warehouseFor(c, warehouseId);
  const existing = await locationsInWarehouse(c, warehouseId);
  const posX = optionalInt(body.posX, "posX") ?? 2;
  const posY = optionalInt(body.posY, "posY") ?? 2;
  const base = defaultAreaSpec(type, existing, posX, posY);
  const spec = {
    ...base,
    code: (optionalString(body.code) ?? base.code).toUpperCase(),
    name: optionalString(body.name) ?? base.name,
    sizeX: optionalInt(body.sizeX, "sizeX") ?? base.sizeX,
    sizeY: optionalInt(body.sizeY, "sizeY") ?? base.sizeY,
    sizeZ: optionalInt(body.sizeZ, "sizeZ") ?? base.sizeZ,
  };
  const draft = expandArea(spec);
  const issue = validateDrafts([draft], existing, warehouse);
  if (issue) {
    if (issue.code === "collision-code") conflict(issue.message);
    badRequest(issue.message);
  }
  const [created] = await insertDrafts(c, warehouseId, [draft]);
  return c.json({ spec, location: created }, 201);
});
