import { and, eq, gte, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { loadOpenAllocations } from "./allocations";
import { persistUnpick } from "./unpick";
import { orderJobInput, syncDocumentJob } from "./jobs";
import { planQuickShipRestore, type QuickShipRestore, type QuickShipSnapshot } from "../domain/quick-ship";

async function loadOrder(db: AppDb, organizationId: string, orderId: string) {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  return order ?? null;
}

async function loadLines(db: AppDb, orderId: string) {
  return db
    .select({
      id: schema.orderLines.id,
      itemId: schema.orderLines.itemId,
      sku: schema.items.sku,
      qty: schema.orderLines.qty,
      qtyPicked: schema.orderLines.qtyPicked,
      qtyPacked: schema.orderLines.qtyPacked,
    })
    .from(schema.orderLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(eq(schema.orderLines.orderId, orderId));
}

export async function snapshotQuickShip(db: AppDb, organizationId: string, orderId: string): Promise<QuickShipSnapshot> {
  const startedAt = Date.now();
  const order = await loadOrder(db, organizationId, orderId);
  if (!order) throw new Error("Order not found");
  const lines = await loadLines(db, orderId);
  const allocations = await loadOpenAllocations(db, organizationId, { orderId });
  return {
    startedAt,
    status: order.status,
    pickedAt: order.pickedAt,
    packedAt: order.packedAt,
    pickLocationId: order.pickLocationId,
    hadLabel: order.labelStatus === "purchased" && Boolean(order.trackingNumber),
    lines: lines.map((line) => ({ id: line.id, qtyPicked: line.qtyPicked, qtyPacked: line.qtyPacked })),
    allocations: allocations.map((row) => ({ id: row.id, qty: row.qty })),
  };
}

/** Reads the order back and plans the undo. The label void goes through the order route, so it is left to the caller. */
export async function planQuickShipUndo(
  db: AppDb,
  organizationId: string,
  orderId: string,
  snapshot: QuickShipSnapshot,
): Promise<QuickShipRestore> {
  const order = await loadOrder(db, organizationId, orderId);
  if (!order) throw new Error("Order not found");
  const lines = await loadLines(db, orderId);
  const allocations = await loadOpenAllocations(db, organizationId, { orderId });
  return planQuickShipRestore(snapshot, {
    status: order.status,
    labelStatus: order.labelStatus,
    trackingNumber: order.trackingNumber,
    lines,
    allocations: allocations.map((row) => ({ id: row.id, qty: row.qty })),
  });
}

/**
 * Puts the units quick-ship picked back in the bays they came from, unpacks what it packed, and resets
 * the order's status and reservations to the snapshot, all in one batch.
 */
export async function restoreQuickShip(
  db: AppDb,
  input: { organizationId: string; userId: string; orderId: string; snapshot: QuickShipSnapshot; plan: QuickShipRestore },
): Promise<void> {
  const { organizationId, orderId, snapshot, plan } = input;
  const order = await loadOrder(db, organizationId, orderId);
  if (!order) throw new Error("Order not found");
  const now = Date.now();
  const statements: BatchItem<"sqlite">[] = [
    ...plan.lines.map((line) =>
      db
        .update(schema.orderLines)
        .set({ qtyPicked: line.qtyPicked, qtyPacked: line.qtyPacked })
        .where(eq(schema.orderLines.id, line.lineId)),
    ),
    db
      .delete(schema.packEvents)
      .where(
        and(
          eq(schema.packEvents.organizationId, organizationId),
          eq(schema.packEvents.orderId, orderId),
          eq(schema.packEvents.userId, input.userId),
          gte(schema.packEvents.createdAt, snapshot.startedAt),
        ),
      ),
    ...(plan.releaseAllocationIds.length > 0
      ? [
          db
            .update(schema.inventoryAllocations)
            .set({ status: "released", qty: 0, releasedAt: now })
            .where(inArray(schema.inventoryAllocations.id, plan.releaseAllocationIds)),
        ]
      : []),
    ...plan.resetAllocations.map((row) =>
      db
        .update(schema.inventoryAllocations)
        .set({ qty: row.qty, status: "open", releasedAt: null })
        .where(eq(schema.inventoryAllocations.id, row.id)),
    ),
    ...(plan.restoreOrder
      ? [
          db
            .update(schema.orders)
            .set({
              status: snapshot.status,
              pickedAt: snapshot.pickedAt,
              packedAt: snapshot.packedAt,
              pickLocationId: snapshot.pickLocationId,
            })
            .where(eq(schema.orders.id, orderId)),
        ]
      : []),
  ];

  if (plan.unpick.length > 0) {
    const packedTo = new Map(plan.lines.map((line) => [line.lineId, line.qtyPacked]));
    const lines = await loadLines(db, orderId);
    await persistUnpick({
      db,
      organizationId,
      createdBy: input.userId,
      warehouseId: order.warehouseId,
      orderId,
      pickLocationId: order.pickLocationId,
      lines: lines.map((line) => ({ ...line, qtyPacked: packedTo.get(line.id) ?? line.qtyPacked })),
      incoming: plan.unpick,
      restoreAllocations: false,
      skipStatusUpdate: true,
      extra: statements,
    });
  } else {
    await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }

  const restored = await loadOrder(db, organizationId, orderId);
  if (restored) await syncDocumentJob(db, orderJobInput(restored));
}
