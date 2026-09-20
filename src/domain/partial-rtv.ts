export type RtvLine = {
  itemId: string;
  sku?: string;
  qtyExpected: number;
  qtyReturned: number;
};

export class OverReturnError extends Error {
  constructor(
    public sku: string,
    public remaining: number,
    public qty: number,
  ) {
    super(`Cannot return ${qty} of ${sku}: only ${remaining} remaining`);
    this.name = "OverReturnError";
  }
}

export function remainingToReturn(line: RtvLine): number {
  return line.qtyExpected - line.qtyReturned;
}

export function hasUnreturned(lines: RtvLine[]): boolean {
  return lines.some((line) => remainingToReturn(line) > 0);
}

export function isFullyReturned(lines: RtvLine[]): boolean {
  return lines.length > 0 && lines.every((line) => remainingToReturn(line) <= 0);
}

export function applyPartialReturn(
  expected: RtvLine[],
  incoming: { itemId: string; qty: number }[],
): { next: RtvLine[]; posted: { itemId: string; qty: number }[] } {
  if (incoming.length === 0) {
    throw new Error("At least one return line is required");
  }
  const next = expected.map((line) => ({ ...line }));
  const index = new Map(next.map((line, i) => [line.itemId, i]));
  const posted: { itemId: string; qty: number }[] = [];

  for (const row of incoming) {
    if (!Number.isInteger(row.qty) || row.qty <= 0) {
      throw new Error("Quantity must be a positive integer");
    }
    const at = index.get(row.itemId);
    if (at === undefined) {
      throw new Error("Item is not on this document");
    }
    const line = next[at]!;
    const remaining = remainingToReturn(line);
    if (row.qty > remaining) {
      throw new OverReturnError(line.sku ?? row.itemId, remaining, row.qty);
    }
    line.qtyReturned += row.qty;
    posted.push({ itemId: row.itemId, qty: row.qty });
  }

  return { next, posted };
}
