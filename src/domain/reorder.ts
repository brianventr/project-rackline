export type LowStockRow = {
  itemId: string;
  sku: string;
  name: string;
  onHand: number;
  reorderPoint: number;
  lastVendorName?: string | null;
};

export type ReorderLine = {
  itemId: string;
  sku: string;
  name: string;
  qty: number;
  onHand: number;
  reorderPoint: number;
  vendorName: string;
};

export function suggestedReorderQty(onHand: number, reorderPoint: number): number {
  if (!Number.isInteger(reorderPoint) || reorderPoint <= 0) return 0;
  return Math.max(1, reorderPoint - Math.max(0, onHand));
}

export function isBelowReorder(onHand: number, reorderPoint: number): boolean {
  return reorderPoint > 0 && Math.max(0, onHand) <= reorderPoint;
}

export function pickReorderVendor(vendors: Array<string | null | undefined>, fallback = "Reorder"): string {
  for (const vendor of vendors) {
    const name = vendor?.trim();
    if (name) return name;
  }
  return fallback;
}

export function buildReorderLines(
  rows: LowStockRow[],
  coveredItemIds: Iterable<string> = [],
  orgVendor?: string | null,
): ReorderLine[] {
  const covered = new Set(coveredItemIds);
  const lines: ReorderLine[] = [];
  for (const row of rows) {
    if (covered.has(row.itemId)) continue;
    if (!isBelowReorder(row.onHand, row.reorderPoint)) continue;
    const qty = suggestedReorderQty(row.onHand, row.reorderPoint);
    if (qty <= 0) continue;
    lines.push({
      itemId: row.itemId,
      sku: row.sku,
      name: row.name,
      qty,
      onHand: row.onHand,
      reorderPoint: row.reorderPoint,
      vendorName: pickReorderVendor([row.lastVendorName, orgVendor]),
    });
  }
  return lines;
}

export function majorityVendor(lines: ReorderLine[], fallback = "Reorder"): string {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line.vendorName, (counts.get(line.vendorName) ?? 0) + 1);
  }
  let best = fallback;
  let bestCount = 0;
  for (const [vendor, count] of counts) {
    if (count > bestCount) {
      best = vendor;
      bestCount = count;
    }
  }
  return best;
}
