import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgLocation } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import {
  allocateBatchPick,
  buildBatchLines,
  isBatchFullyPicked,
  OverBatchPickError,
  remainingOnBatchLine,
  waveOrdersComplete,
} from "../domain/waves";
import { remainingToPick } from "../domain/partial-pick";
import { applyPartialPick, OverPickError } from "../domain/partial-pick";
import { canCompleteWave, canPickWave, canReleaseWave } from "../domain/status";
import { chainPlans, planPick } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { consumeAllocationStatements, ensureAllocated } from "../db/allocations";
import { recordLaborEvent } from "../db/labor";

export const wavesRoute = new Hono<AppEnv>();

async function waveDetail(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [wave] = await db
    .select()
    .from(schema.waves)
    .where(and(eq(schema.waves.id, id), eq(schema.waves.organizationId, organizationId)))
    .limit(1);
  if (!wave) notFound("Wave not found");

  const links = await db.select().from(schema.waveOrders).where(eq(schema.waveOrders.waveId, id));
  const orderIds = links.map((row) => row.orderId);
  const orders =
    orderIds.length === 0
      ? []
      : await db
          .select({
            id: schema.orders.id,
            number: schema.orders.number,
            status: schema.orders.status,
            customerName: schema.orders.customerName,
            warehouseId: schema.orders.warehouseId,
            waveId: schema.orders.waveId,
            clientId: schema.orders.clientId,
          })
          .from(schema.orders)
          .where(inArray(schema.orders.id, orderIds));

  const orderLines =
    orderIds.length === 0
      ? []
      : await db
          .select({
            id: schema.orderLines.id,
            orderId: schema.orderLines.orderId,
            itemId: schema.orderLines.itemId,
            qty: schema.orderLines.qty,
            qtyPicked: schema.orderLines.qtyPicked,
            sku: schema.items.sku,
            itemName: schema.items.name,
          })
          .from(schema.orderLines)
          .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
          .where(inArray(schema.orderLines.orderId, orderIds));

  const batchRows = await db
    .select({
      id: schema.waveBatchLines.id,
      itemId: schema.waveBatchLines.itemId,
      qty: schema.waveBatchLines.qty,
      qtyPicked: schema.waveBatchLines.qtyPicked,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.waveBatchLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.waveBatchLines.itemId))
    .where(eq(schema.waveBatchLines.waveId, id));

  return {
    ...wave,
    orders,
    orderLines: orderLines.map((line) => ({
      ...line,
      remaining: remainingToPick({ lineId: line.id, qtyOrdered: line.qty, qtyPicked: line.qtyPicked }),
    })),
    batchLines: batchRows.map((line) => ({
      ...line,
      remaining: remainingOnBatchLine(line),
    })),
  };
}

wavesRoute.get("/waves", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.waves)
    .where(eq(schema.waves.organizationId, organizationId))
    .orderBy(desc(schema.waves.createdAt));
  if (rows.length === 0) return c.json([]);
  const links = await db
    .select()
    .from(schema.waveOrders)
    .where(
      inArray(
        schema.waveOrders.waveId,
        rows.map((row) => row.id),
      ),
    );
  const countByWave = new Map<string, number>();
  for (const link of links) {
    countByWave.set(link.waveId, (countByWave.get(link.waveId) ?? 0) + 1);
  }
  return c.json(rows.map((row) => ({ ...row, orderCount: countByWave.get(row.id) ?? 0 })));
});

