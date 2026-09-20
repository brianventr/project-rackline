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
