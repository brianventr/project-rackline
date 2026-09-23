import { alias } from "drizzle-orm/sqlite-core";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { getOrgWarehouse } from "../lib/org";
import { loadHeldLotQuantities, loadOpenHolds } from "./holds";
import { applyHoldsToOnHand, blocksLot } from "../domain/holds";
import { LIVE_PACE_WINDOW_MS, movementTouch } from "../domain/live";
import {
  floorPace,
  isHandedOff,
  planPromises,
  PROMISE_ORDER_STATUSES,
  type PromiseBoard,
  type PromiseBoardInput,
  type PromiseInbound,
  type PromiseLot,
  type PromiseOrderInput,
  type PromiseStock,
} from "../domain/promise";
import { DEFAULT_LEAD_MS } from "../domain/runway";
import { isValidTimeZone, startOfZonedDay } from "../domain/time-zone";

const OPEN_PO = ["ordered", "receiving"] as const;
const OPEN_ASN = ["expected", "receiving"] as const;

export type PromiseFacts = {
  input: PromiseBoardInput;
  items: { itemId: string; sku: string; name: string }[];
};

function fitLots(sellable: number, lots: PromiseLot[]): PromiseLot[] {
  const next = lots.map((lot) => ({ qty: lot.qty, expiresOn: lot.expiresOn })).filter((lot) => lot.qty > 0);
  let extra = next.reduce((sum, lot) => sum + lot.qty, 0) - Math.max(0, sellable);
  if (extra <= 0) return next;
  const latestFirst = [...next].sort((a, b) => {
    if (a.expiresOn == null && b.expiresOn == null) return 0;
    if (a.expiresOn == null) return -1;
    if (b.expiresOn == null) return 1;
    return b.expiresOn - a.expiresOn;
  });
  for (const lot of latestFirst) {
    if (extra <= 0) break;
    const drop = Math.min(lot.qty, extra);
    lot.qty -= drop;
    extra -= drop;
  }
  return next.filter((lot) => lot.qty > 0);
}

