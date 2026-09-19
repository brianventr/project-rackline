import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { postReceiveLines } from "../db/stock";
import { applyPartialReceive, hasRemaining, isFullyReceived, remainingOnLine, OverReceiveError } from "../domain/partial-receive";
import { canReceivePurchase, canStartPurchase } from "../domain/status";
import { parseSerialList } from "../domain/lots";

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
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
    })
    .from(schema.purchaseLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.purchaseLines.itemId))
    .where(eq(schema.purchaseLines.purchaseId, id));
  return {
    ...purchase,
    lines: lines.map((line) => ({ ...line, remaining: remainingOnLine(asExpected(line)) })),
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

  return c.json(await purchaseWithLines(db, organizationId, id), 201);
});

purchasesRoute.post("/purchases/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const purchase = await purchaseWithLines(db, organizationId, c.req.param("id"));
  if (!canStartPurchase(purchase.status)) conflict("Purchase is not a draft");
  await db
    .update(schema.purchases)
    .set({ status: "ordered", orderedAt: Date.now() })
    .where(eq(schema.purchases.id, purchase.id));
  return c.json(await purchaseWithLines(db, organizationId, purchase.id));
});

purchasesRoute.post("/purchases/:id/receive", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: { itemId?: string; qty?: number; lotCode?: string; serials?: string | string[] }[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  let purchase = await purchaseWithLines(db, organizationId, c.req.param("id"));
  if (!canReceivePurchase(purchase.status)) conflict("Purchase is already received");
  if (!hasRemaining(purchase.lines.map(asExpected))) conflict("Purchase has nothing remaining");
  await getOrgLocation(db, organizationId, locationId);

  if (purchase.status === "draft") {
    await db
      .update(schema.purchases)
      .set({ status: "ordered", orderedAt: Date.now() })
      .where(eq(schema.purchases.id, purchase.id));
    purchase = await purchaseWithLines(db, organizationId, purchase.id);
  }

  const incoming =
    Array.isArray(body.lines) && body.lines.length > 0
      ? body.lines.map((line) => ({
          itemId: requireString(line.itemId, "itemId"),
          qty: requireInt(line.qty, "qty"),
          lotCode: line.lotCode?.trim() || null,
          serials: parseSerialList(line.serials),
        }))
      : purchase.lines
          .map((line) => ({ itemId: line.itemId, qty: line.remaining, lotCode: null as string | null, serials: [] as string[] }))
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

  return c.json(await purchaseWithLines(db, organizationId, purchase.id));
});
