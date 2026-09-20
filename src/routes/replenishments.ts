import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { planMove } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { suggestReplenishments } from "../domain/replenishment";
import { canPostReplenishment } from "../domain/status";
import { matchingHoldForMove } from "../domain/holds";
import { loadOpenHolds } from "../db/holds";
import { atpOnHand } from "../db/allocations";
import { applyPartialReplenish, isFullyReplenished, remainingToReplenish } from "../domain/partial-replenish";
import { OverMoveError } from "../domain/partial-transfer";
import { parseSerialList } from "../domain/lots";
import { guardFloorJob, syncDocumentJob } from "../db/jobs";

export const replenishmentsRoute = new Hono<AppEnv>();

async function replenishmentWithItem(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const fromLoc = alias(schema.locations, "from_loc");
  const toLoc = alias(schema.locations, "to_loc");
  const [row] = await db
    .select({
      id: schema.replenishments.id,
      organizationId: schema.replenishments.organizationId,
      warehouseId: schema.replenishments.warehouseId,
      number: schema.replenishments.number,
      status: schema.replenishments.status,
      itemId: schema.replenishments.itemId,
      qty: schema.replenishments.qty,
      qtyMoved: schema.replenishments.qtyMoved,
      fromLocationId: schema.replenishments.fromLocationId,
      toLocationId: schema.replenishments.toLocationId,
      notes: schema.replenishments.notes,
      createdAt: schema.replenishments.createdAt,
      postedAt: schema.replenishments.postedAt,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      fromCode: fromLoc.code,
      toCode: toLoc.code,
    })
    .from(schema.replenishments)
    .innerJoin(schema.items, eq(schema.items.id, schema.replenishments.itemId))
    .innerJoin(fromLoc, eq(fromLoc.id, schema.replenishments.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, schema.replenishments.toLocationId))
    .where(and(eq(schema.replenishments.id, id), eq(schema.replenishments.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Replenishment not found");
  return withReplenishRemaining(row);
}

function withReplenishRemaining<T extends { qty: number; qtyMoved: number }>(row: T) {
  return {
    ...row,
    remaining: remainingToReplenish(row.qty, row.qtyMoved),
  };
}

replenishmentsRoute.get("/replenishments/suggestions", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId") || undefined;

  const [locations, onHand, items] = await Promise.all([
    db
      .select({
        id: schema.locations.id,
        code: schema.locations.code,
        warehouseId: schema.locations.warehouseId,
        slotRole: schema.locations.slotRole,
        aisle: schema.locations.aisle,
        rack: schema.locations.rack,
      })
      .from(schema.locations)
      .where(
        and(
          eq(schema.locations.organizationId, organizationId),
          warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
        ),
      ),
    db
      .select({
        locationId: schema.inventoryBalances.locationId,
        itemId: schema.inventoryBalances.itemId,
        qty: schema.inventoryBalances.qty,
      })
      .from(schema.inventoryBalances)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
      .where(
        and(
          eq(schema.inventoryBalances.organizationId, organizationId),
          warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
        ),
      ),
    db
      .select({
        id: schema.items.id,
        sku: schema.items.sku,
        name: schema.items.name,
        pickMin: schema.items.pickMin,
      })
      .from(schema.items)
      .where(eq(schema.items.organizationId, organizationId)),
  ]);

  const holds = await loadOpenHolds(db, organizationId, warehouseId);
  const available = await atpOnHand(db, organizationId, onHand, { warehouseId });
  return c.json(
    suggestReplenishments({ locations, onHand: available, items }).filter(
      (job) =>
        !matchingHoldForMove(holds, job.fromLocationId, job.itemId) &&
        !matchingHoldForMove(holds, job.toLocationId, job.itemId),
    ),
  );
});

replenishmentsRoute.get("/replenishments", async (c) => {
  const db = c.get("db");
  const fromLoc = alias(schema.locations, "from_loc");
  const toLoc = alias(schema.locations, "to_loc");
  const rows = await db
    .select({
      id: schema.replenishments.id,
      warehouseId: schema.replenishments.warehouseId,
      number: schema.replenishments.number,
      status: schema.replenishments.status,
      itemId: schema.replenishments.itemId,
      qty: schema.replenishments.qty,
      qtyMoved: schema.replenishments.qtyMoved,
      fromLocationId: schema.replenishments.fromLocationId,
      toLocationId: schema.replenishments.toLocationId,
      notes: schema.replenishments.notes,
      createdAt: schema.replenishments.createdAt,
      postedAt: schema.replenishments.postedAt,
      sku: schema.items.sku,
      itemName: schema.items.name,
      fromCode: fromLoc.code,
      toCode: toLoc.code,
    })
    .from(schema.replenishments)
    .innerJoin(schema.items, eq(schema.items.id, schema.replenishments.itemId))
    .innerJoin(fromLoc, eq(fromLoc.id, schema.replenishments.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, schema.replenishments.toLocationId))
    .where(eq(schema.replenishments.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.replenishments.createdAt));
  return c.json(rows.map(withReplenishRemaining));
});

replenishmentsRoute.get("/replenishments/:id", async (c) => {
  return c.json(await replenishmentWithItem(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

replenishmentsRoute.post("/replenishments", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    itemId?: string;
    qty?: number;
    fromLocationId?: string;
    toLocationId?: string;
    notes?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const itemId = requireString(body.itemId, "itemId");
  const qty = requireInt(body.qty, "qty");
  const fromLocationId = requireString(body.fromLocationId, "fromLocationId");
  const toLocationId = requireString(body.toLocationId, "toLocationId");
  if (qty <= 0) badRequest("Quantity must be positive");
  if (fromLocationId === toLocationId) badRequest("From and to locations must differ");

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgItem(db, organizationId, itemId);
  const from = await getOrgLocation(db, organizationId, fromLocationId);
  const to = await getOrgLocation(db, organizationId, toLocationId);
  if (from.warehouseId !== warehouseId || to.warehouseId !== warehouseId) {
    badRequest("Locations must be in the selected warehouse");
  }

  const [row] = await db
    .insert(schema.replenishments)
    .values({
      id: newId(),
      organizationId,
      warehouseId,
      number: docNumber("RPL"),
      status: "draft",
      itemId,
      qty,
      qtyMoved: 0,
      fromLocationId,
      toLocationId,
      notes: body.notes?.trim() || null,
      createdAt: Date.now(),
    })
    .returning();

  const created = await replenishmentWithItem(db, organizationId, row.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: created.warehouseId,
    refType: "replenishment",
    refId: created.id,
    status: created.status,
    number: created.number,
    title: created.notes,
    fromLocationId: created.fromLocationId,
    toLocationId: created.toLocationId,
    itemId: created.itemId,
    qty: created.qty,
    createdAt: created.createdAt,
  });
  return c.json(created, 201);
});

replenishmentsRoute.post("/replenishments/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const doc = await replenishmentWithItem(db, organizationId, c.req.param("id"));
  if (doc.status !== "draft") conflict("Replenishment is not a draft");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: doc.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "replenishment",
    refId: doc.id,
    verb: "replenish",
    number: doc.number,
    title: doc.notes,
    fromLocationId: doc.fromLocationId,
    toLocationId: doc.toLocationId,
    itemId: doc.itemId,
    qty: doc.qty,
    createdAt: doc.createdAt,
  });
  await db.update(schema.replenishments).set({ status: "in_progress" }).where(eq(schema.replenishments.id, doc.id));
  const started = await replenishmentWithItem(db, organizationId, doc.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: started.warehouseId,
    refType: "replenishment",
    refId: started.id,
    status: started.status,
    number: started.number,
    title: started.notes,
    fromLocationId: started.fromLocationId,
    toLocationId: started.toLocationId,
    itemId: started.itemId,
    qty: started.qty - (started.qtyMoved ?? 0),
    createdAt: started.createdAt,
  });
  return c.json(started);
});

