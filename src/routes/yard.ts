import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireString } from "../lib/http";
import { getOrgLocation, requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { canAssignDock, canCheckInYard, canCheckOutYard, canReceiveAsn } from "../domain/status";
import { asnHandoffPatch, canReceiveLinkedAsn, nextYardStatus } from "../domain/yard";
import { recordLaborEvent } from "../db/labor";
import { hasRemaining } from "../domain/partial-receive";
import { postReceiveLines } from "../db/stock";
import { applyPartialReceive, isFullyReceived, remainingOnLine, OverReceiveError } from "../domain/partial-receive";

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
  const statements: BatchItem<"sqlite">[] = [
    db
      .update(schema.yardVisits)
      .set({ status: next, dockLocationId })
      .where(eq(schema.yardVisits.id, visit.id)),
  ];
  if (visit.asnId) {
    const [asn] = await db.select().from(schema.asns).where(eq(schema.asns.id, visit.asnId)).limit(1);
    const patch = asnHandoffPatch({
      asnId: visit.asnId,
      dockLocationId,
      currentAsnStatus: asn?.status,
    });
    if (patch) {
      statements.push(
        db
          .update(schema.asns)
          .set({
            locationId: patch.locationId,
            status: patch.status,
            expectedAt: asn?.expectedAt ?? now,
          })
          .where(eq(schema.asns.id, patch.asnId)),
      );
    }
  }
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
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

yardRoute.post("/yard/:id/receive-asn", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const visit = await visitDetail(db, organizationId, c.req.param("id"));
  if (!canReceiveLinkedAsn(visit)) conflict("Visit needs a linked ASN at dock");
  const asnId = visit.asnId!;
  const locationId = visit.dockLocationId!;
  const [asn] = await db
    .select()
    .from(schema.asns)
    .where(and(eq(schema.asns.id, asnId), eq(schema.asns.organizationId, organizationId)))
    .limit(1);
  if (!asn) notFound("ASN not found");
  if (!canReceiveAsn(asn.status)) conflict("ASN is already received");
  const lines = await db
    .select({
      id: schema.asnLines.id,
      itemId: schema.asnLines.itemId,
      qtyExpected: schema.asnLines.qtyExpected,
      qtyReceived: schema.asnLines.qtyReceived,
      sku: schema.items.sku,
      catchWeight: schema.items.catchWeight,
    })
    .from(schema.asnLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.asnLines.itemId))
    .where(eq(schema.asnLines.asnId, asnId));
  const expected = lines.map((line) => ({
    itemId: line.itemId,
    sku: line.sku,
    qtyExpected: line.qtyExpected,
    qtyReceived: line.qtyReceived,
  }));
  if (!hasRemaining(expected)) conflict("ASN has nothing remaining");
  const incoming = lines
    .filter((line) => remainingOnLine(expected.find((e) => e.itemId === line.itemId)!) > 0)
    .map((line) => ({
      itemId: line.itemId,
      sku: line.sku,
      qty: remainingOnLine(expected.find((e) => e.itemId === line.itemId)!),
      lotCode: null as string | null,
      serials: [] as string[],
      weightGrams: null as number | null,
      expiresOn: null as number | null,
    }));
  let applied;
  try {
    applied = applyPartialReceive(
      expected,
      incoming.map((row) => ({ itemId: row.itemId, sku: row.sku, qty: row.qty })),
    );
  } catch (err) {
    if (err instanceof OverReceiveError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid receive");
  }
  const now = Date.now();
  const fully = isFullyReceived(applied.next);
  const qtyByItem = new Map(applied.next.map((line) => [line.itemId, line.qtyReceived]));
  await postReceiveLines(db, {
    organizationId,
    createdBy: user.id,
    now,
    locationId,
    refType: "asn",
    refId: asnId,
    clientId: asn.clientId,
    lines: incoming,
    extra: [
      ...lines.map((line) =>
        db
          .update(schema.asnLines)
          .set({ qtyReceived: qtyByItem.get(line.itemId) ?? line.qtyReceived })
          .where(eq(schema.asnLines.id, line.id)),
      ),
      db
        .update(schema.asns)
        .set({
          status: fully ? "received" : "receiving",
          locationId,
          receivedAt: fully ? now : asn.receivedAt,
        })
        .where(eq(schema.asns.id, asnId)),
    ],
  });
  await recordLaborEvent(db, {
    organizationId,
    warehouseId: visit.warehouseId,
    userId: user.id,
    verb: "receive",
    refType: "asn",
    refId: asnId,
    qty: incoming.reduce((sum, row) => sum + row.qty, 0),
    notes: `yard:${visit.number}`,
    now,
  });
  return c.json({ visit: await visitDetail(db, organizationId, visit.id), asnId });
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
