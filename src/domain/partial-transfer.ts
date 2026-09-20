export type MoveLine = {
  lineId: string;
  sku?: string;
  qtyExpected: number;
  qtyMoved: number;
};

export class OverMoveError extends Error {
  constructor(
    public sku: string,
    public remaining: number,
    public qty: number,
  ) {
    super(`Cannot move ${qty} of ${sku}: only ${remaining} remaining`);
    this.name = "OverMoveError";
  }
}

export function remainingToMove(line: MoveLine): number {
  return line.qtyExpected - line.qtyMoved;
}

export function hasUnmoved(lines: MoveLine[]): boolean {
  return lines.some((line) => remainingToMove(line) > 0);
}

export function isFullyMoved(lines: MoveLine[]): boolean {
  return lines.length > 0 && lines.every((line) => remainingToMove(line) <= 0);
}

export function applyPartialMove(
  expected: MoveLine[],
  incoming: { lineId: string; qty: number }[],
): { next: MoveLine[]; posted: { lineId: string; qty: number }[] } {
  if (incoming.length === 0) {
    throw new Error("At least one transfer line is required");
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
      throw new Error("Line is not on this transfer");
    }
    const line = next[at]!;
    const remaining = remainingToMove(line);
    if (row.qty > remaining) {
      throw new OverMoveError(line.sku ?? row.lineId, remaining, row.qty);
    }
    line.qtyMoved += row.qty;
    posted.push({ lineId: row.lineId, qty: row.qty });
  }

  return { next, posted };
}
