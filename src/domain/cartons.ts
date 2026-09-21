export type CartonLine = {
  lineId: string;
  sku?: string;
  qtyPacked: number;
  qtyCartoned: number;
};

export type PackageShipRow = {
  units: number;
  trackingNumber: string | null;
  shippedAt?: number | null;
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

export function nextCartonSeq(packages: { seq: number }[]): number {
  return packages.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
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
      throw new Error("Line is not on this document");
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
  if (input.packages.some((row) => !row.trackingNumber && !row.shippedAt)) {
    return { ok: false, code: "NEED_PACKAGE", error: "Buy a label for every carton before shipping" };
  }
  return { ok: true };
}

export type CartonShipDecision =
  | { ok: true }
  | { ok: false; code: "NEED_PACKAGE" | "SHIPPED"; error: string };

export function canShipLabeledCarton(pkg: {
  trackingNumber?: string | null;
  shippedAt?: number | null;
}): CartonShipDecision {
  if (pkg.shippedAt) {
    return { ok: false, code: "SHIPPED", error: "Carton is already shipped" };
  }
  if (!pkg.trackingNumber) {
    return { ok: false, code: "NEED_PACKAGE", error: "Buy a label for this carton before shipping" };
  }
  return { ok: true };
}

export function shippedCartonUnits(packages: PackageShipRow[]): number {
  return packages.filter((row) => row.shippedAt).reduce((sum, row) => sum + row.units, 0);
}

export function hasShippableCarton(packages: PackageShipRow[]): boolean {
  return packages.some((row) => Boolean(row.trackingNumber) && !row.shippedAt);
}

export function isCartonShipComplete(input: {
  packedUnits: number;
  unpacked: boolean;
  packages: PackageShipRow[];
}): boolean {
  if (input.unpacked) return false;
  if (input.packages.length === 0) return false;
  return shippedCartonUnits(input.packages) >= input.packedUnits;
}

export type UncartonDecision =
  | { ok: true }
  | { ok: false; code: "SHIPPED" | "CANCELLED"; error: string };

export function canUncartonOrderPackage(input: {
  status: string;
  shippedAt?: number | null;
}): UncartonDecision {
  if (input.status === "cancelled") {
    return { ok: false, code: "CANCELLED", error: "Cancelled orders cannot drop a carton" };
  }
  if (input.status === "shipped" || input.shippedAt) {
    return { ok: false, code: "SHIPPED", error: "Shipped cartons cannot be dropped" };
  }
  return { ok: true };
}

export function orderLevelLabelGate(packageCount: number): { ok: true } | { ok: false; code: "NEED_PACKAGE"; error: string } {
  if (packageCount === 0) return { ok: true };
  return { ok: false, code: "NEED_PACKAGE", error: "Buy a label on each carton" };
}

export function asnCartonReceiveGate(packageCount: number): { ok: true } | { ok: false; code: "NEED_PACKAGE"; error: string } {
  if (packageCount === 0) return { ok: true };
  return { ok: false, code: "NEED_PACKAGE", error: "Receive each vendor carton" };
}

export function asnCartonPutawayGate(
  unputawayReceivedCount: number,
): { ok: true } | { ok: false; code: "NEED_PACKAGE"; error: string } {
  if (unputawayReceivedCount === 0) return { ok: true };
  return { ok: false, code: "NEED_PACKAGE", error: "Put away each vendor carton" };
}

export type AsnCartonPutawayDecision =
  | { ok: true }
  | { ok: false; code: "NOT_RECEIVED" | "ALREADY_PUTAWAY"; error: string };

export function canPutawayAsnCarton(pkg: {
  receivedAt?: number | null;
  putawayAt?: number | null;
}): AsnCartonPutawayDecision {
  if (!pkg.receivedAt) {
    return { ok: false, code: "NOT_RECEIVED", error: "Receive the carton before putaway" };
  }
  if (pkg.putawayAt) {
    return { ok: false, code: "ALREADY_PUTAWAY", error: "Carton is already put away" };
  }
  return { ok: true };
}

export type AsnCartonUnreceiveDecision =
  | { ok: true }
  | { ok: false; code: "NOT_RECEIVED" | "ALREADY_PUTAWAY"; error: string };

export function canUnreceiveAsnCarton(pkg: {
  receivedAt?: number | null;
  putawayAt?: number | null;
}): AsnCartonUnreceiveDecision {
  if (!pkg.receivedAt) {
    return { ok: false, code: "NOT_RECEIVED", error: "Receive the carton before unreceiving" };
  }
  if (pkg.putawayAt) {
    return { ok: false, code: "ALREADY_PUTAWAY", error: "Put-away cartons cannot be unreceived" };
  }
  return { ok: true };
}