export async function loadPromiseFacts(
  db: AppDb,
  organizationId: string,
  warehouseId: string,
  options: { asOf?: number; cutoffMinutes?: number } = {},
): Promise<PromiseFacts> {
  const warehouse = await getOrgWarehouse(db, organizationId, warehouseId);
  const now = options.asOf ?? Date.now();
  const timeZone = isValidTimeZone(warehouse.timeZone) ? warehouse.timeZone : "UTC";
  const dayStart = startOfZonedDay(now, timeZone);
  const windowStart = Math.max(dayStart, now - LIVE_PACE_WINDOW_MS);
  const fromLoc = alias(schema.locations, "promise_from_loc");
  const toLoc = alias(schema.locations, "promise_to_loc");

  const [catalog, balances, holds, lotRows, lineRows, asnRows, poRows, movementRows, packRows] = await Promise.all([
    db
      .select({ id: schema.items.id, sku: schema.items.sku, name: schema.items.name })
      .from(schema.items)
      .where(eq(schema.items.organizationId, organizationId)),
    db
      .select({
        itemId: schema.inventoryBalances.itemId,
        locationId: schema.inventoryBalances.locationId,
        qty: schema.inventoryBalances.qty,
      })
      .from(schema.inventoryBalances)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
      .where(
        and(eq(schema.inventoryBalances.organizationId, organizationId), eq(schema.locations.warehouseId, warehouseId)),
      ),
    loadOpenHolds(db, organizationId, warehouseId),
    db
      .select({
        itemId: schema.lotBalances.itemId,
        locationId: schema.lotBalances.locationId,
        lotCode: schema.lotBalances.lotCode,
        qty: schema.lotBalances.qty,
        expiresOn: schema.lotBalances.expiresOn,
      })
      .from(schema.lotBalances)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.lotBalances.locationId))
      .where(and(eq(schema.lotBalances.organizationId, organizationId), eq(schema.locations.warehouseId, warehouseId))),
    db
      .select({
        orderId: schema.orders.id,
        number: schema.orders.number,
        customerName: schema.orders.customerName,
        status: schema.orders.status,
        createdAt: schema.orders.createdAt,
        trackerStatus: schema.orders.trackerStatus,
        itemId: schema.orderLines.itemId,
        sku: schema.items.sku,
        name: schema.items.name,
        qty: schema.orderLines.qty,
        qtyPicked: schema.orderLines.qtyPicked,
      })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          eq(schema.orders.warehouseId, warehouseId),
          inArray(schema.orders.status, [...PROMISE_ORDER_STATUSES]),
        ),
      ),
    db
      .select({
        itemId: schema.asnLines.itemId,
        qtyExpected: schema.asnLines.qtyExpected,
        qtyReceived: schema.asnLines.qtyReceived,
        expectedAt: schema.asns.expectedAt,
        eta: schema.asns.eta,
        createdAt: schema.asns.createdAt,
        number: schema.asns.number,
      })
      .from(schema.asnLines)
      .innerJoin(schema.asns, eq(schema.asns.id, schema.asnLines.asnId))
      .where(
        and(
          eq(schema.asns.organizationId, organizationId),
          eq(schema.asns.warehouseId, warehouseId),
          inArray(schema.asns.status, [...OPEN_ASN]),
        ),
      ),
    db
      .select({
        itemId: schema.purchaseLines.itemId,
        qtyOrdered: schema.purchaseLines.qtyOrdered,
        qtyReceived: schema.purchaseLines.qtyReceived,
        orderedAt: schema.purchases.orderedAt,
        number: schema.purchases.number,
      })
      .from(schema.purchaseLines)
      .innerJoin(schema.purchases, eq(schema.purchases.id, schema.purchaseLines.purchaseId))
      .where(
        and(
          eq(schema.purchases.organizationId, organizationId),
          eq(schema.purchases.warehouseId, warehouseId),
          inArray(schema.purchases.status, [...OPEN_PO]),
        ),
      ),
    db
      .select({
        type: schema.inventoryMovements.type,
        qty: schema.inventoryMovements.qty,
        createdAt: schema.inventoryMovements.createdAt,
        refType: schema.inventoryMovements.refType,
        fromLocationId: schema.inventoryMovements.fromLocationId,
        toLocationId: schema.inventoryMovements.toLocationId,
      })
      .from(schema.inventoryMovements)
      .leftJoin(fromLoc, eq(fromLoc.id, schema.inventoryMovements.fromLocationId))
      .leftJoin(toLoc, eq(toLoc.id, schema.inventoryMovements.toLocationId))
      .where(
        and(
          eq(schema.inventoryMovements.organizationId, organizationId),
          gte(schema.inventoryMovements.createdAt, windowStart),
          lte(schema.inventoryMovements.createdAt, now),
          or(eq(fromLoc.warehouseId, warehouseId), eq(toLoc.warehouseId, warehouseId)),
        ),
      ),
    db
      .select({ qty: schema.packEvents.qty, createdAt: schema.packEvents.createdAt })
      .from(schema.packEvents)
      .where(
        and(
          eq(schema.packEvents.organizationId, organizationId),
          eq(schema.packEvents.warehouseId, warehouseId),
          gte(schema.packEvents.createdAt, windowStart),
          lte(schema.packEvents.createdAt, now),
        ),
      ),
  ]);

  const lotHeld = await loadHeldLotQuantities(db, organizationId, holds);
  const availableRows = applyHoldsToOnHand(balances, holds, lotHeld);
  const availableByItem = new Map<string, number>();
  for (const row of availableRows) {
    availableByItem.set(row.itemId, (availableByItem.get(row.itemId) ?? 0) + Math.max(0, row.qty));
  }

  const lotsByItem = new Map<string, Map<number | null, number>>();
  for (const row of lotRows) {
    if (row.qty <= 0) continue;
    if (holds.some((hold) => blocksLot(hold, row.locationId, row.itemId, row.lotCode))) continue;
    const bucket = lotsByItem.get(row.itemId) ?? new Map<number | null, number>();
    bucket.set(row.expiresOn, (bucket.get(row.expiresOn) ?? 0) + row.qty);
    lotsByItem.set(row.itemId, bucket);
  }

  const inboundByItem = new Map<string, PromiseInbound[]>();
  const asnRemainingByItem = new Map<string, number>();
  for (const row of asnRows) {
    const remaining = Math.max(0, row.qtyExpected - row.qtyReceived);
    if (remaining <= 0) continue;
    asnRemainingByItem.set(row.itemId, (asnRemainingByItem.get(row.itemId) ?? 0) + remaining);
    const list = inboundByItem.get(row.itemId) ?? [];
    list.push({ at: row.expectedAt ?? row.eta ?? row.createdAt, qty: remaining, ref: row.number });
    inboundByItem.set(row.itemId, list);
  }
  const poBudget = new Map(asnRemainingByItem);
  const purchases = [...poRows].sort((a, b) => (a.orderedAt ?? now) - (b.orderedAt ?? now) || a.number.localeCompare(b.number));
  for (const row of purchases) {
    const remaining = Math.max(0, row.qtyOrdered - row.qtyReceived);
    if (remaining <= 0) continue;
    const budget = poBudget.get(row.itemId) ?? 0;
    const cover = Math.min(remaining, budget);
    poBudget.set(row.itemId, budget - cover);
    const net = remaining - cover;
    if (net <= 0) continue;
    const list = inboundByItem.get(row.itemId) ?? [];
    list.push({ at: (row.orderedAt ?? now) + DEFAULT_LEAD_MS, qty: net, ref: row.number });
    inboundByItem.set(row.itemId, list);
  }

  const stock: PromiseStock[] = catalog.map((item) => {
    const sellable = Math.max(0, availableByItem.get(item.id) ?? 0);
    const merged = [...(lotsByItem.get(item.id) ?? [])].map(([expiresOn, qty]) => ({ qty, expiresOn }));
    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      sellable,
      lots: fitLots(sellable, merged),
      inbound: inboundByItem.get(item.id) ?? [],
    };
  });

  const orders = new Map<string, PromiseOrderInput>();
  for (const row of lineRows) {
    let order = orders.get(row.orderId);
    if (!order) {
      order = {
        id: row.orderId,
        number: row.number,
        customerName: row.customerName,
        status: row.status,
        createdAt: row.createdAt,
        handedOff: isHandedOff(row.trackerStatus),
        lines: [],
      };
      orders.set(row.orderId, order);
    }
    order.lines.push({
      itemId: row.itemId,
      sku: row.sku,
      name: row.name,
      qty: row.qty,
      pickQty: Math.max(0, row.qty - row.qtyPicked),
    });
  }

  const touches: { at: number; qty: number }[] = [];
  for (const row of movementRows) {
    const mapped = movementTouch(row);
    if (!mapped) continue;
    touches.push({ at: row.createdAt, qty: mapped.sign * Math.abs(row.qty) });
  }
  for (const row of packRows) touches.push({ at: row.createdAt, qty: row.qty });

  return {
    input: {
      now,
      timeZone,
      cutoffMinutes: options.cutoffMinutes,
      pacePerHour: floorPace(touches, now, dayStart),
      orders: [...orders.values()],
      stock,
    },
    items: catalog.map((item) => ({ itemId: item.id, sku: item.sku, name: item.name })),
  };
}

export async function loadPromiseBoard(
  db: AppDb,
  organizationId: string,
  warehouseId: string,
  options: { asOf?: number; cutoffMinutes?: number } = {},
): Promise<PromiseBoard> {
  const facts = await loadPromiseFacts(db, organizationId, warehouseId, options);
  return planPromises(facts.input).board;
}
