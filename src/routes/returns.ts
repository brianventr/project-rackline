import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { postReceiveLines } from "../db/stock";
import { applyPartialReceive, hasRemaining, isFullyReceived, remainingOnLine, OverReceiveError } from "../domain/partial-receive";
import { canReceiveReturn } from "../domain/status";
import { parseSerialList, normalizeLotCode } from "../domain/lots";
import { lineCatchWeight } from "../lib/catch-weight";
import { lineExpiry } from "../lib/expiry";
import { parseDisposition, type ReturnDisposition } from "../domain/return-disposition";
import { coveringHold } from "../domain/holds";
import { loadOpenHolds } from "../db/holds";
import { guardFloorJob, syncDocumentJob } from "../db/jobs";

export const returnsRoute = new Hono<AppEnv>();

function asExpected(line: { itemId: string; sku: string; qtyExpected: number; qtyReceived: number }) {
  return {
    itemId: line.itemId,
    sku: line.sku,
    qtyExpected: line.qtyExpected,
    qtyReceived: line.qtyReceived,
  };
}

function requireDisposition(raw: unknown): ReturnDisposition {
  try {
    return parseDisposition(raw);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Invalid disposition");
  }
}

async function rmaWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [rma] = await db
    .select({
      id: schema.rmas.id,
      organizationId: schema.rmas.organizationId,
      warehouseId: schema.rmas.warehouseId,
      number: schema.rmas.number,
      customerName: schema.rmas.customerName,
      status: schema.rmas.status,
      orderId: schema.rmas.orderId,
      locationId: schema.rmas.locationId,
      notes: schema.rmas.notes,
      createdAt: schema.rmas.createdAt,
      receivedAt: schema.rmas.receivedAt,
      orderNumber: schema.orders.number,
    })
    .from(schema.rmas)
    .leftJoin(schema.orders, eq(schema.orders.id, schema.rmas.orderId))
    .where(and(eq(schema.rmas.id, id), eq(schema.rmas.organizationId, organizationId)))
    .limit(1);
  if (!rma) notFound("Return not found");
  const lines = await db
    .select({
      id: schema.rmaLines.id,
      itemId: schema.rmaLines.itemId,
      qtyExpected: schema.rmaLines.qtyExpected,
      qtyReceived: schema.rmaLines.qtyReceived,
      disposition: schema.rmaLines.disposition,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.rmaLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.rmaLines.itemId))
    .where(eq(schema.rmaLines.rmaId, id));
  return {
    ...rma,
    lines: lines.map((line) => ({ ...line, remaining: remainingOnLine(asExpected(line)) })),
  };
}

returnsRoute.get("/returns", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.rmas.id,
      organizationId: schema.rmas.organizationId,
      warehouseId: schema.rmas.warehouseId,
      number: schema.rmas.number,
      customerName: schema.rmas.customerName,
      status: schema.rmas.status,
      orderId: schema.rmas.orderId,
      locationId: schema.rmas.locationId,
      notes: schema.rmas.notes,
      createdAt: schema.rmas.createdAt,
      receivedAt: schema.rmas.receivedAt,
      orderNumber: schema.orders.number,
    })
    .from(schema.rmas)
    .leftJoin(schema.orders, eq(schema.orders.id, schema.rmas.orderId))
    .where(eq(schema.rmas.organizationId, organizationId))
    .orderBy(desc(schema.rmas.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.rmaLines.id,
      rmaId: schema.rmaLines.rmaId,
      itemId: schema.rmaLines.itemId,
      qtyExpected: schema.rmaLines.qtyExpected,
      qtyReceived: schema.rmaLines.qtyReceived,
      disposition: schema.rmaLines.disposition,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.rmaLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.rmaLines.itemId))
    .where(
      inArray(
        schema.rmaLines.rmaId,
        rows.map((row) => row.id),
      ),
    );
  const byRma = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byRma.get(line.rmaId) ?? [];
    list.push(line);
    byRma.set(line.rmaId, list);
  }
  return c.json(
    rows.map((row) => ({
      ...row,
      lines: (byRma.get(row.id) ?? []).map((line) => ({
        ...line,
        remaining: remainingOnLine(asExpected(line)),
      })),
    })),
  );
});

