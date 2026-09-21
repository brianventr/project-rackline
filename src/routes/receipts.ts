import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { postReceiveLines } from "../db/stock";
import { applyPartialReceive, hasRemaining, isFullyReceived, remainingOnLine, OverReceiveError } from "../domain/partial-receive";
import { canReceive } from "../domain/status";
import { parseSerialList } from "../domain/lots";
import { lineCatchWeight } from "../lib/catch-weight";
import { lineExpiry } from "../lib/expiry";
import { guardFloorJob, syncDocumentJob } from "../db/jobs";

export const receiptsRoute = new Hono<AppEnv>();

function asExpected(line: { itemId: string; sku: string; qty: number; qtyReceived: number }) {
  return {
    itemId: line.itemId,
    sku: line.sku,
    qtyExpected: line.qty,
    qtyReceived: line.qtyReceived,
  };
}

async function receiptWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [receipt] = await db
    .select()
    .from(schema.receipts)
    .where(and(eq(schema.receipts.id, id), eq(schema.receipts.organizationId, organizationId)))
    .limit(1);
  if (!receipt) notFound("Receipt not found");
  const lines = await db
    .select({
      id: schema.receiptLines.id,
      itemId: schema.receiptLines.itemId,
      qty: schema.receiptLines.qty,
      qtyReceived: schema.receiptLines.qtyReceived,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.receiptLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.receiptLines.itemId))
    .where(eq(schema.receiptLines.receiptId, id));
  return {
    ...receipt,
    lines: lines.map((line) => ({ ...line, remaining: remainingOnLine(asExpected(line)) })),
  };
}

receiptsRoute.get("/receipts", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.receipts)
    .where(eq(schema.receipts.organizationId, organizationId))
    .orderBy(desc(schema.receipts.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.receiptLines.id,
      receiptId: schema.receiptLines.receiptId,
      itemId: schema.receiptLines.itemId,
      qty: schema.receiptLines.qty,
      qtyReceived: schema.receiptLines.qtyReceived,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.receiptLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.receiptLines.itemId))
    .where(
      inArray(
        schema.receiptLines.receiptId,
        rows.map((row) => row.id),
      ),
    );
  const byReceipt = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byReceipt.get(line.receiptId) ?? [];
    list.push(line);
    byReceipt.set(line.receiptId, list);
  }
  return c.json(
    rows.map((row) => {
      const receiptLines = (byReceipt.get(row.id) ?? []).map((line) => ({
        ...line,
        remaining: remainingOnLine(asExpected(line)),
      }));
      return { ...row, lines: receiptLines };
    }),
  );
});

receiptsRoute.get("/receipts/:id", async (c) => {
  return c.json(await receiptWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

receiptsRoute.post("/receipts", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    notes?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one receipt line is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const now = Date.now();
  const id = newId();
  const seen = new Set<string>();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    if (seen.has(itemId)) badRequest("Each SKU can appear once on a receipt");
    seen.add(itemId);
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), receiptId: id, itemId, qty, qtyReceived: 0 });
  }

  await db.batch([
    db.insert(schema.receipts).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("RCP"),
      status: "draft",
      notes: body.notes?.trim() || null,
      createdAt: now,
    }),
    ...lines.map((line) => db.insert(schema.receiptLines).values(line)),
  ]);

  const created = await receiptWithLines(db, organizationId, id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: created.warehouseId,
    refType: "receipt",
    refId: created.id,
    status: created.status,
    number: created.number,
    title: created.notes || "Receive onto the dock",
    fromLocationId: created.locationId,
    createdAt: created.createdAt,
  });
  return c.json(created, 201);
});

receiptsRoute.post("/receipts/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const receipt = await receiptWithLines(db, organizationId, c.req.param("id"));
  if (receipt.status !== "draft") conflict("Receipt is not a draft");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: receipt.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "receipt",
    refId: receipt.id,
    verb: "receive",
    number: receipt.number,
    title: receipt.notes,
    fromLocationId: receipt.locationId,
    createdAt: receipt.createdAt,
  });
  await db.update(schema.receipts).set({ status: "receiving" }).where(eq(schema.receipts.id, receipt.id));
  const started = await receiptWithLines(db, organizationId, receipt.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: started.warehouseId,
    refType: "receipt",
    refId: started.id,
    status: started.status,
    number: started.number,
    title: started.notes,
    fromLocationId: started.locationId,
    createdAt: started.createdAt,
  });
  return c.json(started);
});

