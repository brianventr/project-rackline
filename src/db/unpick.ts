import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { chainPlans, planUnpick } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "./stock";
import { loadOpenAllocations, releaseAllocationStatements, restoreAllocationStatements } from "./allocations";
import {
  applyPartialUnpick,
  hasUnpickable,
  netPickSlices,
  remainingToUnpick,
  takeFromSlices,
  type PickSlice,
  type UnpickLine,
} from "../domain/partial-unpick";
import { canCancelOrder } from "../domain/status";
import { isFullyPicked } from "../domain/partial-pick";
import { isFullyPacked } from "../domain/partial-pack";

function parseSerialsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((row) => String(row)) : [];
  } catch {
    return [];
  }
}

function asUnpickLine(line: { id: string; sku: string; qtyPicked: number; qtyPacked: number }): UnpickLine {
  return {
    lineId: line.id,
    sku: line.sku,
    qtyPicked: line.qtyPicked,
    qtyPacked: line.qtyPacked,
  };
}

export async function loadNetPickSlices(db: AppDb, organizationId: string, orderId: string): Promise<PickSlice[]> {
  const rows = await db
    .select({
      type: schema.inventoryMovements.type,
      itemId: schema.inventoryMovements.itemId,
      qty: schema.inventoryMovements.qty,
      fromLocationId: schema.inventoryMovements.fromLocationId,
      toLocationId: schema.inventoryMovements.toLocationId,
      lotCode: schema.inventoryMovements.lotCode,
      serialsJson: schema.inventoryMovements.serialsJson,
      weightGrams: schema.inventoryMovements.weightGrams,
    })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        eq(schema.inventoryMovements.refId, orderId),
        inArray(schema.inventoryMovements.type, ["pick", "unpick"]),
      ),
    );
  const picks: PickSlice[] = [];
  const unpicks: PickSlice[] = [];
  for (const row of rows) {
    const slice: PickSlice = {
      itemId: row.itemId,
      locationId: (row.type === "unpick" ? row.toLocationId : row.fromLocationId) ?? "",
      qty: row.qty,
      lotCode: row.lotCode,
      serials: parseSerialsJson(row.serialsJson),
      weightGrams: row.weightGrams,
    };
    if (!slice.locationId) continue;
    if (row.type === "pick") picks.push(slice);
    else unpicks.push(slice);
  }
  return netPickSlices(picks, unpicks);
}

function statusAfterUnpick(lines: { qty: number; qtyPicked: number; qtyPacked: number; sku: string; id: string }[]): string {
  const pickLines = lines.map((line) => ({
    lineId: line.id,
    sku: line.sku,
    qtyOrdered: line.qty,
    qtyPicked: line.qtyPicked,
  }));
  const packLines = lines.map((line) => ({
    lineId: line.id,
    sku: line.sku,
    qtyPicked: line.qtyPicked,
    qtyPacked: line.qtyPacked,
  }));
  if (packLines.some((line) => line.qtyPacked > 0)) {
    return isFullyPacked(packLines) ? "packed" : "packing";
  }
  if (isFullyPicked(pickLines)) return "picked";
  return "picking";
}