returnsRoute.get("/returns/:id", async (c) => {
  return c.json(await rmaWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

returnsRoute.post("/returns", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    customerName?: string;
    orderId?: string | null;
    notes?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const customerName = requireString(body.customerName, "customerName");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one return line is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  let orderId: string | null = null;
  if (body.orderId) {
    const order = requireString(body.orderId, "orderId");
    const [row] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, order), eq(schema.orders.organizationId, organizationId)))
      .limit(1);
    if (!row) notFound("Order not found");
    orderId = row.id;
  }

  const now = Date.now();
  const id = newId();
  const seen = new Set<string>();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    if (seen.has(itemId)) badRequest("Each SKU can appear once on a return");
    seen.add(itemId);
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), rmaId: id, itemId, qtyExpected: qty, qtyReceived: 0, disposition: "restock" });
  }

  await db.batch([
    db.insert(schema.rmas).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("RMA"),
      customerName,
      status: "open",
      orderId,
      notes: body.notes?.trim() || null,
      createdAt: now,
    }),
    ...lines.map((line) => db.insert(schema.rmaLines).values(line)),
  ]);

  const created = await rmaWithLines(db, organizationId, id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: created.warehouseId,
    refType: "rma",
    refId: created.id,
    status: created.status,
    number: created.number,
    title: created.customerName,
    fromLocationId: created.locationId,
    createdAt: created.createdAt,
  });
  return c.json(created, 201);
});

returnsRoute.post("/returns/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rma = await rmaWithLines(db, organizationId, c.req.param("id"));
  if (rma.status !== "open") conflict("Return is not open");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: rma.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "rma",
    refId: rma.id,
    verb: "return",
    number: rma.number,
    title: rma.customerName,
    fromLocationId: rma.locationId,
    createdAt: rma.createdAt,
  });
  await db.update(schema.rmas).set({ status: "receiving" }).where(eq(schema.rmas.id, rma.id));
  const started = await rmaWithLines(db, organizationId, rma.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: started.warehouseId,
    refType: "rma",
    refId: started.id,
    status: started.status,
    number: started.number,
    title: started.customerName,
    fromLocationId: started.locationId,
    createdAt: started.createdAt,
  });
  return c.json(started);
});