wavesRoute.get("/waves/:id", async (c) => {
  return c.json(await waveDetail(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

wavesRoute.post("/waves", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    mode?: string;
    zoneId?: string;
    clientId?: string;
    notes?: string;
    orderIds?: string[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const mode = body.mode === "batch" ? "batch" : "wave";
  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    badRequest("At least one order is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const orders = await db
    .select()
    .from(schema.orders)
    .where(
      and(eq(schema.orders.organizationId, organizationId), inArray(schema.orders.id, body.orderIds)),
    );
  if (orders.length !== body.orderIds.length) badRequest("One or more orders were not found");
  for (const order of orders) {
    if (order.warehouseId !== warehouseId) badRequest(`Order ${order.number} is in another warehouse`);
    if (order.waveId) conflict(`Order ${order.number} is already on a wave`);
    if (order.status !== "open" && order.status !== "draft") {
      conflict(`Order ${order.number} must be open to join a wave`);
    }
    if (body.clientId && order.clientId && order.clientId !== body.clientId) {
      conflict(`Order ${order.number} belongs to another client`);
    }
  }

  if (body.zoneId) {
    const [zone] = await db
      .select()
      .from(schema.zones)
      .where(and(eq(schema.zones.id, body.zoneId), eq(schema.zones.organizationId, organizationId)))
      .limit(1);
    if (!zone) badRequest("Zone not found");
  }

  const id = newId();
  const now = Date.now();
  await db.batch([
    db.insert(schema.waves).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("WAV"),
      status: "draft",
      mode,
      zoneId: body.zoneId || null,
      clientId: body.clientId || null,
      notes: body.notes?.trim() || null,
      createdAt: now,
    }),
    ...orders.map((order) =>
      db.insert(schema.waveOrders).values({ id: newId(), waveId: id, orderId: order.id }),
    ),
    ...orders.map((order) =>
      db.update(schema.orders).set({ waveId: id }).where(eq(schema.orders.id, order.id)),
    ),
  ]);

  return c.json(await waveDetail(db, organizationId, id), 201);
});

wavesRoute.post("/waves/:id/release", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const wave = await waveDetail(db, organizationId, c.req.param("id"));
  if (!canReleaseWave(wave.status)) conflict("Wave is not a draft");

  const batchPlans =
    wave.mode === "batch"
      ? buildBatchLines(
          wave.orderLines.map((line) => ({
            orderId: line.orderId,
            orderLineId: line.id,
            itemId: line.itemId,
            sku: line.sku,
            remaining: line.remaining,
          })),
        )
      : [];

  const now = Date.now();
  await db.batch([
    db
      .update(schema.waves)
      .set({ status: "released", releasedAt: now })
      .where(eq(schema.waves.id, wave.id)),
    ...batchPlans.map((plan) =>
      db.insert(schema.waveBatchLines).values({
        id: newId(),
        waveId: wave.id,
        itemId: plan.itemId,
        qty: plan.qty,
        qtyPicked: 0,
      }),
    ),
  ]);

  return c.json(await waveDetail(db, organizationId, wave.id));
});

wavesRoute.post("/waves/:id/batch-pick", async (c) => {
  const body = await c.req.json<{ locationId?: string; itemId?: string; qty?: number }>();
  const locationId = requireString(body.locationId, "locationId");
  const itemId = requireString(body.itemId, "itemId");
  const qty = requireInt(body.qty, "qty");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const wave = await waveDetail(db, organizationId, c.req.param("id"));
  if (wave.mode !== "batch") conflict("Wave is not in batch mode");
  if (!canPickWave(wave.status)) conflict("Wave is not released for picking");
  await getOrgLocation(db, organizationId, locationId);

  const batchLine = wave.batchLines.find((line) => line.itemId === itemId);
  if (!batchLine) badRequest("SKU is not on this wave batch");
  if (qty > batchLine.remaining) {
    throw new OverBatchPickError(batchLine.sku, batchLine.remaining, qty);
  }

  let allocations;
  try {
    allocations = allocateBatchPick(
      wave.orderLines.map((line) => ({
        orderId: line.orderId,
        orderLineId: line.id,
        itemId: line.itemId,
        sku: line.sku,
        remaining: line.remaining,
      })),
      itemId,
      qty,
    );
  } catch (err) {
    if (err instanceof OverBatchPickError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid batch pick");
  }

  const byOrder = new Map<string, typeof allocations>();
  for (const row of allocations) {
    const list = byOrder.get(row.orderId) ?? [];
    list.push(row);
    byOrder.set(row.orderId, list);
  }

  const now = Date.now();
  let totalQty = 0;

  for (const [orderId, rows] of byOrder) {
    const order = wave.orders.find((row) => row.id === orderId);
    if (!order) continue;
    const orderLines = wave.orderLines.filter((line) => line.orderId === orderId);
    const openAllocations = await ensureAllocated(db, {
      organizationId,
      warehouseId: wave.warehouseId,
      orderId,
      lines: orderLines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        sku: line.sku,
        remaining: line.remaining,
      })),
    });

    let applied;
    try {
      applied = applyPartialPick(
        orderLines.map((line) => ({
          lineId: line.id,
          sku: line.sku,
          qtyOrdered: line.qty,
          qtyPicked: line.qtyPicked,
        })),
        rows.map((row) => ({ lineId: row.orderLineId, qty: row.qty })),
      );
    } catch (err) {
      if (err instanceof OverPickError) throw err;
      badRequest(err instanceof Error ? err.message : "Invalid pick");
    }

    const pickLines = applied.posted.map((row) => {
      const line = orderLines.find((item) => item.id === row.lineId)!;
      return { lineId: line.id, itemId: line.itemId, sku: line.sku, qty: row.qty };
    });
    totalQty += pickLines.reduce((sum, row) => sum + row.qty, 0);

    const loaded = await loadBalanceMap(
      db,
      organizationId,
      pickLines.map((line) => ({ locationId, itemId: line.itemId })),
    );
    const plan = chainPlans(
      qtyMap(loaded),
      pickLines.map(
        (line) => (balances) =>
          planPick({
            itemId: line.itemId,
            sku: line.sku,
            locationId,
            qty: line.qty,
            refId: orderId,
            balances,
          }),
      ),
    );
    const fully = applied.next.every((line) => remainingToPick(line) <= 0);
    const qtyPickedByLine = new Map(applied.next.map((line) => [line.lineId, line.qtyPicked]));
    const consumeExtras = pickLines.flatMap((line) =>
      consumeAllocationStatements(db, openAllocations, line.lineId, locationId, line.qty, now),
    );

    await persistStockPlan(db, {
      organizationId,
      createdBy: user.id,
      now,
      loaded,
      plan,
      extra: [
        ...orderLines.map((line) =>
          db
            .update(schema.orderLines)
            .set({ qtyPicked: qtyPickedByLine.get(line.id) ?? line.qtyPicked })
            .where(eq(schema.orderLines.id, line.id)),
        ),
        db
          .update(schema.orders)
          .set({
            status: fully ? "picked" : "picking",
            pickLocationId: locationId,
            pickedAt: fully ? now : null,
          })
          .where(eq(schema.orders.id, orderId)),
        ...consumeExtras,
      ],
    });
  }

  const nextPicked = batchLine.qtyPicked + qty;
  await db
    .update(schema.waveBatchLines)
    .set({ qtyPicked: nextPicked })
    .where(eq(schema.waveBatchLines.id, batchLine.id));

  const refreshed = await waveDetail(db, organizationId, wave.id);
  const batchDone = isBatchFullyPicked(refreshed.batchLines);
  const ordersDone = waveOrdersComplete(refreshed.orders);
  const nextStatus = ordersDone || batchDone ? "completed" : "picking";
  await db
    .update(schema.waves)
    .set({
      status: nextStatus,
      completedAt: nextStatus === "completed" ? now : refreshed.completedAt,
    })
    .where(eq(schema.waves.id, wave.id));

  await recordLaborEvent(db, {
    organizationId,
    warehouseId: wave.warehouseId,
    userId: user.id,
    verb: "batch_pick",
    refType: "wave",
    refId: wave.id,
    qty: totalQty,
    now,
  });

  return c.json(await waveDetail(db, organizationId, wave.id));
});

