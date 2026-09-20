import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { chainPlans, planRtv } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { applyPartialReturn, hasUnreturned, isFullyReturned, remainingToReturn, OverReturnError } from "../domain/partial-rtv";
import { canPostVendorReturn } from "../domain/status";
import { parseSerialList } from "../domain/lots";
import { guardFloorJob, syncDocumentJob } from "../db/jobs";
import { lineCatchWeight } from "../lib/catch-weight";

export const vendorReturnsRoute = new Hono<AppEnv>();

function asRtvLine(line: { itemId: string; sku: string; qtyExpected: number; qtyReturned: number }) {
  return {
    itemId: line.itemId,
    sku: line.sku,
    qtyExpected: line.qtyExpected,
    qtyReturned: line.qtyReturned,
  };
}

async function rtvWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select({
      id: schema.vendorReturns.id,
      organizationId: schema.vendorReturns.organizationId,
      warehouseId: schema.vendorReturns.warehouseId,
      number: schema.vendorReturns.number,
      vendorName: schema.vendorReturns.vendorName,
      status: schema.vendorReturns.status,
      purchaseId: schema.vendorReturns.purchaseId,
      locationId: schema.vendorReturns.locationId,
      notes: schema.vendorReturns.notes,
      createdAt: schema.vendorReturns.createdAt,
      returnedAt: schema.vendorReturns.returnedAt,
      purchaseNumber: schema.purchases.number,
    })
    .from(schema.vendorReturns)
    .leftJoin(schema.purchases, eq(schema.purchases.id, schema.vendorReturns.purchaseId))
    .where(and(eq(schema.vendorReturns.id, id), eq(schema.vendorReturns.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Vendor return not found");
  const lines = await db
    .select({
      id: schema.vendorReturnLines.id,
      itemId: schema.vendorReturnLines.itemId,
      qtyExpected: schema.vendorReturnLines.qtyExpected,
      qtyReturned: schema.vendorReturnLines.qtyReturned,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
    })
    .from(schema.vendorReturnLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.vendorReturnLines.itemId))
    .where(eq(schema.vendorReturnLines.vendorReturnId, id));
  return {
    ...row,
    lines: lines.map((line) => ({ ...line, remaining: remainingToReturn(asRtvLine(line)) })),
  };
}

vendorReturnsRoute.get("/vendor-returns", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.vendorReturns.id,
      organizationId: schema.vendorReturns.organizationId,
      warehouseId: schema.vendorReturns.warehouseId,
      number: schema.vendorReturns.number,
      vendorName: schema.vendorReturns.vendorName,
      status: schema.vendorReturns.status,
      purchaseId: schema.vendorReturns.purchaseId,
      locationId: schema.vendorReturns.locationId,
      notes: schema.vendorReturns.notes,
      createdAt: schema.vendorReturns.createdAt,
      returnedAt: schema.vendorReturns.returnedAt,
      purchaseNumber: schema.purchases.number,
    })
    .from(schema.vendorReturns)
    .leftJoin(schema.purchases, eq(schema.purchases.id, schema.vendorReturns.purchaseId))
    .where(eq(schema.vendorReturns.organizationId, organizationId))
    .orderBy(desc(schema.vendorReturns.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.vendorReturnLines.id,
      vendorReturnId: schema.vendorReturnLines.vendorReturnId,
      itemId: schema.vendorReturnLines.itemId,
      qtyExpected: schema.vendorReturnLines.qtyExpected,
      qtyReturned: schema.vendorReturnLines.qtyReturned,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
    })
    .from(schema.vendorReturnLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.vendorReturnLines.itemId))
    .where(
      inArray(
        schema.vendorReturnLines.vendorReturnId,
        rows.map((row) => row.id),
      ),
    );
  const byRtv = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byRtv.get(line.vendorReturnId) ?? [];
    list.push(line);
    byRtv.set(line.vendorReturnId, list);
  }
  return c.json(
    rows.map((row) => ({
      ...row,
      lines: (byRtv.get(row.id) ?? []).map((line) => ({
        ...line,
        remaining: remainingToReturn(asRtvLine(line)),
      })),
    })),
  );
});

vendorReturnsRoute.get("/vendor-returns/:id", async (c) => {
  return c.json(await rtvWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

vendorReturnsRoute.post("/vendor-returns", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    vendorName?: string;
    purchaseId?: string | null;
    notes?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const vendorName = requireString(body.vendorName, "vendorName");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one vendor return line is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  let purchaseId: string | null = null;
  if (body.purchaseId) {
    const purchase = requireString(body.purchaseId, "purchaseId");
    const [row] = await db
      .select({ id: schema.purchases.id })
      .from(schema.purchases)
      .where(and(eq(schema.purchases.id, purchase), eq(schema.purchases.organizationId, organizationId)))
      .limit(1);
    if (!row) notFound("Purchase not found");
    purchaseId = row.id;
  }

  const now = Date.now();
  const id = newId();
  const seen = new Set<string>();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    if (seen.has(itemId)) badRequest("Each SKU can appear once on a vendor return");
    seen.add(itemId);
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), vendorReturnId: id, itemId, qtyExpected: qty, qtyReturned: 0 });
  }

  await db.batch([
    db.insert(schema.vendorReturns).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("RTV"),
      vendorName,
      status: "open",
      purchaseId,
      notes: body.notes?.trim() || null,
      createdAt: now,
    }),
    ...lines.map((line) => db.insert(schema.vendorReturnLines).values(line)),
  ]);

  const created = await rtvWithLines(db, organizationId, id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: created.warehouseId,
    refType: "vendorReturn",
    refId: created.id,
    status: created.status,
    number: created.number,
    title: created.vendorName,
    fromLocationId: created.locationId,
    createdAt: created.createdAt,
  });
  return c.json(created, 201);
});