receiptsRoute.post("/receipts/:id/receive", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: { itemId?: string; qty?: number; lotCode?: string; serials?: string | string[]; weightGrams?: number; expiresOn?: unknown }[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  let receipt = await receiptWithLines(db, organizationId, c.req.param("id"));
  if (!canReceive(receipt.status)) conflict("Receipt is already received");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: receipt.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "receipt",
    refId: receipt.id,
    verb: "receive",
    number: receipt.number,
    title: receipt.notes,
    fromLocationId: locationId,
    createdAt: receipt.createdAt,
  });
  if (!hasRemaining(receipt.lines.map(asExpected))) conflict("Receipt has nothing remaining");
  await getOrgLocation(db, organizationId, locationId);

  if (receipt.status === "draft") {
    await db.update(schema.receipts).set({ status: "receiving" }).where(eq(schema.receipts.id, receipt.id));
    receipt = await receiptWithLines(db, organizationId, receipt.id);
  }

  const incoming =
    Array.isArray(body.lines) && body.lines.length > 0
      ? body.lines.map((line) => {
          const itemId = requireString(line.itemId, "itemId");
          const docLine = receipt.lines.find((row) => row.itemId === itemId);
          if (!docLine) badRequest("Line is not on this receipt");
          return {
            itemId: docLine.itemId,
            qty: requireInt(line.qty, "qty"),
            lotCode: line.lotCode?.trim() || null,
            serials: parseSerialList(line.serials),
            weightGrams: lineCatchWeight(docLine.catchWeight, docLine.sku, line.weightGrams),
            expiresOn: lineExpiry(docLine.trackExpiry, docLine.sku, line.expiresOn),
          };
        })
      : receipt.lines
          .map((line) => ({
            itemId: line.itemId,
            qty: line.remaining,
            lotCode: null as string | null,
            serials: [] as string[],
            weightGrams: lineCatchWeight(line.catchWeight, line.sku, undefined),
            expiresOn: lineExpiry(line.trackExpiry, line.sku, undefined),
          }))
          .filter((line) => line.qty > 0);

  let applied;
  try {
    applied = applyPartialReceive(receipt.lines.map(asExpected), incoming);
  } catch (err) {
    if (err instanceof OverReceiveError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid receive");
  }
  const now = Date.now();
  const nextStatus = isFullyReceived(applied.next) ? "received" : "receiving";
  const qtyByItem = new Map(applied.next.map((line) => [line.itemId, line.qtyReceived]));

  await postReceiveLines(db, {
    organizationId,
    createdBy: user.id,
    now,
    locationId,
    refType: "receipt",
    refId: receipt.id,
    lines: applied.posted.map((line) => {
      const extra = incoming.find((row) => row.itemId === line.itemId);
      return {
        ...line,
        lotCode: extra?.lotCode,
        serials: extra?.serials.length ? extra.serials : null,
        weightGrams: extra?.weightGrams,
        expiresOn: extra?.expiresOn,
      };
    }),
    extra: [
      ...receipt.lines.map((line) =>
        db
          .update(schema.receiptLines)
          .set({ qtyReceived: qtyByItem.get(line.itemId) ?? line.qtyReceived })
          .where(eq(schema.receiptLines.id, line.id)),
      ),
      db
        .update(schema.receipts)
        .set({
          status: nextStatus,
          locationId,
          receivedAt: nextStatus === "received" ? now : receipt.receivedAt,
        })
        .where(eq(schema.receipts.id, receipt.id)),
    ],
  });

  const received = await receiptWithLines(db, organizationId, receipt.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: received.warehouseId,
    refType: "receipt",
    refId: received.id,
    status: received.status,
    number: received.number,
    title: received.notes,
    fromLocationId: received.locationId,
    createdAt: received.createdAt,
  });
  return c.json(received);
});