export async function persistUnpick(input: {
  db: AppDb;
  organizationId: string;
  createdBy: string;
  warehouseId: string;
  orderId: string;
  pickLocationId: string | null;
  lines: { id: string; itemId: string; sku: string; qty: number; qtyPicked: number; qtyPacked: number }[];
  incoming: { lineId: string; qty: number }[];
  includePacked?: boolean;
  locationId?: string | null;
  restoreAllocations?: boolean;
  skipStatusUpdate?: boolean;
  extra?: BatchItem<"sqlite">[];
}): Promise<{ qtyPickedByLine: Map<string, number>; qtyPackedByLine: Map<string, number>; status: string }> {
  const includePacked = input.includePacked === true;
  const applied = applyPartialUnpick(input.lines.map(asUnpickLine), input.incoming, includePacked);
  const postedByLine = new Map(applied.posted.map((row) => [row.lineId, row.qty]));
  const skuByItem = new Map(input.lines.map((line) => [line.itemId, line.sku]));
  let slices = await loadNetPickSlices(input.db, input.organizationId, input.orderId);
  const taken: PickSlice[] = [];
  for (const line of input.lines) {
    const qty = postedByLine.get(line.id) ?? 0;
    if (qty <= 0) continue;
    const next = takeFromSlices(slices, line.itemId, qty);
    taken.push(
      ...next.taken.map((slice) => ({
        ...slice,
        locationId: input.locationId || slice.locationId,
      })),
    );
    slices = next.rest;
  }

  const pairs = taken.map((slice) => ({ locationId: slice.locationId, itemId: slice.itemId }));
  const loaded = await loadBalanceMap(input.db, input.organizationId, pairs);
  const plan = chainPlans(
    qtyMap(loaded),
    taken.map(
      (slice) => (balances) =>
        planUnpick({
          itemId: slice.itemId,
          sku: skuByItem.get(slice.itemId) ?? slice.itemId,
          locationId: slice.locationId,
          qty: slice.qty,
          refId: input.orderId,
          balances,
          lotCode: slice.lotCode,
          serials: slice.serials.length ? slice.serials : null,
          weightGrams: slice.weightGrams,
        }),
    ),
  );

  const now = Date.now();
  const nextLines = input.lines.map((line) => {
    const updated = applied.next.find((row) => row.lineId === line.id);
    return {
      ...line,
      qtyPicked: updated?.qtyPicked ?? line.qtyPicked,
      qtyPacked: updated?.qtyPacked ?? line.qtyPacked,
    };
  });
  const nextStatus = statusAfterUnpick(nextLines);
  const allocations = input.restoreAllocations
    ? await loadOpenAllocations(input.db, input.organizationId, { orderId: input.orderId })
    : [];
  const restoreExtras = input.restoreAllocations
    ? input.lines.flatMap((line) => {
        const qty = postedByLine.get(line.id) ?? 0;
        if (qty <= 0) return [];
        const locationId =
          input.locationId || taken.find((slice) => slice.itemId === line.itemId)?.locationId || input.pickLocationId;
        if (!locationId) return [];
        return restoreAllocationStatements(input.db, {
          organizationId: input.organizationId,
          warehouseId: input.warehouseId,
          orderId: input.orderId,
          allocations,
          orderLineId: line.id,
          locationId,
          itemId: line.itemId,
          qty,
          now,
        });
      })
    : [];

  await persistStockPlan(input.db, {
    organizationId: input.organizationId,
    createdBy: input.createdBy,
    now,
    loaded,
    plan,
    extra: [
      ...nextLines.map((line) =>
        input.db
          .update(schema.orderLines)
          .set({ qtyPicked: line.qtyPicked, qtyPacked: line.qtyPacked })
          .where(eq(schema.orderLines.id, line.id)),
      ),
      ...(input.skipStatusUpdate
        ? []
        : [
            input.db
              .update(schema.orders)
              .set({
                status: nextStatus,
                pickedAt: isFullyPicked(
                  nextLines.map((line) => ({
                    lineId: line.id,
                    sku: line.sku,
                    qtyOrdered: line.qty,
                    qtyPicked: line.qtyPicked,
                  })),
                )
                  ? now
                  : null,
                packedAt: nextLines.some((line) => line.qtyPacked > 0) ? now : null,
              })
              .where(eq(schema.orders.id, input.orderId)),
          ]),
      ...restoreExtras,
      ...(input.extra ?? []),
    ],
  });

  return {
    qtyPickedByLine: new Map(nextLines.map((line) => [line.id, line.qtyPicked])),
    qtyPackedByLine: new Map(nextLines.map((line) => [line.id, line.qtyPacked])),
    status: nextStatus,
  };
}

export async function cancelOrderDocument(
  db: AppDb,
  input: { organizationId: string; orderId: string; createdBy: string },
): Promise<boolean> {
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, input.orderId), eq(schema.orders.organizationId, input.organizationId)))
    .limit(1);
  if (!order || !canCancelOrder(order.status)) return false;

  const lines = await db
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
    .where(eq(schema.orderLines.orderId, order.id));

  const now = Date.now();
  const incoming = lines
    .filter((line) => remainingToUnpick(asUnpickLine(line), true) > 0)
    .map((line) => ({ lineId: line.id, qty: remainingToUnpick(asUnpickLine(line), true) }));

  if (incoming.length > 0) {
    await persistUnpick({
      db,
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      warehouseId: order.warehouseId,
      orderId: order.id,
      pickLocationId: order.pickLocationId,
      lines,
      incoming,
      includePacked: true,
      restoreAllocations: false,
      skipStatusUpdate: true,
      extra: [
        db
          .update(schema.orders)
          .set({ status: "cancelled", shopifySyncStatus: order.source === "shopify" ? "inbound" : order.shopifySyncStatus })
          .where(eq(schema.orders.id, order.id)),
        ...releaseAllocationStatements(db, order.id, now),
      ],
    });
    return true;
  }

  await db.batch([
    db
      .update(schema.orders)
      .set({ status: "cancelled", shopifySyncStatus: order.source === "shopify" ? "inbound" : order.shopifySyncStatus })
      .where(eq(schema.orders.id, order.id)),
    ...releaseAllocationStatements(db, order.id, now),
  ] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return true;
}

export { hasUnpickable, remainingToUnpick, asUnpickLine };
