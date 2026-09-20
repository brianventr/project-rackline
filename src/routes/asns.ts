import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation, requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { postReceiveLines } from "../db/stock";
import { applyPartialReceive, hasRemaining, isFullyReceived, remainingOnLine, OverReceiveError } from "../domain/partial-receive";
import { canExpectAsn, canReceiveAsn } from "../domain/status";
import { parseSerialList } from "../domain/lots";
import { lineCatchWeight } from "../lib/catch-weight";
import { lineExpiry } from "../lib/expiry";
import { recordLaborEvent } from "../db/labor";

export const asnsRoute = new Hono<AppEnv>();

function asExpected(line: { itemId: string; sku: string; qtyExpected: number; qtyReceived: number }) {
  return {
    itemId: line.itemId,
    sku: line.sku,
    qtyExpected: line.qtyExpected,
    qtyReceived: line.qtyReceived,
  };
}

async function asnWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [asn] = await db
    .select()
    .from(schema.asns)
    .where(and(eq(schema.asns.id, id), eq(schema.asns.organizationId, organizationId)))
    .limit(1);
  if (!asn) notFound("ASN not found");
  const lines = await db
    .select({
      id: schema.asnLines.id,
      itemId: schema.asnLines.itemId,
      qtyExpected: schema.asnLines.qtyExpected,
      qtyReceived: schema.asnLines.qtyReceived,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.asnLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.asnLines.itemId))
    .where(eq(schema.asnLines.asnId, id));
  return {
    ...asn,
    lines: lines.map((line) => ({ ...line, remaining: remainingOnLine(asExpected(line)) })),
  };
}

asnsRoute.get("/asns", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.asns)
    .where(eq(schema.asns.organizationId, organizationId))
    .orderBy(desc(schema.asns.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.asnLines.id,
      asnId: schema.asnLines.asnId,
      itemId: schema.asnLines.itemId,
      qtyExpected: schema.asnLines.qtyExpected,
      qtyReceived: schema.asnLines.qtyReceived,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.asnLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.asnLines.itemId))
    .where(
      inArray(
        schema.asnLines.asnId,
        rows.map((row) => row.id),
      ),
    );
  const byAsn = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byAsn.get(line.asnId) ?? [];
    list.push(line);
    byAsn.set(line.asnId, list);
  }
  return c.json(
    rows.map((row) => ({
      ...row,
      lines: (byAsn.get(row.id) ?? []).map((line) => ({
        ...line,
        remaining: remainingOnLine(asExpected(line)),
      })),
    })),
  );
});

asnsRoute.get("/asns/:id", async (c) => {
  return c.json(await asnWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

asnsRoute.post("/asns", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    vendorName?: string;
    notes?: string;
    purchaseId?: string;
    clientId?: string;
    eta?: number;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const vendorName = requireString(body.vendorName, "vendorName");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one ASN line is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  if (body.purchaseId) {
    const [purchase] = await db
      .select()
      .from(schema.purchases)
      .where(and(eq(schema.purchases.id, body.purchaseId), eq(schema.purchases.organizationId, organizationId)))
      .limit(1);
    if (!purchase) badRequest("Purchase not found");
  }
  if (body.clientId) {
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.id, body.clientId), eq(schema.clients.organizationId, organizationId)))
      .limit(1);
    if (!client) badRequest("Client not found");
  }

  const now = Date.now();
  const id = newId();
  const seen = new Set<string>();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    if (seen.has(itemId)) badRequest("Each SKU can appear once on an ASN");
    seen.add(itemId);
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), asnId: id, itemId, qtyExpected: qty, qtyReceived: 0 });
  }

  await db.batch([
    db.insert(schema.asns).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("ASN"),
      vendorName,
      status: "draft",
      purchaseId: body.purchaseId || null,
      clientId: body.clientId || null,
      eta: typeof body.eta === "number" ? body.eta : null,
      notes: body.notes?.trim() || null,
      createdAt: now,
    }),
    ...lines.map((line) => db.insert(schema.asnLines).values(line)),
  ]);

  return c.json(await asnWithLines(db, organizationId, id), 201);
});

