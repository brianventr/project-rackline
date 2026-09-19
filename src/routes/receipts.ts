import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { chainPlans, planReceive } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { canReceive } from "../domain/status";

export const receiptsRoute = new Hono<AppEnv>();

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
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.receiptLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.receiptLines.itemId))
    .where(eq(schema.receiptLines.receiptId, id));
  return { ...receipt, lines };
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
      sku: schema.items.sku,
      itemName: schema.items.name,
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
  return c.json(rows.map((row) => ({ ...row, lines: byReceipt.get(row.id) ?? [] })));
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
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), receiptId: id, itemId, qty });
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

  return c.json(await receiptWithLines(db, organizationId, id), 201);
});

receiptsRoute.post("/receipts/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const receipt = await receiptWithLines(db, organizationId, c.req.param("id"));
  if (receipt.status !== "draft") conflict("Receipt is not a draft");
  await db.update(schema.receipts).set({ status: "receiving" }).where(eq(schema.receipts.id, receipt.id));
  return c.json(await receiptWithLines(db, organizationId, receipt.id));
});

receiptsRoute.post("/receipts/:id/receive", async (c) => {
  const body = await c.req.json<{ locationId?: string }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const receipt = await receiptWithLines(db, organizationId, c.req.param("id"));
  if (!canReceive(receipt.status)) conflict("Receipt already posted");
  await getOrgLocation(db, organizationId, locationId);

  const pairs = receipt.lines.map((line) => ({ locationId, itemId: line.itemId }));
  const loaded = await loadBalanceMap(db, organizationId, pairs);
  const plan = chainPlans(
    qtyMap(loaded),
    receipt.lines.map((line) => (balances) =>
      planReceive({
        itemId: line.itemId,
        locationId,
        qty: line.qty,
        refId: receipt.id,
        balances,
      }),
    ),
  );

  const now = Date.now();
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.receipts)
        .set({ status: "received", locationId, receivedAt: now })
        .where(eq(schema.receipts.id, receipt.id)),
    ],
  });

  return c.json(await receiptWithLines(db, organizationId, receipt.id));
});
