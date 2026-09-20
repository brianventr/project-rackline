import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireString } from "../lib/http";
import { getOrgLocation, requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { canAssignDock, canCheckInYard, canCheckOutYard } from "../domain/status";
import { nextYardStatus } from "../domain/yard";
import { recordLaborEvent } from "../db/labor";

export const yardRoute = new Hono<AppEnv>();

async function visitDetail(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [visit] = await db
    .select()
    .from(schema.yardVisits)
    .where(and(eq(schema.yardVisits.id, id), eq(schema.yardVisits.organizationId, organizationId)))
    .limit(1);
  if (!visit) notFound("Yard visit not found");
  return visit;
}

yardRoute.get("/yard", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.yardVisits)
    .where(eq(schema.yardVisits.organizationId, organizationId))
    .orderBy(desc(schema.yardVisits.createdAt));
  return c.json(rows);
});

yardRoute.get("/yard/:id", async (c) => {
  return c.json(await visitDetail(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

yardRoute.post("/yard", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    carrierName?: string;
    trailerNumber?: string;
    asnId?: string;
    purchaseId?: string;
    eta?: number;
    notes?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const carrierName = requireString(body.carrierName, "carrierName");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = newId();
  await db.insert(schema.yardVisits).values({
    id,
    organizationId,
    warehouseId,
    number: docNumber("YRD"),
    status: "expected",
    carrierName,
    trailerNumber: body.trailerNumber?.trim() || null,
    asnId: body.asnId || null,
    purchaseId: body.purchaseId || null,
    eta: typeof body.eta === "number" ? body.eta : null,
    notes: body.notes?.trim() || null,
    createdAt: Date.now(),
  });
  return c.json(await visitDetail(db, organizationId, id), 201);
});

yardRoute.post("/yard/:id/check-in", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const visit = await visitDetail(db, organizationId, c.req.param("id"));
  if (!canCheckInYard(visit.status)) conflict("Visit is not expected");
  const next = nextYardStatus(visit.status, "check_in");
  if (!next) conflict("Cannot check in");
  const now = Date.now();
  await db
    .update(schema.yardVisits)
    .set({ status: next, checkedInAt: now })
    .where(eq(schema.yardVisits.id, visit.id));
  await recordLaborEvent(db, {
    organizationId,
    warehouseId: visit.warehouseId,
    userId: user.id,
    verb: "yard",
    refType: "yard",
    refId: visit.id,
    notes: "check_in",
    now,
  });
  return c.json(await visitDetail(db, organizationId, visit.id));
});

yardRoute.post("/yard/:id/dock", async (c) => {
  const body = await c.req.json<{ dockLocationId?: string }>();
  const dockLocationId = requireString(body.dockLocationId, "dockLocationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const visit = await visitDetail(db, organizationId, c.req.param("id"));
  if (!canAssignDock(visit.status)) conflict("Visit must be checked in");
  const location = await getOrgLocation(db, organizationId, dockLocationId);
  if (location.warehouseId !== visit.warehouseId) badRequest("Dock must be in the same warehouse");
  const next = nextYardStatus(visit.status, "assign_dock");
  if (!next) conflict("Cannot assign dock");
  const now = Date.now();
  await db
    .update(schema.yardVisits)
    .set({ status: next, dockLocationId })
    .where(eq(schema.yardVisits.id, visit.id));
  await recordLaborEvent(db, {
    organizationId,
    warehouseId: visit.warehouseId,
    userId: user.id,
    verb: "yard",
    refType: "yard",
    refId: visit.id,
    notes: "assign_dock",
    now,
  });
  return c.json(await visitDetail(db, organizationId, visit.id));
});

yardRoute.post("/yard/:id/check-out", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const visit = await visitDetail(db, organizationId, c.req.param("id"));
  if (!canCheckOutYard(visit.status)) conflict("Visit cannot check out");
  const next = nextYardStatus(visit.status, "check_out");
  if (!next) conflict("Cannot check out");
  const now = Date.now();
  await db
    .update(schema.yardVisits)
    .set({ status: next, checkedOutAt: now })
    .where(eq(schema.yardVisits.id, visit.id));
  await recordLaborEvent(db, {
    organizationId,
    warehouseId: visit.warehouseId,
    userId: user.id,
    verb: "yard",
    refType: "yard",
    refId: visit.id,
    notes: "check_out",
    now,
  });
  return c.json(await visitDetail(db, organizationId, visit.id));
});

yardRoute.delete("/yard/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const visit = await visitDetail(db, organizationId, c.req.param("id"));
  if (visit.status !== "expected") conflict("Only expected visits can be deleted");
  await db.delete(schema.yardVisits).where(eq(schema.yardVisits.id, visit.id));
  return c.body(null, 204);
});
