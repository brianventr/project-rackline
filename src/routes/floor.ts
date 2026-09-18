import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { chainPlans, planCycleCount, planMove } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";

export const floorRoute = new Hono<AppEnv>();

async function transferWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.transfers)
    .where(and(eq(schema.transfers.id, id), eq(schema.transfers.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Transfer not found");
  const lines = await db
    .select({
      id: schema.transferLines.id,
      itemId: schema.transferLines.itemId,
      qty: schema.transferLines.qty,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.transferLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.transferLines.itemId))
    .where(eq(schema.transferLines.transferId, id));
  return { ...row, lines };
}

floorRoute.get("/transfers", async (c) => {
  const db = c.get("db");
  const fromLoc = alias(schema.locations, "from_loc");
  const toLoc = alias(schema.locations, "to_loc");
  const rows = await db
    .select({
      id: schema.transfers.id,
      number: schema.transfers.number,
      status: schema.transfers.status,
      fromLocationId: schema.transfers.fromLocationId,
      toLocationId: schema.transfers.toLocationId,
      notes: schema.transfers.notes,
      createdAt: schema.transfers.createdAt,
      fromCode: fromLoc.code,
      toCode: toLoc.code,
    })
    .from(schema.transfers)
    .innerJoin(fromLoc, eq(fromLoc.id, schema.transfers.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, schema.transfers.toLocationId))
    .where(eq(schema.transfers.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.transfers.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.transferLines.id,
      transferId: schema.transferLines.transferId,
      itemId: schema.transferLines.itemId,
      qty: schema.transferLines.qty,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.transferLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.transferLines.itemId))
    .where(
      inArray(
        schema.transferLines.transferId,
        rows.map((row) => row.id),
      ),
    );
  const byTransfer = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byTransfer.get(line.transferId) ?? [];
    list.push(line);
    byTransfer.set(line.transferId, list);
  }
  return c.json(rows.map((row) => ({ ...row, lines: byTransfer.get(row.id) ?? [] })));
});

floorRoute.get("/transfers/:id", async (c) => {
  return c.json(await transferWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

floorRoute.post("/transfers", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    notes?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const fromLocationId = requireString(body.fromLocationId, "fromLocationId");
  const toLocationId = requireString(body.toLocationId, "toLocationId");
  if (fromLocationId === toLocationId) badRequest("From and to locations must differ");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one transfer line is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgLocation(db, organizationId, fromLocationId);
  await getOrgLocation(db, organizationId, toLocationId);

  const id = newId();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), transferId: id, itemId, qty });
  }

  await db.batch([
    db.insert(schema.transfers).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("XFR"),
      status: "draft",
      fromLocationId,
      toLocationId,
      notes: body.notes?.trim() || null,
      createdAt: Date.now(),
    }),
    ...lines.map((line) => db.insert(schema.transferLines).values(line)),
  ]);

  return c.json(await transferWithLines(db, organizationId, id), 201);
});

floorRoute.post("/transfers/:id/post", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const transfer = await transferWithLines(db, organizationId, c.req.param("id"));
  if (transfer.status !== "draft") conflict("Transfer already posted");

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    transfer.lines.flatMap((line) => [
      { locationId: transfer.fromLocationId, itemId: line.itemId },
      { locationId: transfer.toLocationId, itemId: line.itemId },
    ]),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    transfer.lines.map((line) => (balances) =>
      planMove({
        itemId: line.itemId,
        sku: line.sku,
        fromLocationId: transfer.fromLocationId,
        toLocationId: transfer.toLocationId,
        qty: line.qty,
        refId: transfer.id,
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
        .update(schema.transfers)
        .set({ status: "posted", postedAt: now })
        .where(eq(schema.transfers.id, transfer.id)),
    ],
  });

  return c.json(await transferWithLines(db, organizationId, transfer.id));
});

async function countWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.cycleCounts)
    .where(and(eq(schema.cycleCounts.id, id), eq(schema.cycleCounts.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Cycle count not found");
  const lines = await db
    .select({
      id: schema.cycleCountLines.id,
      itemId: schema.cycleCountLines.itemId,
      systemQty: schema.cycleCountLines.systemQty,
      countedQty: schema.cycleCountLines.countedQty,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.cycleCountLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.cycleCountLines.itemId))
    .where(eq(schema.cycleCountLines.cycleCountId, id));
  return { ...row, lines };
}

floorRoute.get("/cycle-counts", async (c) => {
  const rows = await c
    .get("db")
    .select({
      id: schema.cycleCounts.id,
      number: schema.cycleCounts.number,
      status: schema.cycleCounts.status,
      locationId: schema.cycleCounts.locationId,
      notes: schema.cycleCounts.notes,
      createdAt: schema.cycleCounts.createdAt,
      locationCode: schema.locations.code,
    })
    .from(schema.cycleCounts)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.cycleCounts.locationId))
    .where(eq(schema.cycleCounts.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.cycleCounts.createdAt));
  return c.json(rows);
});

floorRoute.get("/cycle-counts/:id", async (c) => {
  return c.json(await countWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

floorRoute.post("/cycle-counts", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    locationId?: string;
    notes?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgLocation(db, organizationId, locationId);

  const onHand = await db
    .select({
      itemId: schema.inventoryBalances.itemId,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        eq(schema.inventoryBalances.locationId, locationId),
      ),
    );

  if (onHand.length === 0) badRequest("That location has no on-hand rows to count");

  const id = newId();
  const lines = onHand.map((row) => ({
    id: newId(),
    cycleCountId: id,
    itemId: row.itemId,
    systemQty: row.qty,
    countedQty: row.qty,
  }));

  await db.batch([
    db.insert(schema.cycleCounts).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("CC"),
      status: "draft",
      locationId,
      notes: body.notes?.trim() || null,
      createdAt: Date.now(),
    }),
    ...lines.map((line) => db.insert(schema.cycleCountLines).values(line)),
  ]);

  return c.json(await countWithLines(db, organizationId, id), 201);
});

floorRoute.post("/cycle-counts/:id/post", async (c) => {
  const body = await c.req.json<{ lines?: { id?: string; countedQty?: number }[] }>().catch(() => ({
    lines: [] as { id?: string; countedQty?: number }[],
  }));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const count = await countWithLines(db, organizationId, c.req.param("id"));
  if (count.status !== "draft") conflict("Cycle count already posted");

  const countedById = new Map<string, number>();
  for (const line of body.lines ?? []) {
    if (!line.id) continue;
    countedById.set(line.id, requireInt(line.countedQty, "countedQty"));
  }

  const resolved = count.lines.map((line) => ({
    ...line,
    countedQty: countedById.has(line.id) ? countedById.get(line.id)! : line.countedQty,
  }));

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    resolved.map((line) => ({ locationId: count.locationId, itemId: line.itemId })),
  );
  const current = qtyMap(loaded);
  const plan = planCycleCount({
    refId: count.id,
    locationId: count.locationId,
    balances: current,
    lines: resolved.map((line) => ({
      itemId: line.itemId,
      sku: line.sku,
      systemQty: current.get(`${count.locationId}:${line.itemId}`) ?? 0,
      countedQty: line.countedQty,
    })),
  });

  const now = Date.now();
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      ...resolved.map((line) =>
        db
          .update(schema.cycleCountLines)
          .set({ countedQty: line.countedQty })
          .where(eq(schema.cycleCountLines.id, line.id)),
      ),
      db
        .update(schema.cycleCounts)
        .set({ status: "posted", postedAt: now })
        .where(eq(schema.cycleCounts.id, count.id)),
    ],
  });

  return c.json(await countWithLines(db, organizationId, count.id));
});