wavesRoute.post("/waves/:id/complete", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const wave = await waveDetail(db, organizationId, c.req.param("id"));
  if (!canCompleteWave(wave.status)) conflict("Wave cannot be completed");
  if (!waveOrdersComplete(wave.orders) && wave.mode === "wave") {
    conflict("All orders on the wave must be picked before complete");
  }
  if (wave.mode === "batch" && !isBatchFullyPicked(wave.batchLines) && !waveOrdersComplete(wave.orders)) {
    conflict("Batch lines still have remaining qty");
  }
  await db
    .update(schema.waves)
    .set({ status: "completed", completedAt: Date.now() })
    .where(eq(schema.waves.id, wave.id));
  return c.json(await waveDetail(db, organizationId, wave.id));
});

wavesRoute.get("/waves-open-orders", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId");
  const rows = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      customerName: schema.orders.customerName,
      status: schema.orders.status,
      warehouseId: schema.orders.warehouseId,
      waveId: schema.orders.waveId,
      clientId: schema.orders.clientId,
      createdAt: schema.orders.createdAt,
    })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        warehouseId ? eq(schema.orders.warehouseId, warehouseId) : undefined,
      ),
    )
    .orderBy(desc(schema.orders.createdAt));
  return c.json(rows.filter((row) => !row.waveId && (row.status === "open" || row.status === "draft")));
});