replenishmentsRoute.post("/replenishments/:id/post", async (c) => {
  const body = await c.req
    .json<{ qty?: number; lotCode?: string; serials?: string | string[] }>()
    .catch(() => ({}) as { qty?: number; lotCode?: string; serials?: string | string[] });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const doc = await replenishmentWithItem(db, organizationId, c.req.param("id"));
  if (!canPostReplenishment(doc.status)) conflict("Replenishment already posted");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: doc.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "replenishment",
    refId: doc.id,
    verb: "replenish",
    number: doc.number,
    title: doc.notes,
    fromLocationId: doc.fromLocationId,
    toLocationId: doc.toLocationId,
    itemId: doc.itemId,
    createdAt: doc.createdAt,
  });
  if (remainingToReplenish(doc.qty, doc.qtyMoved) <= 0) conflict("Replenishment has nothing remaining");

  const thisQty = body.qty === undefined || body.qty === null ? remainingToReplenish(doc.qty, doc.qtyMoved) : requireInt(body.qty, "qty");
  let applied;
  try {
    applied = applyPartialReplenish({ sku: doc.sku, qty: doc.qty, qtyMoved: doc.qtyMoved }, thisQty);
  } catch (err) {
    if (err instanceof OverMoveError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid replenish qty");
  }

  const loaded = await loadBalanceMap(db, organizationId, [
    { locationId: doc.fromLocationId, itemId: doc.itemId },
    { locationId: doc.toLocationId, itemId: doc.itemId },
  ]);
  const serials = parseSerialList(body.serials);
  const plan = planMove({
    itemId: doc.itemId,
    sku: doc.sku,
    fromLocationId: doc.fromLocationId,
    toLocationId: doc.toLocationId,
    qty: applied.postedQty,
    refId: doc.id,
    balances: qtyMap(loaded),
    refType: "replenishment",
    lotCode: body.lotCode?.trim() || null,
    serials: serials.length ? serials : null,
  });
  const now = Date.now();
  const fully = isFullyReplenished(doc.qty, applied.qtyMoved);
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.replenishments)
        .set({
          status: fully ? "posted" : "in_progress",
          qtyMoved: applied.qtyMoved,
          postedAt: fully ? now : doc.postedAt,
        })
        .where(eq(schema.replenishments.id, doc.id)),
    ],
  });
  const posted = await replenishmentWithItem(db, organizationId, doc.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: posted.warehouseId,
    refType: "replenishment",
    refId: posted.id,
    status: posted.status,
    number: posted.number,
    title: posted.notes,
    fromLocationId: posted.fromLocationId,
    toLocationId: posted.toLocationId,
    itemId: posted.itemId,
    qty: posted.qty - (posted.qtyMoved ?? 0),
    createdAt: posted.createdAt,
  });
  return c.json(posted);
});
