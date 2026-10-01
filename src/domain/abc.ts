export const ABC_WINDOW_DAYS = 30;
export const ABC_A_SHARE = 0.8;
export const ABC_B_SHARE = 0.95;
export const DAY_MS = 86_400_000;

export const ABC_CADENCE_DAYS = { A: 7, B: 30, C: 90 } as const;

export type AbcClass = keyof typeof ABC_CADENCE_DAYS;

export type VelocityRow = { itemId: string; units: number };

/**
 * A/B/C from movement units over the window. Items are ordered by units, then id.
 * A unit that is still inside the first 80% of movement (the item that crosses 80% included) is A.
 * The next through 95% is B. The rest, and anything that did not move, is C.
 */
export function classifyAbc(rows: readonly VelocityRow[]): Map<string, AbcClass> {
  const ordered = [...rows].sort((a, b) => b.units - a.units || a.itemId.localeCompare(b.itemId));
  const total = ordered.reduce((sum, row) => sum + Math.max(0, row.units), 0);
  const out = new Map<string, AbcClass>();
  let cumulative = 0;
  for (const row of ordered) {
    if (row.units <= 0 || total <= 0) {
      out.set(row.itemId, "C");
      continue;
    }
    const before = cumulative / total;
    cumulative += row.units;
    if (before < ABC_A_SHARE) out.set(row.itemId, "A");
    else if (before < ABC_B_SHARE) out.set(row.itemId, "B");
    else out.set(row.itemId, "C");
  }
  return out;
}

export function cadenceMs(abcClass: AbcClass): number {
  return ABC_CADENCE_DAYS[abcClass] * DAY_MS;
}

/** False when an open count already covers the item, or it was posted inside its cadence. */
export function cycleCountDue(input: {
  abcClass: AbcClass;
  lastPostedAt: number | null;
  open: boolean;
  now: number;
}): boolean {
  if (input.open) return false;
  if (input.lastPostedAt == null) return true;
  return input.now - input.lastPostedAt >= cadenceMs(input.abcClass);
}

export function chooseCountBay(
  bays: readonly { locationId: string; qty: number; slotRole: string | null }[],
): string | null {
  const stocked = bays.filter((bay) => bay.qty > 0);
  if (stocked.length === 0) return null;
  const picks = stocked.filter((bay) => bay.slotRole === "pick");
  const pool = picks.length > 0 ? picks : stocked;
  return pool.reduce((best, bay) => (bay.qty > best.qty ? bay : best)).locationId;
}
