import type { StockedBay } from "./partial-pick";
import type { StockOwner } from "./client-stock";

/** One line still to cover. `qty` is what this order still needs reserved, usually ordered minus picked. */
export type SoftReserveLine = {
  lineId: string;
  itemId: string;
  sku: string;
  qty: number;
};

export type SoftReserveDraft = {
  lineId: string;
  itemId: string;
  sku: string;
  qty: number;
};

export type SoftReserveShort = {
  lineId: string;
  itemId: string;
  sku: string;
  needed: number;
  reserved: number;
  shortQty: number;
};

export type SoftHold = {
  itemId: string;
  orderId: string;
  /** The reserving order's 3PL client, null for own stock. */
  clientId: StockOwner;
  qty: number;
};

/**
 * Absolute open qty to store for each line, from ATP that already excludes this order's soft hold
 * (so the units it holds are still in the pool). A second call with the same pool returns the same
 * qty; it does not add another reserve on top.
 * Short qty is left unreserved. ATP of 0 still plans a reserve of 0 and a short of the whole line.
 */
export function planSoftReserves(input: {
  lines: SoftReserveLine[];
  /** Owner ATP per item, including this order's current soft hold and excluding everyone else's. */
  atpByItem: Map<string, number>;
}): { reserves: SoftReserveDraft[]; short: SoftReserveShort[] } {
  const pool = new Map<string, number>();
  for (const [itemId, qty] of input.atpByItem) pool.set(itemId, Math.max(0, qty));
  const reserves: SoftReserveDraft[] = [];
  const short: SoftReserveShort[] = [];

  for (const line of input.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) continue;
    const available = pool.get(line.itemId) ?? 0;
    const reserved = Math.min(line.qty, available);
    pool.set(line.itemId, available - reserved);
    if (reserved > 0) {
      reserves.push({ lineId: line.lineId, itemId: line.itemId, sku: line.sku, qty: reserved });
    }
    if (reserved < line.qty) {
      short.push({
        lineId: line.lineId,
        itemId: line.itemId,
        sku: line.sku,
        needed: line.qty,
        reserved,
        shortQty: line.qty - reserved,
      });
    }
  }

  return { reserves, short };
}

/**
 * The qty to store. `planned` is the absolute open qty from `planSoftReserves`, not a delta, so a
 * second ingest that plans the same number does not add it to what is already reserved.
 */
export function reserveQtyToStore(current: number, planned: number): number {
  return current < 0 ? Math.max(0, planned) : Math.max(0, planned);
}

/** Take `holdQty` off bays in location order. The hold itself names no bay. */
export function reduceQtyAcrossBays<T extends { locationId: string; qty: number }>(bays: T[], holdQty: number): T[] {
  if (holdQty <= 0 || bays.length === 0) return bays.map((bay) => ({ ...bay }));
  const next = bays.map((bay) => Math.max(0, bay.qty));
  const order = bays
    .map((bay, index) => ({ index, locationId: bay.locationId }))
    .sort((a, b) => a.locationId.localeCompare(b.locationId) || a.index - b.index);
  let left = holdQty;
  for (const entry of order) {
    if (left <= 0) break;
    const take = Math.min(next[entry.index] ?? 0, left);
    next[entry.index] = (next[entry.index] ?? 0) - take;
    left -= take;
  }
  return bays.map((bay, index) => ({ ...bay, qty: next[index] ?? 0 }));
}

export type SoftHoldQty = {
  itemId: string;
  qty: number;
  orderId?: string;
};

/** Subtract item-level soft holds from bay rows. Which bay gives up units is not stored. */
export function applySoftHoldsToOnHand<T extends { locationId: string; itemId: string; qty: number }>(
  rows: T[],
  holds: SoftHoldQty[],
  excludeOrderId?: string,
): T[] {
  const holdByItem = new Map<string, number>();
  for (const hold of holds) {
    if (excludeOrderId && hold.orderId === excludeOrderId) continue;
    if (hold.qty <= 0) continue;
    holdByItem.set(hold.itemId, (holdByItem.get(hold.itemId) ?? 0) + hold.qty);
  }
  if (holdByItem.size === 0) return rows.map((row) => ({ ...row }));
  const byItem = new Map<string, { row: T; index: number }[]>();
  rows.forEach((row, index) => {
    const list = byItem.get(row.itemId) ?? [];
    list.push({ row, index });
    byItem.set(row.itemId, list);
  });
  const next = rows.map((row) => row.qty);
  for (const [itemId, list] of byItem) {
    const reduced = reduceQtyAcrossBays(
      list.map((entry) => entry.row),
      holdByItem.get(itemId) ?? 0,
    );
    list.forEach((entry, offset) => {
      next[entry.index] = reduced[offset]?.qty ?? entry.row.qty;
    });
  }
  return rows.map((row, index) => ({ ...row, qty: next[index] ?? row.qty }));
}

/**
 * Drop other orders' soft holds for this owner from bays that are already cut to that owner's
 * plannable qty. Another client's hold does not reduce this owner's pool.
 */
export function applyOwnerSoftHolds(
  baysByItem: Map<string, StockedBay[]>,
  holds: SoftHold[],
  options: { owner: StockOwner; excludeOrderId?: string },
): Map<string, StockedBay[]> {
  const holdByItem = new Map<string, number>();
  for (const hold of holds) {
    if ((hold.clientId ?? null) !== options.owner) continue;
    if (options.excludeOrderId && hold.orderId === options.excludeOrderId) continue;
    if (hold.qty <= 0) continue;
    holdByItem.set(hold.itemId, (holdByItem.get(hold.itemId) ?? 0) + hold.qty);
  }
  const next = new Map<string, StockedBay[]>();
  for (const [itemId, bays] of baysByItem) {
    next.set(itemId, reduceQtyAcrossBays(bays, holdByItem.get(itemId) ?? 0));
  }
  return next;
}
