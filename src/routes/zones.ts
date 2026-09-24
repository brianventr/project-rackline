import { Hono, type Context } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, optionalInt, optionalString, requireString } from "../lib/http";
import { getOrgLocation, requireOwner } from "../lib/org";
import { newId } from "../lib/ids";
import { boxInZone, hasFootprint, validateZoneFootprint, type ZoneRect } from "../domain/zones";

export const zonesRoute = new Hono<AppEnv>();

type ZoneContext = Context<AppEnv>;
type ZoneRow = typeof schema.zones.$inferSelect;

async function warehouseFor(c: ZoneContext, warehouseId: string) {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  if (!warehouse) badRequest("Warehouse not found");
  return warehouse;
}

async function zonesInWarehouse(c: ZoneContext, warehouseId: string) {
  const db = c.get("db");
  return db
    .select()
    .from(schema.zones)
    .where(and(eq(schema.zones.organizationId, c.get("organizationId")!), eq(schema.zones.warehouseId, warehouseId)));
}

/** Footprint fields from a request body: all four when any size is given, nothing when none is. */
function footprintFromBody(body: Record<string, unknown>, base?: ZoneRect): ZoneRect | null {
  const posX = optionalInt(body.posX, "posX");
  const posY = optionalInt(body.posY, "posY");
  const sizeX = optionalInt(body.sizeX, "sizeX");
  const sizeY = optionalInt(body.sizeY, "sizeY");
  if (posX === undefined && posY === undefined && sizeX === undefined && sizeY === undefined) return null;
  return {
    posX: posX ?? base?.posX ?? 0,
    posY: posY ?? base?.posY ?? 0,
    sizeX: sizeX ?? base?.sizeX ?? 0,
    sizeY: sizeY ?? base?.sizeY ?? 0,
  };
}

function checkFootprint(
  rect: ZoneRect,
  others: ZoneRow[],
  warehouse: { mapWidth: number; mapDepth: number; mapHeight: number },
  ignoreId?: string,
) {
  // A zero size clears the drawing and needs no room on the floor.
  if (rect.sizeX === 0 && rect.sizeY === 0) {
    if (rect.posX !== 0 || rect.posY !== 0) badRequest("A zone with no size has no origin");
    return;
  }
  const issue = validateZoneFootprint(rect, others, warehouse, ignoreId);
  if (issue) {
    if (issue.code === "overlap") conflict(issue.message, "ZONE_OVERLAP");
    badRequest(issue.message);
  }
}

/**
 * Drawn zones own the bays inside them: every bay whose centre sits in the rectangle joins the zone, and a bay
 * that carried this zone but now sits outside it is cleared. A tag-only zone leaves bays as they are.
 */
async function syncZoneBays(c: ZoneContext, zone: ZoneRow) {
  if (!hasFootprint(zone)) return;
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.locations.id,
      posX: schema.locations.posX,
      posY: schema.locations.posY,
      sizeX: schema.locations.sizeX,
      sizeY: schema.locations.sizeY,
      zoneId: schema.locations.zoneId,
    })
    .from(schema.locations)
    .where(and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.warehouseId, zone.warehouseId)));
  const join = rows.filter((row) => boxInZone(zone, row) && row.zoneId !== zone.id).map((row) => row.id);
  const leave = rows.filter((row) => !boxInZone(zone, row) && row.zoneId === zone.id).map((row) => row.id);
  if (join.length) await db.update(schema.locations).set({ zoneId: zone.id }).where(inArray(schema.locations.id, join));
  if (leave.length) await db.update(schema.locations).set({ zoneId: null }).where(inArray(schema.locations.id, leave));
}

zonesRoute.get("/zones", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId");
  const rows = await db
    .select()
    .from(schema.zones)
    .where(
      and(
        eq(schema.zones.organizationId, organizationId),
        warehouseId ? eq(schema.zones.warehouseId, warehouseId) : undefined,
      ),
    )
    .orderBy(schema.zones.code);
  return c.json(rows);
});

zonesRoute.post("/zones", async (c) => {
  requireOwner(c.get("role"));
  const body = (await c.req.json()) as Record<string, unknown>;
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const code = requireString(body.code, "code").toUpperCase();
  const name = requireString(body.name, "name");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouse = await warehouseFor(c, warehouseId);
  const others = await zonesInWarehouse(c, warehouseId);
  if (others.some((zone) => zone.code.toUpperCase() === code)) conflict(`Zone ${code} already exists in this warehouse`);
  const rect = footprintFromBody(body) ?? { posX: 0, posY: 0, sizeX: 0, sizeY: 0 };
  checkFootprint(rect, others, warehouse);
  const [row] = await db
    .insert(schema.zones)
    .values({
      id: newId(),
      organizationId,
      warehouseId,
      code,
      name,
      createdAt: Date.now(),
      ...rect,
    })
    .returning();
  await syncZoneBays(c, row!);
  return c.json(row, 201);
});

zonesRoute.patch("/zones/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = (await c.req.json()) as Record<string, unknown>;
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [zone] = await db
    .select()
    .from(schema.zones)
    .where(and(eq(schema.zones.id, c.req.param("id")), eq(schema.zones.organizationId, organizationId)))
    .limit(1);
  if (!zone) notFound("Zone not found");
  const patch: Partial<ZoneRow> = {};
  const code = optionalString(body.code)?.toUpperCase();
  const name = optionalString(body.name);
  const others = (await zonesInWarehouse(c, zone.warehouseId)).filter((row) => row.id !== zone.id);
  if (code && code !== zone.code) {
    if (others.some((row) => row.code.toUpperCase() === code)) conflict(`Zone ${code} already exists in this warehouse`);
    patch.code = code;
  }
  if (name) patch.name = name;
  const rect = footprintFromBody(body, zone);
  if (rect) {
    const warehouse = await warehouseFor(c, zone.warehouseId);
    checkFootprint(rect, others, warehouse, zone.id);
    Object.assign(patch, rect);
  }
  if (Object.keys(patch).length === 0) badRequest("No zone fields to update");
  const [row] = await db.update(schema.zones).set(patch).where(eq(schema.zones.id, zone.id)).returning();
  if (rect) await syncZoneBays(c, row!);
  return c.json(row);
});

zonesRoute.post("/locations/:id/zone", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ zoneId?: string | null }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const location = await getOrgLocation(db, organizationId, c.req.param("id"));
  const zoneId = body.zoneId === null || body.zoneId === "" ? null : body.zoneId;
  if (zoneId) {
    const [zone] = await db
      .select()
      .from(schema.zones)
      .where(and(eq(schema.zones.id, zoneId), eq(schema.zones.organizationId, organizationId)))
      .limit(1);
    if (!zone) badRequest("Zone not found");
    if (zone.warehouseId !== location.warehouseId) badRequest("Zone must be in the same warehouse");
  }
  const [row] = await db
    .update(schema.locations)
    .set({ zoneId })
    .where(eq(schema.locations.id, location.id))
    .returning();
  return c.json(row);
});

zonesRoute.delete("/zones/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [zone] = await db
    .select()
    .from(schema.zones)
    .where(and(eq(schema.zones.id, c.req.param("id")), eq(schema.zones.organizationId, organizationId)))
    .limit(1);
  if (!zone) notFound("Zone not found");
  await db.update(schema.locations).set({ zoneId: null }).where(eq(schema.locations.zoneId, zone.id));
  await db.delete(schema.zones).where(eq(schema.zones.id, zone.id));
  return c.body(null, 204);
});
