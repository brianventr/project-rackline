export type OrderLineForBatch = {
  orderId: string;
  orderLineId: string;
  itemId: string;
  sku: string;
  remaining: number;
};

export type BatchLinePlan = {
  itemId: string;
  sku: string;
  qty: number;
  orderLineIds: string[];
};

/** Consolidate remaining order qty by SKU for batch-mode waves. */
export function buildBatchLines(lines: OrderLineForBatch[]): BatchLinePlan[] {
  const byItem = new Map<string, BatchLinePlan>();
  for (const line of lines) {
    if (line.remaining <= 0) continue;
    const existing = byItem.get(line.itemId);
    if (existing) {
      existing.qty += line.remaining;
      existing.orderLineIds.push(line.orderLineId);
    } else {
      byItem.set(line.itemId, {
        itemId: line.itemId,
        sku: line.sku,
        qty: line.remaining,
        orderLineIds: [line.orderLineId],
      });
    }
  }
  return [...byItem.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

export type BatchPickAllocation = {
  orderId: string;
  orderLineId: string;
  itemId: string;
  sku: string;
  qty: number;
};

/**
 * Spread a batch pick qty across open order lines for that SKU (FIFO by orderLineIds order).
 * Throws if qty exceeds remaining across those lines.
 */
export function allocateBatchPick(
  lines: OrderLineForBatch[],
  itemId: string,
  qty: number,
): BatchPickAllocation[] {
  if (qty <= 0) throw new Error("Batch pick qty must be positive");
  const matching = lines.filter((line) => line.itemId === itemId && line.remaining > 0);
  const available = matching.reduce((sum, line) => sum + line.remaining, 0);
  if (qty > available) {
    throw new OverBatchPickError(matching[0]?.sku ?? itemId, available, qty);
  }
  let left = qty;
  const out: BatchPickAllocation[] = [];
  for (const line of matching) {
    if (left <= 0) break;
    const take = Math.min(line.remaining, left);
    out.push({
      orderId: line.orderId,
      orderLineId: line.orderLineId,
      itemId: line.itemId,
      sku: line.sku,
      qty: take,
    });
    left -= take;
  }
  return out;
}

export class OverBatchPickError extends Error {
  constructor(
    public sku: string,
    public remaining: number,
    public qty: number,
  ) {
    super(`Cannot batch-pick ${qty} of ${sku}; only ${remaining} remaining on the wave`);
    this.name = "OverBatchPickError";
  }
}

export function remainingOnBatchLine(line: { qty: number; qtyPicked: number }): number {
  return Math.max(0, line.qty - line.qtyPicked);
}

export function isBatchFullyPicked(lines: { qty: number; qtyPicked: number }[]): boolean {
  return lines.every((line) => remainingOnBatchLine(line) === 0);
}

export function waveOrdersComplete(
  orders: { status: string }[],
): boolean {
  return orders.length > 0 && orders.every((order) => {
    const status = order.status === "draft" ? "open" : order.status;
    return status === "picked" || status === "packing" || status === "packed" || status === "shipped" || status === "cancelled";
  });
}
