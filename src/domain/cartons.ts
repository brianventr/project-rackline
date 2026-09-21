export type CartonLine = {
  lineId: string;
  sku?: string;
  qtyPacked: number;
  qtyCartoned: number;
};

export type PackageShipRow = {
  units: number;
  trackingNumber: string | null;
};

export class OverCartonError extends Error {
  constructor(
    public sku: string,
    public remaining: number,
    public qty: number,
  ) {
    super(`Cannot carton ${qty} of ${sku}: only ${remaining} remaining`);
    this.name = "OverCartonError";
  }
}

export function cartonNumber(seq: number): string {
  return `BOX-${seq}`;
}

export function remainingToCarton(line: CartonLine): number {
  return line.qtyPacked - line.qtyCartoned;
}

export function hasUncartoned(lines: CartonLine[]): boolean {
  return lines.some((line) => remainingToCarton(line) > 0);
}

export function isFullyCartoned(lines: CartonLine[]): boolean {
  return lines.length > 0 && lines.every((line) => remainingToCarton(line) <= 0);
}

export function applyCarton(
  expected: CartonLine[],
  incoming: { lineId: string; qty: number }[],
): { next: CartonLine[]; posted: { lineId: string; qty: number }[] } {
  if (incoming.length === 0) {
    throw new Error("At least one carton line is required");
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
    const remaining = remainingToCarton(line);
    if (row.qty > remaining) {
      throw new OverCartonError(line.sku ?? row.lineId, remaining, row.qty);
    }
    line.qtyCartoned += row.qty;
    posted.push({ lineId: row.lineId, qty: row.qty });
  }

  return { next, posted };
}

export function cartonShipGate(input: {
  packedUnits: number;
  packages: PackageShipRow[];
}): { ok: true } | { ok: false; code: "NEED_PACKAGE"; error: string } {
  if (input.packages.length === 0) return { ok: true };
  const cartoned = input.packages.reduce((sum, row) => sum + row.units, 0);
  if (cartoned < input.packedUnits) {
    return { ok: false, code: "NEED_PACKAGE", error: "Pack remaining units into cartons before shipping" };
  }
  if (input.packages.some((row) => !row.trackingNumber)) {
    return { ok: false, code: "NEED_PACKAGE", error: "Buy a label for every carton before shipping" };
  }
  return { ok: true };
}

export function orderLevelLabelGate(packageCount: number): { ok: true } | { ok: false; code: "NEED_PACKAGE"; error: string } {
  if (packageCount === 0) return { ok: true };
  return { ok: false, code: "NEED_PACKAGE", error: "Buy a label on each carton" };
}
