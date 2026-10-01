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

export type UnpickAllocationTarget = { orderLineId: string; itemId: string; locationId: string; qty: number };

/**
 * Where an unpick puts a line's reservation back. A chosen bay takes the whole qty. Otherwise each
 * bay the line was picked from gets its own share; one fallback bay is used only when no slice is known.
 */
export function unpickAllocationTargets(
  lines: { lineId: string; itemId: string; qty: number; slices: { locationId: string; qty: number }[] }[],
  chosenLocationId?: string | null,
  fallbackLocationId?: string | null,
): UnpickAllocationTarget[] {
  const out: UnpickAllocationTarget[] = [];
  for (const line of lines) {
    if (line.qty <= 0) continue;
    if (chosenLocationId) {
      out.push({ orderLineId: line.lineId, itemId: line.itemId, locationId: chosenLocationId, qty: line.qty });
      continue;
    }
    const slices = line.slices.filter((slice) => slice.qty > 0 && slice.locationId);
    if (slices.length === 0) {
      if (fallbackLocationId) {
        out.push({ orderLineId: line.lineId, itemId: line.itemId, locationId: fallbackLocationId, qty: line.qty });
      }
      continue;
    }
    for (const slice of slices) {
      out.push({ orderLineId: line.lineId, itemId: line.itemId, locationId: slice.locationId, qty: slice.qty });
    }
  }
  return out;
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

export type PickHistoryEntry = PickSlice & { type: "pick" | "unpick"; createdAt: number };

/**
 * What is still picked on an order: its picks and unpicks replayed oldest first. An unpick takes back
 * the serials it names, or else the newest pick of the same lot, so a pick, unpick, and re-pick of
 * the same serial nets to the re-pick.
 */
export function netPickSlices(history: PickHistoryEntry[]): PickSlice[] {
  const ordered = [...history].sort(
    (a, b) => a.createdAt - b.createdAt || (a.type === b.type ? 0 : a.type === "pick" ? -1 : 1),
  );
  let stack: PickSlice[] = [];
  for (const entry of ordered) {
    const { type, createdAt: _createdAt, ...slice } = entry;
    if (type === "pick") stack.push({ ...slice, serials: [...slice.serials] });
    else stack = returnToStock(stack, slice);
  }
  return stack.filter((slice) => slice.qty > 0);
}

function shrink(slice: PickSlice, take: number, serials: string[]): PickSlice {
  const qty = slice.qty - take;
  const weightGrams =
    slice.weightGrams == null || qty === 0 ? null : slice.weightGrams - Math.floor((slice.weightGrams * take) / slice.qty);
  return { ...slice, qty, serials, weightGrams };
}

function returnToStock(stack: PickSlice[], unpick: PickSlice): PickSlice[] {
  const rest = [...stack];
  let need = unpick.qty;
  for (const serial of unpick.serials) {
    if (need <= 0) break;
    for (let index = rest.length - 1; index >= 0; index -= 1) {
      const slice = rest[index]!;
      if (slice.itemId !== unpick.itemId || slice.qty <= 0 || !slice.serials.includes(serial)) continue;
      rest[index] = shrink(slice, 1, slice.serials.filter((code) => code !== serial));
      need -= 1;
      break;
    }
  }
  const matchers = [
    (slice: PickSlice) => slice.itemId === unpick.itemId && slice.lotCode === unpick.lotCode,
    (slice: PickSlice) => slice.itemId === unpick.itemId,
  ];
  for (const matches of matchers) {
    for (let index = rest.length - 1; index >= 0 && need > 0; index -= 1) {
      const slice = rest[index]!;
      if (slice.qty <= 0 || !matches(slice)) continue;
      const take = Math.min(slice.qty, need);
      rest[index] = shrink(slice, take, slice.serials.slice(take));
      need -= take;
    }
  }
  return rest;
}
