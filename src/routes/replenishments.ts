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
    .where(and(eq(schema.replenishments.id, id), eq(schema.replenishments.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Replenishment not found");
  return row;
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
  return c.json(rows);
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
      fromLocationId,
      toLocationId,
      notes: body.notes?.trim() || null,
      createdAt: Date.now(),
    })
    .returning();

  return c.json(await replenishmentWithItem(db, organizationId, row.id), 201);
});

replenishmentsRoute.post("/replenishments/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const doc = await replenishmentWithItem(db, organizationId, c.req.param("id"));
  if (doc.status !== "draft") conflict("Replenishment is not a draft");
  await db.update(schema.replenishments).set({ status: "in_progress" }).where(eq(schema.replenishments.id, doc.id));
  return c.json(await replenishmentWithItem(db, organizationId, doc.id));
});

replenishmentsRoute.post("/replenishments/:id/post", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const doc = await replenishmentWithItem(db, organizationId, c.req.param("id"));
  if (!canPostReplenishment(doc.status)) conflict("Replenishment already posted");

  const loaded = await loadBalanceMap(db, organizationId, [
    { locationId: doc.fromLocationId, itemId: doc.itemId },
    { locationId: doc.toLocationId, itemId: doc.itemId },
  ]);
  const plan = planMove({
    itemId: doc.itemId,
    sku: doc.sku,
    fromLocationId: doc.fromLocationId,
    toLocationId: doc.toLocationId,
    qty: doc.qty,
    refId: doc.id,
    balances: qtyMap(loaded),
    refType: "replenishment",
  });
  const now = Date.now();
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.replenishments)
        .set({ status: "posted", postedAt: now })
        .where(eq(schema.replenishments.id, doc.id)),
    ],
  });
  return c.json(await replenishmentWithItem(db, organizationId, doc.id));
});
