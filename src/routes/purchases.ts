import { Hono, type Context } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { postReceiveLines } from "../db/stock";
import { applyPartialReceive, hasRemaining, isFullyReceived, remainingOnLine, OverReceiveError } from "../domain/partial-receive";
import { canReceivePurchase, canStartPurchase } from "../domain/status";
import { sendPurchaseOrder } from "../db/purchase-send";
import { demoPurchaseMessage } from "../domain/purchase-send";
import { isEmailAddress } from "../domain/purchase-mail";
import { sendPurchaseEmail } from "../lib/mail";
import { parseSerialList } from "../domain/lots";
import { lineCatchWeight } from "../lib/catch-weight";
import { lineExpiry } from "../lib/expiry";
import { guardFloorJob, syncDocumentJob, type DocumentJobInput } from "../db/jobs";
import { loadReorderQueue } from "../db/reorder";
import { loadRunway } from "../db/runway";
import { majorityVendor } from "../domain/reorder";

function purchaseJob(row: {
  id: string;
  organizationId: string;
  warehouseId: string;
  status: string;
  number: string;
  vendorName: string;
  locationId: string | null;
  createdAt: number;
}): DocumentJobInput {
  return {
    organizationId: row.organizationId,
    warehouseId: row.warehouseId,
    refType: "purchase",
    refId: row.id,
    status: row.status,
    number: row.number,
    title: row.vendorName,
    fromLocationId: row.locationId,
    createdAt: row.createdAt,
  };
}

export const purchasesRoute = new Hono<AppEnv>();

function asExpected(line: { itemId: string; sku: string; qtyOrdered: number; qtyReceived: number }) {
  return {
    itemId: line.itemId,
    sku: line.sku,
    qtyExpected: line.qtyOrdered,
    qtyReceived: line.qtyReceived,
  };
}

async function purchaseWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [purchase] = await db
    .select()
    .from(schema.purchases)
    .where(and(eq(schema.purchases.id, id), eq(schema.purchases.organizationId, organizationId)))
    .limit(1);
  if (!purchase) notFound("Purchase not found");
  const lines = await db
    .select({
      id: schema.purchaseLines.id,
      itemId: schema.purchaseLines.itemId,
      qtyOrdered: schema.purchaseLines.qtyOrdered,
      qtyReceived: schema.purchaseLines.qtyReceived,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.purchaseLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.purchaseLines.itemId))
    .where(eq(schema.purchaseLines.purchaseId, id));
  const asns = await db
    .select()
    .from(schema.asns)
    .where(and(eq(schema.asns.purchaseId, id), eq(schema.asns.organizationId, organizationId)))
    .orderBy(desc(schema.asns.createdAt));
  const sends = await db
    .select()
    .from(schema.purchaseSends)
    .where(and(eq(schema.purchaseSends.purchaseId, id), eq(schema.purchaseSends.organizationId, organizationId)))
    .orderBy(desc(schema.purchaseSends.createdAt))
    .limit(5);
  return {
    ...purchase,
    lines: lines.map((line) => ({ ...line, remaining: remainingOnLine(asExpected(line)) })),
    asns,
    send: sends[0] ?? null,
    sends,
  };
}

purchasesRoute.get("/purchases", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.purchases)
    .where(eq(schema.purchases.organizationId, organizationId))
    .orderBy(desc(schema.purchases.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.purchaseLines.id,
      purchaseId: schema.purchaseLines.purchaseId,
      itemId: schema.purchaseLines.itemId,
      qtyOrdered: schema.purchaseLines.qtyOrdered,
      qtyReceived: schema.purchaseLines.qtyReceived,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.purchaseLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.purchaseLines.itemId))
    .where(
      inArray(
        schema.purchaseLines.purchaseId,
        rows.map((row) => row.id),
      ),
    );
  const byPurchase = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byPurchase.get(line.purchaseId) ?? [];
    list.push(line);
    byPurchase.set(line.purchaseId, list);
  }
  return c.json(
    rows.map((row) => {
      const purchaseLines = (byPurchase.get(row.id) ?? []).map((line) => ({
        ...line,
        remaining: remainingOnLine(asExpected(line)),
      }));
      return { ...row, lines: purchaseLines };
    }),
  );
});

