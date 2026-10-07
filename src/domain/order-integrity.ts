/** Order-integrity alerts. Problems are derived; a row leaves the inbox when the source is fixed. */

export const PAID_WAIT_MS = 2 * 60 * 60 * 1000;

export type PaidSignal = {
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  receivedAt: number;
};

export type CancelSignal = PaidSignal;

export type MissingSkuSignal = PaidSignal & { sku: string };

export type KnownOrder = {
  shopifyOrderId: string;
  status: string;
  id: string;
  number: string;
  warehouseId: string;
};

export function paidNotIngested(
  signals: readonly PaidSignal[],
  orders: readonly { shopifyOrderId: string }[],
  now: number,
): PaidSignal[] {
  const present = new Set(orders.map((order) => order.shopifyOrderId));
  return signals.filter((signal) => now - signal.receivedAt >= PAID_WAIT_MS && !present.has(signal.shopifyOrderId));
}

export function cancelStillOpen(signals: readonly CancelSignal[], orders: readonly KnownOrder[]): KnownOrder[] {
  const wanted = new Set(signals.map((signal) => signal.shopifyOrderId));
  return orders.filter((order) => wanted.has(order.shopifyOrderId) && order.status !== "cancelled");
}

export function missingSkus(signals: readonly MissingSkuSignal[], catalogSkus: readonly string[]): MissingSkuSignal[] {
  const known = new Set(catalogSkus.map((sku) => sku.trim().toUpperCase()));
  return signals.filter((signal) => signal.sku.trim() && !known.has(signal.sku.trim().toUpperCase()));
}

export type CoverOrder = {
  id: string;
  number: string;
  warehouseId: string;
  createdAt: number;
  lines: { sku: string; qty: number }[];
};

export type PartialRisk = {
  orderId: string;
  number: string;
  warehouseId: string;
  createdAt: number;
  short: { sku: string; need: number; have: number }[];
};

/** Oldest open order takes the shelf first. An order that cannot be filled completely is at risk of a short ship. */
export function partialShipRisk(orders: readonly CoverOrder[], cover: readonly { sku: string; qty: number }[]): PartialRisk[] {
  const shelf = new Map<string, number>();
  for (const row of cover) {
    const sku = row.sku.trim().toUpperCase();
    shelf.set(sku, (shelf.get(sku) ?? 0) + Math.max(0, row.qty));
  }
  const risks: PartialRisk[] = [];
  const sorted = [...orders].sort((a, b) => a.createdAt - b.createdAt || a.number.localeCompare(b.number));
  for (const order of sorted) {
    const short: PartialRisk["short"] = [];
    for (const line of order.lines) {
      if (line.qty <= 0) continue;
      const sku = line.sku.trim().toUpperCase();
      const have = shelf.get(sku) ?? 0;
      if (have < line.qty) short.push({ sku, need: line.qty, have });
    }
    if (short.length) {
      risks.push({
        orderId: order.id,
        number: order.number,
        warehouseId: order.warehouseId,
        createdAt: order.createdAt,
        short,
      });
    }
    for (const line of order.lines) {
      if (line.qty <= 0) continue;
      const sku = line.sku.trim().toUpperCase();
      const have = shelf.get(sku) ?? 0;
      shelf.set(sku, Math.max(0, have - line.qty));
    }
  }
  return risks;
}
