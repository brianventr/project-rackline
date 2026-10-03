/**
 * Freight on a purchase is spread across the lines, then each receipt updates the SKU's
 * average unit cost. Qty stays integer pieces.
 */

export type LandedLine = {
  itemId: string;
  qty: number;
  /** Price per each on the PO, in cents. */
  unitCostCents: number;
};

export type LandedUnit = { itemId: string; unitCents: number };

/**
 * Unit cost after freight. Spread by extended cost. When every line is free, spread by qty.
 * Leftover cents land on the line with the largest extended cost (then qty).
 */
export function landedUnitCosts(input: { freightCents: number; lines: LandedLine[] }): LandedUnit[] {
  const freight = Math.max(0, Math.floor(input.freightCents));
  const lines = input.lines.filter((line) => line.qty > 0);
  if (lines.length === 0) return [];
  const extended = lines.map((line) => Math.max(0, line.unitCostCents) * line.qty);
  const base = extended.reduce((sum, value) => sum + value, 0);
  const weights = base > 0 ? extended : lines.map((line) => line.qty);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const shares = weights.map((weight) => (weightTotal > 0 ? Math.floor((freight * weight) / weightTotal) : 0));
  let leftover = freight - shares.reduce((sum, value) => sum + value, 0);
  const order = weights
    .map((weight, index) => ({ index, weight }))
    .sort((a, b) => b.weight - a.weight || b.index - a.index);
  for (const row of order) {
    if (leftover <= 0) break;
    shares[row.index] = (shares[row.index] ?? 0) + 1;
    leftover -= 1;
  }
  return lines.map((line, index) => ({
    itemId: line.itemId,
    unitCents: Math.max(0, line.unitCostCents) + Math.floor((shares[index] ?? 0) / line.qty),
  }));
}

/** Weighted average after receiving `received` units at `receivedUnitCents` onto `onHand`. */
export function weightedUnitCost(input: {
  onHand: number;
  oldUnitCents: number;
  received: number;
  receivedUnitCents: number;
}): number {
  const onHand = Math.max(0, Math.floor(input.onHand));
  const received = Math.max(0, Math.floor(input.received));
  const total = onHand + received;
  if (total <= 0) return Math.max(0, Math.floor(input.oldUnitCents));
  const old = Math.max(0, input.oldUnitCents);
  const next = Math.max(0, input.receivedUnitCents);
  return Math.round((onHand * old + received * next) / total);
}
