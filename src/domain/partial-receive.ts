export type ExpectedLine = {
  itemId: string;
  sku?: string;
  qtyExpected: number;
  qtyReceived: number;
};

export class OverReceiveError extends Error {
  constructor(
    public sku: string,
    public remaining: number,
    public qty: number,
  ) {
    super(`Cannot receive ${qty} of ${sku}: only ${remaining} remaining`);
    this.name = "OverReceiveError";
  }
}

export function remainingOnLine(line: ExpectedLine): number {
  return line.qtyExpected - line.qtyReceived;
}

export function hasRemaining(lines: ExpectedLine[]): boolean {
  return lines.some((line) => remainingOnLine(line) > 0);
}

export function isFullyReceived(lines: ExpectedLine[]): boolean {
  return lines.length > 0 && lines.every((line) => remainingOnLine(line) <= 0);
}

export function applyPartialReceive(
  expected: ExpectedLine[],
  incoming: { itemId: string; qty: number }[],
): { next: ExpectedLine[]; posted: { itemId: string; qty: number }[] } {
  if (incoming.length === 0) {
    throw new Error("At least one receive line is required");
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
    const remaining = remainingOnLine(line);
    if (row.qty > remaining) {
      throw new OverReceiveError(line.sku ?? row.itemId, remaining, row.qty);
    }
    line.qtyReceived += row.qty;
    posted.push({ itemId: row.itemId, qty: row.qty });
  }

  return { next, posted };
}

export class OverUnreceiveError extends Error {
  constructor(
    public sku: string,
    public received: number,
    public qty: number,
  ) {
    super(`Cannot unreceive ${qty} of ${sku}: only ${received} received`);
    this.name = "OverUnreceiveError";
  }
}

export function applyUnreceive(
  expected: ExpectedLine[],
  incoming: { itemId: string; qty: number }[],
): { next: ExpectedLine[]; posted: { itemId: string; qty: number }[] } {
  if (incoming.length === 0) {
    throw new Error("At least one unreceive line is required");
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
    if (row.qty > line.qtyReceived) {
      throw new OverUnreceiveError(line.sku ?? row.itemId, line.qtyReceived, row.qty);
    }
    line.qtyReceived -= row.qty;
    posted.push({ itemId: row.itemId, qty: row.qty });
  }

  return { next, posted };
}

export function asnStatusAfterUnreceive(
  lines: ExpectedLine[],
  previousStatus: string,
): { status: string; clearReceivedAt: boolean } {
  if (isFullyReceived(lines)) {
    return { status: "received", clearReceivedAt: false };
  }
  if (lines.some((line) => line.qtyReceived > 0)) {
    return { status: "receiving", clearReceivedAt: true };
  }
  return { status: previousStatus === "draft" ? "draft" : "expected", clearReceivedAt: true };
}
