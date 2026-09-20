export type UnpickLine = {
  lineId: string;
  sku?: string;
  qtyPicked: number;
  qtyPacked: number;
};

export type PickSlice = {
  itemId: string;
  locationId: string;
  qty: number;
  lotCode: string | null;
  serials: string[];
  weightGrams: number | null;
};

export class OverUnpickError extends Error {
  constructor(
    public sku: string,
    public remaining: number,
    public qty: number,
  ) {
    super(`Cannot unpick ${qty} of ${sku}: only ${remaining} remaining`);
    this.name = "OverUnpickError";
  }
}

export function remainingToUnpick(line: UnpickLine, includePacked = false): number {
  return includePacked ? line.qtyPicked : line.qtyPicked - line.qtyPacked;
}

export function hasUnpickable(lines: UnpickLine[], includePacked = false): boolean {
  return lines.some((line) => remainingToUnpick(line, includePacked) > 0);
}

export function applyPartialUnpick(
  expected: UnpickLine[],
  incoming: { lineId: string; qty: number }[],
  includePacked = false,
): { next: UnpickLine[]; posted: { lineId: string; qty: number }[] } {
  if (incoming.length === 0) {
    throw new Error("At least one unpick line is required");
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
    const remaining = remainingToUnpick(line, includePacked);
    if (row.qty > remaining) {
      throw new OverUnpickError(line.sku ?? row.lineId, remaining, row.qty);
    }
    line.qtyPicked -= row.qty;
    if (line.qtyPacked > line.qtyPicked) line.qtyPacked = line.qtyPicked;
    posted.push({ lineId: row.lineId, qty: row.qty });
  }

  return { next, posted };
}

export function takeFromSlices(
  slices: PickSlice[],
  itemId: string,
  qty: number,
): { taken: PickSlice[]; rest: PickSlice[] } {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  let need = qty;
  const taken: PickSlice[] = [];
  const rest: PickSlice[] = [];
  for (let index = slices.length - 1; index >= 0; index -= 1) {
    const slice = slices[index]!;
    if (slice.itemId !== itemId || slice.qty <= 0 || need <= 0) {
      rest.unshift(slice);
      continue;
    }
    const take = Math.min(slice.qty, need);
    const leftover = slice.qty - take;
    const serials = slice.serials ?? [];
    const takenSerials = serials.slice(0, take);
    const leftoverSerials = serials.slice(take);
    const totalGrams = slice.weightGrams;
    let takenGrams: number | null = null;
    let leftoverGrams: number | null = null;
    if (totalGrams != null) {
      takenGrams = leftover === 0 ? totalGrams : Math.floor((totalGrams * take) / slice.qty);
      leftoverGrams = leftover === 0 ? null : totalGrams - takenGrams;
    }
    taken.unshift({
      ...slice,
      qty: take,
      serials: takenSerials,
      weightGrams: takenGrams,
    });
    if (leftover > 0) {
      rest.unshift({
        ...slice,
        qty: leftover,
        serials: leftoverSerials,
        weightGrams: leftoverGrams,
      });
    }
    need -= take;
  }
  if (need > 0) {
    throw new Error(`Cannot unpick ${qty}: only ${qty - need} picked remaining for this SKU`);
  }
  return { taken, rest };
}

export function netPickSlices(picks: PickSlice[], unpicks: PickSlice[]): PickSlice[] {
  let rest = picks.map((slice) => ({ ...slice, serials: [...slice.serials] }));
  for (const unpick of unpicks) {
    const next = takeFromSlices(rest, unpick.itemId, unpick.qty);
    rest = next.rest;
  }
  return rest.filter((slice) => slice.qty > 0);
}