purchasesRoute.get("/purchases/:id", async (c) => {
  return c.json(await purchaseWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

purchasesRoute.post("/purchases", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    vendorName?: string;
    notes?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const vendorName = requireString(body.vendorName, "vendorName");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one purchase line is required");
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
    if (seen.has(itemId)) badRequest("Each SKU can appear once on a purchase");
    seen.add(itemId);
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), purchaseId: id, itemId, qtyOrdered: qty, qtyReceived: 0 });
  }

  await db.batch([
    db.insert(schema.purchases).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("PO"),
      vendorName,
      status: "draft",
      notes: body.notes?.trim() || null,
      createdAt: now,
    }),
    ...lines.map((line) => db.insert(schema.purchaseLines).values(line)),
  ]);

  const created = await purchaseWithLines(db, organizationId, id);
  await syncDocumentJob(db, purchaseJob(created));
  return c.json(created, 201);
});

purchasesRoute.post("/purchases/from-reorder", async (c) => {
  const body = await c.req.json<{ warehouseId?: string; notes?: string }>().catch(() => ({}) as { warehouseId?: string; notes?: string });
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const queue = await loadReorderQueue(db, organizationId, warehouseId);
  if (queue.draftLines.length === 0) {
    conflict("Nothing below reorder that isn't already on an open PO");
  }
  const vendorName = majorityVendor(queue.draftLines, queue.orgVendor ?? "Reorder");
  const now = Date.now();
  const id = newId();
  await db.batch([
    db.insert(schema.purchases).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("PO"),
      vendorName,
      status: "draft",
      notes: body.notes?.trim() || "Drafted from Today reorder queue",
      createdAt: now,
    }),
    ...queue.draftLines.map((line) =>
      db.insert(schema.purchaseLines).values({
        id: newId(),
        purchaseId: id,
        itemId: line.itemId,
        qtyOrdered: line.qty,
        qtyReceived: 0,
      }),
    ),
  ]);
  const created = await purchaseWithLines(db, organizationId, id);
  await syncDocumentJob(db, purchaseJob(created));
  return c.json(created, 201);
});

purchasesRoute.post("/purchases/from-runway", async (c) => {
  const body = await c.req.json<{ warehouseId?: string; notes?: string }>().catch(() => ({}) as { warehouseId?: string; notes?: string });
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const queue = await loadRunway(db, organizationId, { warehouseId, window: "30d", multiplier: 1 });
  if (queue.draftLines.length === 0) {
    conflict("Nothing about to stock out that isn't already on an open PO");
  }
  const vendorName = majorityVendor(
    queue.draftLines.map((line) => ({
      itemId: line.itemId,
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      onHand: 0,
      reorderPoint: 0,
      vendorName: line.vendorName,
    })),
    queue.orgVendor ?? "Reorder",
  );
  const now = Date.now();
  const id = newId();
  await db.batch([
    db.insert(schema.purchases).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("PO"),
      vendorName,
      status: "draft",
      notes: body.notes?.trim() || "Drafted from Runway order-today queue",
      createdAt: now,
    }),
    ...queue.draftLines.map((line) =>
      db.insert(schema.purchaseLines).values({
        id: newId(),
        purchaseId: id,
        itemId: line.itemId,
        qtyOrdered: line.qty,
        qtyReceived: 0,
      }),
    ),
  ]);
  const created = await purchaseWithLines(db, organizationId, id);
  await syncDocumentJob(db, purchaseJob(created));
  return c.json(created, 201);
});

async function deliverPurchase(
  c: Context<AppEnv>,
  purchase: Awaited<ReturnType<typeof purchaseWithLines>>,
  body: { to?: string; message?: string },
  options: { requireEmail: boolean },
) {
  const toAddress = body.to?.trim() || purchase.vendorName;
  const message =
    body.message?.trim() ||
    demoPurchaseMessage({
      number: purchase.number,
      vendorName: purchase.vendorName,
      lines: purchase.lines,
    });
  const apiKey = c.env.MAIL_API_KEY?.trim();
  const from = c.env.MAIL_FROM?.trim();
  const mailConfigured = Boolean(apiKey && from);
  let mode: "demo" | "sent" = "demo";
  let providerId: string | null = null;
  if (mailConfigured && isEmailAddress(toAddress)) {
    try {
      const sent = await sendPurchaseEmail({
        apiKey: apiKey!,
        from: from!,
        to: toAddress,
        subject: purchase.number,
        text: message,
      });
      mode = "sent";
      providerId = sent.id;
    } catch (err) {
      conflict(err instanceof Error ? err.message : "Mail failed", "MAIL_FAILED");
    }
  } else if (options.requireEmail && mailConfigured) {
    conflict("Send needs a vendor email address", "MAIL_ADDRESS");
  }
  return sendPurchaseOrder(c.get("db"), {
    organizationId: c.get("organizationId")!,
    purchase,
    to: toAddress,
    message,
    mode,
    providerId,
  });
}