vendorReturnsRoute.post("/vendor-returns/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rtv = await rtvWithLines(db, organizationId, c.req.param("id"));
  if (rtv.status !== "open") conflict("Vendor return is not open");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: rtv.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "vendorReturn",
    refId: rtv.id,
    verb: "rtv",
    number: rtv.number,
    title: rtv.vendorName,
    fromLocationId: rtv.locationId,
    createdAt: rtv.createdAt,
  });
  await db.update(schema.vendorReturns).set({ status: "returning" }).where(eq(schema.vendorReturns.id, rtv.id));
  const started = await rtvWithLines(db, organizationId, rtv.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: started.warehouseId,
    refType: "vendorReturn",
    refId: started.id,
    status: started.status,
    number: started.number,
    title: started.vendorName,
    fromLocationId: started.locationId,
    createdAt: started.createdAt,
  });
  return c.json(started);
});

vendorReturnsRoute.post("/vendor-returns/:id/return", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: { itemId?: string; qty?: number; lotCode?: string; serials?: string | string[]; weightGrams?: number }[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const rtv = await rtvWithLines(db, organizationId, c.req.param("id"));
  if (!canPostVendorReturn(rtv.status)) conflict("Vendor return is already returned");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: rtv.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "vendorReturn",
    refId: rtv.id,
    verb: "rtv",
    number: rtv.number,
    title: rtv.vendorName,
    fromLocationId: locationId,
    createdAt: rtv.createdAt,
  });
  if (!hasUnreturned(rtv.lines.map(asRtvLine))) conflict("Vendor return has nothing remaining");
  await getOrgLocation(db, organizationId, locationId);

  const incoming =
    Array.isArray(body.lines) && body.lines.length > 0
      ? body.lines.map((line) => {
          const itemId = requireString(line.itemId, "itemId");
          const docLine = rtv.lines.find((row) => row.itemId === itemId);
          if (!docLine) badRequest("Line is not on this vendor return");
          return {
            itemId: docLine.itemId,
            sku: docLine.sku,
            qty: requireInt(line.qty, "qty"),
            lotCode: line.lotCode?.trim() || null,
            serials: parseSerialList(line.serials),
            weightGrams: lineCatchWeight(docLine.catchWeight, docLine.sku, line.weightGrams),
          };
        })
      : rtv.lines
          .map((line) => ({
            itemId: line.itemId,
            sku: line.sku,
            qty: line.remaining,
            lotCode: null as string | null,
            serials: [] as string[],
            weightGrams: lineCatchWeight(line.catchWeight, line.sku, undefined),
          }))
          .filter((line) => line.qty > 0);

  let applied;
  try {
    applied = applyPartialReturn(rtv.lines.map(asRtvLine), incoming);
  } catch (err) {
    if (err instanceof OverReturnError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid vendor return");
  }
  const now = Date.now();
  const nextStatus = isFullyReturned(applied.next) ? "returned" : "returning";
  const qtyByItem = new Map(applied.next.map((line) => [line.itemId, line.qtyReturned]));

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    applied.posted.map((line) => ({ locationId, itemId: line.itemId })),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    applied.posted.map((line) => {
      const extra = incoming.find((row) => row.itemId === line.itemId);
      return (balances: Map<string, number>) =>
        planRtv({
          itemId: line.itemId,
          sku: extra?.sku ?? line.itemId,
          locationId,
          qty: line.qty,
          refId: rtv.id,
          balances,
          lotCode: extra?.lotCode,
          serials: extra?.serials.length ? extra.serials : null,
          weightGrams: extra?.weightGrams,
        });
    }),
  );

  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.vendorReturns)
        .set({
          status: nextStatus,
          locationId,
          returnedAt: nextStatus === "returned" ? now : rtv.returnedAt,
        })
        .where(eq(schema.vendorReturns.id, rtv.id)),
      ...rtv.lines.map((line) =>
        db
          .update(schema.vendorReturnLines)
          .set({ qtyReturned: qtyByItem.get(line.itemId) ?? line.qtyReturned })
          .where(eq(schema.vendorReturnLines.id, line.id)),
      ),
    ],
  });

  const posted = await rtvWithLines(db, organizationId, rtv.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: posted.warehouseId,
    refType: "vendorReturn",
    refId: posted.id,
    status: posted.status,
    number: posted.number,
    title: posted.vendorName,
    fromLocationId: posted.locationId,
    createdAt: posted.createdAt,
  });
  return c.json(posted);
});
