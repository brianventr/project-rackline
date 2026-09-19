import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { postReceiveLines } from "../db/stock";
import { applyPartialReceive, hasRemaining, isFullyReceived, remainingOnLine, OverReceiveError } from "../domain/partial-receive";
import { canReceiveReturn } from "../domain/status";
import { parseSerialList } from "../domain/lots";

export const returnsRoute = new Hono<AppEnv>();

function asExpected(line: { itemId: string; sku: string; qtyExpected: number; qtyReceived: number }) {
  return {
    itemId: line.itemId,
    sku: line.sku,
    qtyExpected: line.qtyExpected,
    qtyReceived: line.qtyReceived,
  };
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
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
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
      sku: schema.items.sku,
      itemName: schema.items.name,
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
    lines.push({ id: newId(), rmaId: id, itemId, qtyExpected: qty, qtyReceived: 0 });
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

  return c.json(await rmaWithLines(db, organizationId, id), 201);
});

returnsRoute.post("/returns/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rma = await rmaWithLines(db, organizationId, c.req.param("id"));
  if (rma.status !== "open") conflict("Return is not open");
  await db.update(schema.rmas).set({ status: "receiving" }).where(eq(schema.rmas.id, rma.id));
  return c.json(await rmaWithLines(db, organizationId, rma.id));
});

returnsRoute.post("/returns/:id/receive", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: { itemId?: string; qty?: number; lotCode?: string; serials?: string | string[] }[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const rma = await rmaWithLines(db, organizationId, c.req.param("id"));
  if (!canReceiveReturn(rma.status)) conflict("Return is already received");
  if (!hasRemaining(rma.lines.map(asExpected))) conflict("Return has nothing remaining");
  await getOrgLocation(db, organizationId, locationId);

  const incoming =
    Array.isArray(body.lines) && body.lines.length > 0
      ? body.lines.map((line) => ({
          itemId: requireString(line.itemId, "itemId"),
          qty: requireInt(line.qty, "qty"),
          lotCode: line.lotCode?.trim() || null,
          serials: parseSerialList(line.serials),
        }))
      : rma.lines
          .map((line) => ({ itemId: line.itemId, qty: line.remaining, lotCode: null as string | null, serials: [] as string[] }))
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
        lotCode: extra?.lotCode,
        serials: extra?.serials.length ? extra.serials : null,
      };
    }),
    extra: [
      ...rma.lines.map((line) =>
        db
          .update(schema.rmaLines)
          .set({ qtyReceived: qtyByItem.get(line.itemId) ?? line.qtyReceived })
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

  return c.json(await rmaWithLines(db, organizationId, rma.id));
});
