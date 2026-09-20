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
  zoneId?: string | null;
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

function preferZone(rows: StockedBay[], preferredZoneId?: string | null): StockedBay[] {
  if (!preferredZoneId) return rows;
  const inZone = rows.filter((row) => row.zoneId === preferredZoneId);
  return inZone.length > 0 ? inZone : rows;
}

export function suggestPickBay(
  onHand: StockedBay[],
  remaining: number,
  preferredZoneId?: string | null,
): StockedBay | null {
  const stocked = onHand.filter((row) => row.qty > 0);
  const pickFaces = preferZone(stocked.filter((row) => row.slotRole === "pick"), preferredZoneId);
  const storage = preferZone(stocked.filter((row) => row.type === "storage"), preferredZoneId);
  const allPreferred = preferZone(stocked, preferredZoneId);
  const pools = [
    pickFaces.filter((row) => row.qty >= remaining),
    pickFaces,
    storage.filter((row) => row.qty >= remaining),
    storage,
    allPreferred.filter((row) => row.qty >= remaining),
    allPreferred,
    stocked.filter((row) => row.qty >= remaining),
    stocked,
  ];
  for (const pool of pools) {
    const ranked = rankBays(pool);
    if (ranked[0]) return ranked[0];
  }
  return null;
}
