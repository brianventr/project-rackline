export type PackLine = {
  lineId: string;
  sku?: string;
  qtyPicked: number;
  qtyPacked: number;
};

export class OverPackError extends Error {
  constructor(
    public sku: string,
    public remaining: number,
    public qty: number,
  ) {
    super(`Cannot pack ${qty} of ${sku}: only ${remaining} remaining`);
    this.name = "OverPackError";
  }
}

export function remainingToPack(line: PackLine): number {
  return line.qtyPicked - line.qtyPacked;
}

export function hasUnpacked(lines: PackLine[]): boolean {
  return lines.some((line) => remainingToPack(line) > 0);
}

export function isFullyPacked(lines: PackLine[]): boolean {
  return lines.length > 0 && lines.every((line) => remainingToPack(line) <= 0);
}

/** An order line at the pack station. `inPack` is the qty on screen for the pack being built. */
export type PackStationLine = { lineId: string; itemId: string; sku: string; remaining: number; inPack: number };

/** `add: null` means the scan counted toward a qty that was typed ahead of the scans. */
export type PackUnitScan = { ok: true; add: { lineId: string; qty: number } | null } | { ok: false; problem: string };

/**
 * One unit scanned at a scan-verified pack station. While earlier scans of the SKU (`unitsScanned`)
 * trail the qty on screen, the scan only catches up. After that it adds 1 to the first line for the
 * item with room left in this pack.
 */
export function packUnitScan(
  lines: PackStationLine[],
  unit: { itemId: string; sku: string },
  unitsScanned: number,
): PackUnitScan {
  const sku = unit.sku.trim().toUpperCase();
  const matches = lines.filter((line) => line.itemId === unit.itemId || line.sku.trim().toUpperCase() === sku);
  if (matches.length === 0) return { ok: false, problem: `${unit.sku} is not on this order.` };
  const open = matches.filter((line) => line.remaining > 0);
  if (open.length === 0) return { ok: false, problem: `${unit.sku} is already packed.` };
  if (unitsScanned < open.reduce((sum, line) => sum + line.inPack, 0)) return { ok: true, add: null };
  const room = open.find((line) => line.inPack < line.remaining);
  if (!room) {
    const left = open.reduce((sum, line) => sum + line.remaining, 0);
    return { ok: false, problem: `All ${left} ${unit.sku} left to pack are already scanned.` };
  }
  return { ok: true, add: { lineId: room.lineId, qty: room.inPack + 1 } };
}

export function applyPartialPack(
  expected: PackLine[],
  incoming: { lineId: string; qty: number }[],
): { next: PackLine[]; posted: { lineId: string; qty: number }[] } {
  if (incoming.length === 0) {
    throw new Error("At least one pack line is required");
  }
  const next = expected.map((line) => ({ ...line }));
  const index = new Map(next.map((line, i) => [line.lineId, i]));
  const posted: { lineId: string; qty: number }[] = [];

  for (const row of incoming) {
    if (!Number.isInteger(row.qty) || row.qty <= 0) {
      throw new Error("Quantity must be a positive integer");
    }
    const at = index.get(row.lineId);
    if (at === undefined) {
      throw new Error("Line is not on this order");
    }
    const line = next[at]!;
    const remaining = remainingToPack(line);
    if (row.qty > remaining) {
      throw new OverPackError(line.sku ?? row.lineId, remaining, row.qty);
    }
    line.qtyPacked += row.qty;
    posted.push({ lineId: row.lineId, qty: row.qty });
  }

  return { next, posted };
}
