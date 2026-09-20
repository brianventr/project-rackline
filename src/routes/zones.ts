import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, notFound, requireString } from "../lib/http";
import { getOrgLocation, requireOwner } from "../lib/org";
import { newId } from "../lib/ids";

export const zonesRoute = new Hono<AppEnv>();

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
  const body = await c.req.json<{ warehouseId?: string; code?: string; name?: string }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const code = requireString(body.code, "code").toUpperCase();
  const name = requireString(body.name, "name");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  if (!warehouse) badRequest("Warehouse not found");
  const [row] = await db
    .insert(schema.zones)
    .values({
      id: newId(),
      organizationId,
      warehouseId,
      code,
      name,
      createdAt: Date.now(),
    })
    .returning();
  return c.json(row, 201);
});

zonesRoute.patch("/zones/:id", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ code?: string; name?: string }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [zone] = await db
    .select()
    .from(schema.zones)
    .where(and(eq(schema.zones.id, c.req.param("id")), eq(schema.zones.organizationId, organizationId)))
    .limit(1);
  if (!zone) notFound("Zone not found");
  const patch: { code?: string; name?: string } = {};
  if (body.code?.trim()) patch.code = body.code.trim().toUpperCase();
  if (body.name?.trim()) patch.name = body.name.trim();
  if (Object.keys(patch).length === 0) badRequest("No zone fields to update");
  const [row] = await db.update(schema.zones).set(patch).where(eq(schema.zones.id, zone.id)).returning();
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
