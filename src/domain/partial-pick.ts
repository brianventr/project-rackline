export type PickLine = {
  lineId: string;
  sku?: string;
  qtyOrdered: number;
  qtyPicked: number;
};

export type StockedBay = {
  locationId: string;
  locationCode: string;
  locationName: string;
  barcode: string;
  qty: number;
  type?: string;
  slotRole?: string;
};

export class OverPickError extends Error {
  constructor(
    public sku: string,
    public remaining: number,
    public qty: number,
  ) {
    super(`Cannot pick ${qty} of ${sku}: only ${remaining} remaining`);
    this.name = "OverPickError";
  }
}

export function remainingToPick(line: PickLine): number {
  return line.qtyOrdered - line.qtyPicked;
}

export function hasUnpicked(lines: PickLine[]): boolean {
  return lines.some((line) => remainingToPick(line) > 0);
}

export function isFullyPicked(lines: PickLine[]): boolean {
  return lines.length > 0 && lines.every((line) => remainingToPick(line) <= 0);
}

export function applyPartialPick(
  expected: PickLine[],
  incoming: { lineId: string; qty: number }[],
): { next: PickLine[]; posted: { lineId: string; qty: number }[] } {
  if (incoming.length === 0) {
    throw new Error("At least one pick line is required");
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
    const remaining = remainingToPick(line);
    if (row.qty > remaining) {
      throw new OverPickError(line.sku ?? row.lineId, remaining, row.qty);
    }
    line.qtyPicked += row.qty;
    posted.push({ lineId: row.lineId, qty: row.qty });
  }

  return { next, posted };
}

function rankBays(rows: StockedBay[]): StockedBay[] {
  return rows.slice().sort((a, b) => b.qty - a.qty || a.locationCode.localeCompare(b.locationCode));
}

export function suggestPickBay(onHand: StockedBay[], remaining: number): StockedBay | null {
  const stocked = onHand.filter((row) => row.qty > 0);
  const pickFaces = stocked.filter((row) => row.slotRole === "pick");
  const storage = stocked.filter((row) => row.type === "storage");
  const pools = [
    pickFaces.filter((row) => row.qty >= remaining),
    pickFaces,
    storage.filter((row) => row.qty >= remaining),
    storage,
    stocked.filter((row) => row.qty >= remaining),
    stocked,
  ];
  for (const pool of pools) {
    const ranked = rankBays(pool);
    if (ranked[0]) return ranked[0];
  }
  return null;
}
