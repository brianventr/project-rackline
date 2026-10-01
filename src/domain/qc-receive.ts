export const QC_DECISIONS = ["restock", "hold", "scrap"] as const;

export type QcDecision = (typeof QC_DECISIONS)[number];

export class QcSampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QcSampleError";
  }
}

/** Blank is off. Otherwise a whole number from 0 to 100. */
export function normalizeQcSamplePercent(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new QcSampleError("QC sample percent must be a whole number from 0 to 100");
  }
  return n;
}

export function isQcDecision(value: string): value is QcDecision {
  return (QC_DECISIONS as readonly string[]).includes(value);
}

export function parseQcDecision(raw: unknown): QcDecision {
  if (typeof raw !== "string" || !isQcDecision(raw.trim().toLowerCase())) {
    throw new QcSampleError("Decision must be restock, hold, or scrap");
  }
  return raw.trim().toLowerCase() as QcDecision;
}

/** FNV-1a. The same text always lands in the same bucket, with no Math.random. */
function hash32(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * How many units of this receive are pulled for QC.
 * Null or 0 percent pulls none. 100 percent pulls every unit.
 * Otherwise unit i is sampled when hash(receiptLineId + ":" + i) mod 100 is below the percent,
 * so the receipt line id chooses the sample and the same line always samples the same units.
 */
export function qcSampleQty(receiptLineId: string, qty: number, percent: number | null): number {
  if (percent == null || percent <= 0 || qty <= 0) return 0;
  if (percent >= 100) return qty;
  let sample = 0;
  for (let i = 0; i < qty; i++) {
    if (hash32(`${receiptLineId}:${i}`) % 100 < percent) sample += 1;
  }
  return sample;
}

/**
 * What a receive posts. Every unit lands on hand once. Only the unsampled units are available
 * and only those go on a license plate, so a later hold or scrap does not count them twice.
 */
export function qcReceiveSplit(
  receiptLineId: string,
  qty: number,
  percent: number | null,
): { onHandQty: number; availableQty: number; sampleQty: number; plateQty: number } {
  const sampleQty = qcSampleQty(receiptLineId, qty, percent);
  const availableQty = qty - sampleQty;
  return { onHandQty: qty, availableQty, sampleQty, plateQty: availableQty };
}

export type QcStockEffect = {
  /** Change to on-hand. Restock and hold leave the units where receive put them. */
  onHandDelta: number;
  /** Change to available qty from this decision alone, before an inventory hold locks the bay. */
  availableDelta: number;
  /** Adjustment to post. Scrap is one adjustment out. */
  adjustmentQty: number;
  createsHold: boolean;
};

/**
 * What a decision does to units already received and held back.
 * Restock makes them available without receiving them again.
 * Hold leaves on-hand alone and opens an inventory hold; the QC reservation ends so the hold is the only lock.
 * Scrap removes them once. They were never available, so the rest of the bay's available qty does not move.
 */
export function qcDecisionEffect(decision: QcDecision, qty: number): QcStockEffect {
  if (!Number.isInteger(qty) || qty <= 0) throw new QcSampleError("Quantity must be a positive integer");
  if (decision === "restock") {
    return { onHandDelta: 0, availableDelta: qty, adjustmentQty: 0, createsHold: false };
  }
  if (decision === "hold") {
    return { onHandDelta: 0, availableDelta: 0, adjustmentQty: 0, createsHold: true };
  }
  return { onHandDelta: -qty, availableDelta: 0, adjustmentQty: -qty, createsHold: false };
}

/** Open QC samples reduce available qty. Other statuses do not, so a hold or a scrap is not subtracted again. */
export function applyOpenQcToOnHand<T extends { locationId: string; itemId: string; qty: number }>(
  rows: T[],
  open: { locationId: string; itemId: string; qty: number }[],
): T[] {
  if (open.length === 0) return rows;
  const reserved = new Map<string, number>();
  for (const row of open) {
    if (row.qty <= 0) continue;
    const key = `${row.locationId}:${row.itemId}`;
    reserved.set(key, (reserved.get(key) ?? 0) + row.qty);
  }
  if (reserved.size === 0) return rows;
  return rows.map((row) => {
    const heldBack = reserved.get(`${row.locationId}:${row.itemId}`) ?? 0;
    if (heldBack <= 0) return row;
    return { ...row, qty: Math.max(0, row.qty - heldBack) };
  });
}