returnsRoute.post("/returns/:id/receive", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: {
      itemId?: string;
      qty?: number;
      lotCode?: string;
      serials?: string | string[];
      weightGrams?: number;
      expiresOn?: unknown;
      disposition?: unknown;
    }[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const rma = await rmaWithLines(db, organizationId, c.req.param("id"));
  if (!canReceiveReturn(rma.status)) conflict("Return is already received");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: rma.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "rma",
    refId: rma.id,
    verb: "return",
    number: rma.number,
    title: rma.customerName,
    fromLocationId: locationId,
    createdAt: rma.createdAt,
  });
  if (!hasRemaining(rma.lines.map(asExpected))) conflict("Return has nothing remaining");
  const location = await getOrgLocation(db, organizationId, locationId);

  const incoming =
    Array.isArray(body.lines) && body.lines.length > 0
      ? body.lines.map((line) => {
          const itemId = requireString(line.itemId, "itemId");
          const docLine = rma.lines.find((row) => row.itemId === itemId);
          if (!docLine) badRequest("Line is not on this return");
          return {
            itemId: docLine.itemId,
            sku: docLine.sku,
            qty: requireInt(line.qty, "qty"),
            lotCode: line.lotCode?.trim() || null,
            serials: parseSerialList(line.serials),
            weightGrams: lineCatchWeight(docLine.catchWeight, docLine.sku, line.weightGrams),
            expiresOn: lineExpiry(docLine.trackExpiry, docLine.sku, line.expiresOn),
            disposition: requireDisposition(line.disposition),
          };
        })
      : rma.lines
          .map((line) => ({
            itemId: line.itemId,
            sku: line.sku,
            qty: line.remaining,
            lotCode: null as string | null,
            serials: [] as string[],
            weightGrams: lineCatchWeight(line.catchWeight, line.sku, undefined),
            expiresOn: lineExpiry(line.trackExpiry, line.sku, undefined),
            disposition: "restock" as const,
          }))
          .filter((line) => line.qty > 0);

  let applied;
  try {
    applied = applyPartialReceive(rma.lines.map(asExpected), incoming);
  } catch (err) {
    if (err instanceof OverReceiveError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid receive");
  }
  const now = Date.now();
  const nextStatus = isFullyReceived(applied.next) ? "received" : "receiving";
  const qtyByItem = new Map(applied.next.map((line) => [line.itemId, line.qtyReceived]));
  const dispositionByItem = new Map(incoming.map((line) => [line.itemId, line.disposition]));

  const holdLines = incoming.filter((line) => line.disposition === "hold" && applied.posted.some((row) => row.itemId === line.itemId));
  const extraHolds: BatchItem<"sqlite">[] = [];
  if (holdLines.length > 0) {
    const open = await loadOpenHolds(db, organizationId, location.warehouseId);
    const pending = [...open];
    for (const line of holdLines) {
      const lotCode = line.lotCode ? normalizeLotCode(line.lotCode) : null;
      const existing = coveringHold(pending, locationId, line.itemId, lotCode);
      if (existing) conflict(`Already on hold (${existing.number}: ${existing.reason})`);
      const number = docNumber("HLD");
      extraHolds.push(
        db.insert(schema.inventoryHolds).values({
          id: newId(),
          organizationId,
          warehouseId: location.warehouseId,
          number,
          status: "open",
          locationId,
          itemId: line.itemId,
          lotCode,
          reason: "QC",
          notes: "Return hold",
          createdAt: now,
        }),
      );
      pending.push({
        id: number,
        number,
        reason: "QC",
        locationId,
        locationCode: location.code,
        itemId: line.itemId,
        sku: line.sku,
        lotCode,
      });
    }
  }

  await postReceiveLines(db, {
    organizationId,
    createdBy: user.id,
    now,
    locationId,
    refType: "return",
    refId: rma.id,
    lines: applied.posted.map((line) => {
      const extra = incoming.find((row) => row.itemId === line.itemId);
      return {
        ...line,
        sku: extra?.sku,
        lotCode: extra?.lotCode,
        serials: extra?.serials.length ? extra.serials : null,
        weightGrams: extra?.weightGrams,
        expiresOn: extra?.expiresOn,
        disposition: extra?.disposition ?? "restock",
      };
    }),
    extra: [
      ...extraHolds,
      ...rma.lines.map((line) =>
        db
          .update(schema.rmaLines)
          .set({
            qtyReceived: qtyByItem.get(line.itemId) ?? line.qtyReceived,
            disposition: dispositionByItem.get(line.itemId) ?? line.disposition,
          })
          .where(eq(schema.rmaLines.id, line.id)),
      ),
      db
        .update(schema.rmas)
        .set({
          status: nextStatus,
          locationId,
          receivedAt: nextStatus === "received" ? now : rma.receivedAt,
        })
        .where(eq(schema.rmas.id, rma.id)),
    ],
  });

  const received = await rmaWithLines(db, organizationId, rma.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: received.warehouseId,
    refType: "rma",
    refId: received.id,
    status: received.status,
    number: received.number,
    title: received.customerName,
    fromLocationId: received.locationId,
    createdAt: received.createdAt,
  });
  return c.json(received);
});