asnsRoute.post("/asns/:id/expect", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const asn = await asnWithLines(db, organizationId, c.req.param("id"));
  if (!canExpectAsn(asn.status)) conflict("ASN is not a draft");
  await db
    .update(schema.asns)
    .set({ status: "expected", expectedAt: Date.now() })
    .where(eq(schema.asns.id, asn.id));
  return c.json(await asnWithLines(db, organizationId, asn.id));
});

asnsRoute.post("/asns/:id/receive", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: { itemId?: string; qty?: number; lotCode?: string; serials?: string | string[]; weightGrams?: number; expiresOn?: unknown }[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  let asn = await asnWithLines(db, organizationId, c.req.param("id"));
  if (!canReceiveAsn(asn.status)) conflict("ASN is already received");
  if (!hasRemaining(asn.lines.map(asExpected))) conflict("ASN has nothing remaining");
  await getOrgLocation(db, organizationId, locationId);

  if (asn.status === "draft") {
    await db
      .update(schema.asns)
      .set({ status: "expected", expectedAt: Date.now() })
      .where(eq(schema.asns.id, asn.id));
    asn = await asnWithLines(db, organizationId, asn.id);
  }

  const incoming =
    Array.isArray(body.lines) && body.lines.length > 0
      ? body.lines.map((row) => {
          const itemId = requireString(row.itemId, "itemId");
          const line = asn.lines.find((l) => l.itemId === itemId);
          if (!line) badRequest("Line is not on this ASN");
          return {
            itemId,
            sku: line.sku,
            qty: requireInt(row.qty, "qty"),
            lotCode: row.lotCode?.trim() || null,
            serials: parseSerialList(row.serials),
            weightGrams: lineCatchWeight(line.catchWeight, line.sku, row.weightGrams),
            expiresOn: lineExpiry(line.trackExpiry, line.sku, row.expiresOn),
          };
        })
      : asn.lines
          .filter((line) => line.remaining > 0)
          .map((line) => ({
            itemId: line.itemId,
            sku: line.sku,
            qty: line.remaining,
            lotCode: null as string | null,
            serials: [] as string[],
            weightGrams: null as number | null,
            expiresOn: null as number | null,
          }));

  let applied;
  try {
    applied = applyPartialReceive(
      asn.lines.map(asExpected),
      incoming.map((row) => ({ itemId: row.itemId, sku: row.sku, qty: row.qty })),
    );
  } catch (err) {
    if (err instanceof OverReceiveError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid receive");
  }

  const now = Date.now();
  const fully = isFullyReceived(applied.next);
  const qtyByItem = new Map(applied.next.map((line) => [line.itemId, line.qtyReceived]));
  const posted = incoming.filter((row) => row.qty > 0);

  await postReceiveLines(db, {
    organizationId,
    createdBy: user.id,
    now,
    locationId,
    refType: "asn",
    refId: asn.id,
    lines: posted.map((row) => ({
      itemId: row.itemId,
      sku: row.sku,
      qty: row.qty,
      lotCode: row.lotCode,
      serials: row.serials,
      weightGrams: row.weightGrams,
      expiresOn: row.expiresOn,
    })),
    extra: [
      ...asn.lines.map((line) =>
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
        .where(eq(schema.asns.id, asn.id)),
    ],
  });

  await recordLaborEvent(db, {
    organizationId,
    warehouseId: asn.warehouseId,
    userId: user.id,
    verb: "receive",
    refType: "asn",
    refId: asn.id,
    qty: posted.reduce((sum, row) => sum + row.qty, 0),
    now,
  });

  return c.json(await asnWithLines(db, organizationId, asn.id));
});

asnsRoute.delete("/asns/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const asn = await asnWithLines(db, organizationId, c.req.param("id"));
  if (asn.status !== "draft") conflict("Only draft ASNs can be deleted");
  await db.delete(schema.asns).where(eq(schema.asns.id, asn.id));
  return c.body(null, 204);
});