purchasesRoute.post("/purchases/:id/start", async (c) => {
  const body = await c.req.json<{ to?: string; message?: string }>().catch(() => ({}) as { to?: string; message?: string });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const purchase = await purchaseWithLines(db, organizationId, c.req.param("id"));
  if (!canStartPurchase(purchase.status)) conflict("Purchase is not a draft");
  await guardFloorJob(db, {
    ...purchaseJob(purchase),
    userId: c.get("user")!.id,
    role: c.get("role")!,
    verb: "receive",
  });
  const sent = await deliverPurchase(c, purchase, body, { requireEmail: true });
  const started = await purchaseWithLines(db, organizationId, purchase.id);
  await syncDocumentJob(db, purchaseJob(started));
  return c.json({ ...started, mintedAsnId: sent.asnId });
});

purchasesRoute.post("/purchases/:id/send", async (c) => {
  const body = await c.req.json<{ to?: string; message?: string }>().catch(() => ({}) as { to?: string; message?: string });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const purchase = await purchaseWithLines(db, organizationId, c.req.param("id"));
  if (!canStartPurchase(purchase.status)) conflict("Purchase is not a draft");
  await guardFloorJob(db, {
    ...purchaseJob(purchase),
    userId: c.get("user")!.id,
    role: c.get("role")!,
    verb: "receive",
  });
  const sent = await deliverPurchase(c, purchase, body, { requireEmail: true });
  const started = await purchaseWithLines(db, organizationId, purchase.id);
  await syncDocumentJob(db, purchaseJob(started));
  return c.json({ ...started, mintedAsnId: sent.asnId });
});

purchasesRoute.post("/purchases/:id/receive", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: { itemId?: string; qty?: number; lotCode?: string; serials?: string | string[]; weightGrams?: number; expiresOn?: unknown }[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  let purchase = await purchaseWithLines(db, organizationId, c.req.param("id"));
  if (!canReceivePurchase(purchase.status)) conflict("Purchase is already received");
  await guardFloorJob(db, {
    ...purchaseJob(purchase),
    userId: user.id,
    role: c.get("role")!,
    verb: "receive",
    fromLocationId: locationId,
  });
  if (!hasRemaining(purchase.lines.map(asExpected))) conflict("Purchase has nothing remaining");
  await getOrgLocation(db, organizationId, locationId);

  if (purchase.status === "draft") {
    await deliverPurchase(c, purchase, {}, { requireEmail: false });
    purchase = await purchaseWithLines(db, organizationId, purchase.id);
  }

  const incoming =
    Array.isArray(body.lines) && body.lines.length > 0
      ? body.lines.map((line) => {
          const itemId = requireString(line.itemId, "itemId");
          const docLine = purchase.lines.find((row) => row.itemId === itemId);
          if (!docLine) badRequest("Line is not on this purchase");
          return {
            itemId: docLine.itemId,
            qty: requireInt(line.qty, "qty"),
            lotCode: line.lotCode?.trim() || null,
            serials: parseSerialList(line.serials),
            weightGrams: lineCatchWeight(docLine.catchWeight, docLine.sku, line.weightGrams),
            expiresOn: lineExpiry(docLine.trackExpiry, docLine.sku, line.expiresOn),
          };
        })
      : purchase.lines
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
    applied = applyPartialReceive(purchase.lines.map(asExpected), incoming);
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
    refType: "purchase",
    refId: purchase.id,
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
      ...purchase.lines.map((line) =>
        db
          .update(schema.purchaseLines)
          .set({ qtyReceived: qtyByItem.get(line.itemId) ?? line.qtyReceived })
          .where(eq(schema.purchaseLines.id, line.id)),
      ),
      db
        .update(schema.purchases)
        .set({
          status: nextStatus,
          locationId,
          receivedAt: nextStatus === "received" ? now : purchase.receivedAt,
        })
        .where(eq(schema.purchases.id, purchase.id)),
    ],
  });

  const received = await purchaseWithLines(db, organizationId, purchase.id);
  await syncDocumentJob(db, purchaseJob(received));
  return c.json(received);
});
