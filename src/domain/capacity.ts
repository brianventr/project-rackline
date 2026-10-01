/**
 * Bin capacity: an optional limit per bay on units, weight, and volume. A bay's fill is its balances
 * times each item's weight and size. Only limits that are set count, so a bay with none never fills.
 */
import type { PackSize } from "./pack-sizes";

/** Null means no limit on that measure. Weight is stored in oz and volume in cubic inches. */
export type BinCapacity = {
  maxQty: number | null;
  maxWeightOz: number | null;
  maxVolumeCuIn: number | null;
};

export type BinUsage = { qty: number; weightOz: number; volumeCuIn: number };

/** What one each weighs and fills. Null when neither the item nor any of its pack sizes says. */
export type EachMeasure = { weightOz: number | null; volumeCuIn: number | null };

export type CapacityMeasure = "qty" | "weight" | "volume";

export type CapacityBreach = { measure: CapacityMeasure; limit: number; before: number; after: number };

export type BinStock = { locationId: string; itemId: string; qty: number };

export const OZ_PER_LB = 16;
export const CU_IN_PER_CU_FT = 1728;
const MAX_LIMIT = 1_000_000_000;
/** Per-each weights split from a pack are fractions; a sum that lands on the limit is not over it. */
const EPSILON = 1e-6;

export const EMPTY_USAGE: BinUsage = { qty: 0, weightOz: 0, volumeCuIn: 0 };
export const NO_MEASURE: EachMeasure = { weightOz: null, volumeCuIn: null };

export const CAPACITY_OVERRIDE_ACTION = "capacity.override";
export const CAPACITY_OVERRIDE_CODE = "LOCATION_FULL_OVERRIDE";

const LIMITS = [
  { measure: "qty", max: "maxQty", used: "qty", label: "Max units" },
  { measure: "weight", max: "maxWeightOz", used: "weightOz", label: "Max weight" },
  { measure: "volume", max: "maxVolumeCuIn", used: "volumeCuIn", label: "Max volume" },
] as const;

export class CapacityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapacityInputError";
  }
}

export class LocationFullError extends Error {
  constructor(
    public locationCode: string,
    public breach: CapacityBreach,
  ) {
    super(`${locationFullSentence(locationCode, breach)} Put the rest in another bay, or an owner can override.`);
    this.name = "LocationFullError";
  }
}

export function isCapacityMeasure(value: unknown): value is CapacityMeasure {
  return value === "qty" || value === "weight" || value === "volume";
}

export function capacityOf(row: Partial<BinCapacity>): BinCapacity {
  return { maxQty: row.maxQty ?? null, maxWeightOz: row.maxWeightOz ?? null, maxVolumeCuIn: row.maxVolumeCuIn ?? null };
}

export function hasCapacity(row: Partial<BinCapacity> | null | undefined): boolean {
  if (!row) return false;
  return LIMITS.some(({ max }) => row[max] != null);
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function volumeOf(length: number | null | undefined, width: number | null | undefined, height: number | null | undefined) {
  const l = positive(length);
  const w = positive(width);
  const h = positive(height);
  return l && w && h ? l * w * h : null;
}

type ItemSize = {
  shipWeightOz?: number | null;
  shipLengthIn?: number | null;
  shipWidthIn?: number | null;
  shipHeightIn?: number | null;
};

type PackMeasure = Pick<PackSize, "qty" | "weightOz" | "lengthIn" | "widthIn" | "heightIn">;

/**
 * The item's own ship weight and size first. Without them, the smallest pack that has one, split
 * across its eaches (a case of 6 at 400 oz is 66.7 oz an each).
 */
export function eachMeasure(item: ItemSize, packs: PackMeasure[] = []): EachMeasure {
  const smallestFirst = packs.filter((pack) => pack.qty > 0).sort((a, b) => a.qty - b.qty);
  let weightOz = positive(item.shipWeightOz);
  if (weightOz == null) {
    const pack = smallestFirst.find((row) => positive(row.weightOz) != null);
    if (pack) weightOz = pack.weightOz! / pack.qty;
  }
  let volumeCuIn = volumeOf(item.shipLengthIn, item.shipWidthIn, item.shipHeightIn);
  if (volumeCuIn == null) {
    for (const pack of smallestFirst) {
      const volume = volumeOf(pack.lengthIn, pack.widthIn, pack.heightIn);
      if (volume == null) continue;
      volumeCuIn = volume / pack.qty;
      break;
    }
  }
  return { weightOz, volumeCuIn };
}

/** Units, weight, and volume of what a bay holds. An item with no weight or size adds only its units. */
export function binUsage(rows: { itemId: string; qty: number }[], measures: Map<string, EachMeasure>): BinUsage {
  const usage = { ...EMPTY_USAGE };
  for (const row of rows) {
    if (row.qty <= 0) continue;
    const measure = measures.get(row.itemId) ?? NO_MEASURE;
    usage.qty += row.qty;
    usage.weightOz += row.qty * (measure.weightOz ?? 0);
    usage.volumeCuIn += row.qty * (measure.volumeCuIn ?? 0);
  }
  return usage;
}

/** Items in the bay that a set weight or volume limit cannot see, because they have no weight or size. */
export function unmeasuredItems(
  capacity: BinCapacity,
  rows: { itemId: string; qty: number }[],
  measures: Map<string, EachMeasure>,
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.qty <= 0) continue;
    const measure = measures.get(row.itemId) ?? NO_MEASURE;
    if (capacity.maxWeightOz != null && measure.weightOz == null) ids.add(row.itemId);
    if (capacity.maxVolumeCuIn != null && measure.volumeCuIn == null) ids.add(row.itemId);
  }
  return [...ids];
}

/**
 * The first limit a change pushes the bay past. Only growth counts: a bay already over a limit can
 * still give stock up, and a change that leaves a measure where it was is not refused.
 */
export function overCapacity(capacity: BinCapacity, before: BinUsage, after: BinUsage): CapacityBreach | null {
  for (const { measure, max, used } of LIMITS) {
    const limit = capacity[max];
    if (limit == null) continue;
    if (after[used] > limit + EPSILON && after[used] > before[used] + EPSILON) {
      return { measure, limit, before: before[used], after: after[used] };
    }
  }
  return null;
}

/** How full the bay is on its tightest limit, as a whole percent (it can pass 100), or null with no limits. */
export function fillPercent(capacity: BinCapacity, usage: BinUsage): number | null {
  let fill: number | null = null;
  for (const { max, used } of LIMITS) {
    const limit = capacity[max];
    if (limit == null || limit <= 0) continue;
    const pct = (usage[used] / limit) * 100;
    fill = fill == null ? pct : Math.max(fill, pct);
  }
  return fill == null ? null : Math.floor(fill + EPSILON);
}

export const NEAR_FULL_PERCENT = 85;

export type FillTone = "ok" | "near" | "full";

export function fillTone(percent: number): FillTone {
  if (percent >= 100) return "full";
  return percent >= NEAR_FULL_PERCENT ? "near" : "ok";
}

/** How many more eaches of one item fit. Infinity when no set limit constrains it. */
export function roomFor(capacity: BinCapacity, usage: BinUsage, measure: EachMeasure): number {
  let room = Infinity;
  for (const { max, used } of LIMITS) {
    const limit = capacity[max];
    if (limit == null) continue;
    const per = used === "qty" ? 1 : used === "weightOz" ? measure.weightOz : measure.volumeCuIn;
    if (!per || per <= 0) continue;
    room = Math.min(room, Math.max(0, Math.floor((limit - usage[used]) / per + EPSILON)));
  }
  return room;
}

/**
 * Receives and moves put stock into their `to` bay on purpose, so they are the ones checked. Counts,
 * builds, and unpicks record stock that is already there, and a dekit returns components to the bay
 * they were built from.
 */
export function fillsBay(movement: { type: string; refType?: string | null; toLocationId?: string | null }): boolean {
  if (!movement.toLocationId) return false;
  if (movement.type === "move") return true;
  return movement.type === "receive" && movement.refType !== "kit";
}

/**
 * Each limited bay a plan pushes past a limit. `stock` is what the bays hold now; `planned` is the
 * final qty of every balance the plan writes, so moves within a bay and moves out are netted.
 */
export function capacityBreaches(input: {
  locations: ({ id: string; code: string } & BinCapacity)[];
  stock: BinStock[];
  planned: BinStock[];
  measures: Map<string, EachMeasure>;
}): { locationId: string; locationCode: string; breach: CapacityBreach }[] {
  const breaches: { locationId: string; locationCode: string; breach: CapacityBreach }[] = [];
  for (const location of input.locations) {
    if (!hasCapacity(location)) continue;
    const before = input.stock.filter((row) => row.locationId === location.id);
    const after = new Map(before.map((row) => [row.itemId, row.qty]));
    for (const row of input.planned) {
      if (row.locationId === location.id) after.set(row.itemId, row.qty);
    }
    const breach = overCapacity(
      capacityOf(location),
      binUsage(before, input.measures),
      binUsage(
        [...after].map(([itemId, qty]) => ({ itemId, qty })),
        input.measures,
      ),
    );
    if (breach) breaches.push({ locationId: location.id, locationCode: location.code, breach });
  }
  return breaches;
}

function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** The number alone, in units, lb, or cu ft. */
function scaled(measure: CapacityMeasure, value: number): string {
  if (measure === "weight") return oneDecimal(value / OZ_PER_LB);
  if (measure === "volume") return oneDecimal(value / CU_IN_PER_CU_FT);
  return String(Math.round(value));
}

/** "72 units", "300 lb", "12.5 cu ft". */
export function capacityAmount(measure: CapacityMeasure, value: number): string {
  if (measure === "weight") return `${scaled(measure, value)} lb`;
  if (measure === "volume") return `${scaled(measure, value)} cu ft`;
  const units = Math.round(value);
  return `${units} ${units === 1 ? "unit" : "units"}`;
}

const FILL_VERB: Record<CapacityMeasure, string> = { qty: "hold", weight: "weigh", volume: "fill" };

/** "A-01-02 would hold 72 units, over its limit of 60 units." */
export function locationFullSentence(locationCode: string, breach: Pick<CapacityBreach, "measure" | "limit" | "after">): string {
  const after = capacityAmount(breach.measure, breach.after);
  return `${locationCode} would ${FILL_VERB[breach.measure]} ${after}, over its limit of ${capacityAmount(breach.measure, breach.limit)}.`;
}

/** The audit line for an owner's override: "A-01-02 filled past its limit by an owner: 72 units, limit 60 units". */
export function capacityOverrideSummary(locationCode: string, breach: CapacityBreach): string {
  const after = capacityAmount(breach.measure, breach.after);
  return `${locationCode} filled past its limit by an owner: ${after}, limit ${capacityAmount(breach.measure, breach.limit)}`;
}

/** "60 units · 250 lb · 10 cu ft", or null with no limits. */
export function capacityText(capacity: BinCapacity): string | null {
  const parts = LIMITS.flatMap(({ measure, max }) => {
    const limit = capacity[max];
    return limit == null ? [] : [capacityAmount(measure, limit)];
  });
  return parts.length ? parts.join(" · ") : null;
}

/** "40 of 60 units · 120 of 250 lb", one part per set limit. */
export function usageText(capacity: BinCapacity, usage: BinUsage): string | null {
  const parts = LIMITS.flatMap(({ measure, max, used }) => {
    const limit = capacity[max];
    return limit == null ? [] : [`${scaled(measure, usage[used])} of ${capacityAmount(measure, limit)}`];
  });
  return parts.length ? parts.join(" · ") : null;
}

/**
 * One limit from a request body in stored units (units, oz, cubic inches). Null, blank, or 0 clears
 * it; undefined leaves the stored limit alone.
 */
export function parseCapacityLimit(value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) throw new CapacityInputError(`${label} must be a whole number, 0 or more`);
  if (n > MAX_LIMIT) throw new CapacityInputError(`${label} is too large`);
  return n === 0 ? null : n;
}

/** The limits a location POST or PATCH sets. Only keys present in the body come back. */
export function capacityPatch(body: Record<string, unknown>): Partial<BinCapacity> {
  const patch: Partial<BinCapacity> = {};
  for (const { max, label } of LIMITS) {
    const value = parseCapacityLimit(body[max], label);
    if (value !== undefined) patch[max] = value;
  }
  return patch;
}

export type CapacityForm = { maxQty: string; maxWeightLb: string; maxVolumeCuFt: string };

function formNumber(value: string, label: string, whole: boolean): number | null {
  const text = value.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || (whole && !Number.isInteger(n))) {
    throw new CapacityInputError(`${label} must be ${whole ? "a whole number" : "a number"}, 0 or more`);
  }
  return n;
}

/** The capacity editor's fields (units, lb, cu ft) as the API stores them. Blank or 0 clears a limit. */
export function capacityFromForm(form: CapacityForm): BinCapacity {
  const qty = formNumber(form.maxQty, "Max units", true);
  const lb = formNumber(form.maxWeightLb, "Max weight", false);
  const cuFt = formNumber(form.maxVolumeCuFt, "Max volume", false);
  const capacity = {
    maxQty: qty || null,
    maxWeightOz: lb ? Math.round(lb * OZ_PER_LB) || null : null,
    maxVolumeCuIn: cuFt ? Math.round(cuFt * CU_IN_PER_CU_FT) || null : null,
  };
  for (const { max, label } of LIMITS) {
    if ((capacity[max] ?? 0) > MAX_LIMIT) throw new CapacityInputError(`${label} is too large`);
  }
  return capacity;
}

/** Four decimals, so saving an untouched field converts back to the same whole oz or cubic inches. */
function formAmount(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function capacityToForm(capacity: BinCapacity): CapacityForm {
  return {
    maxQty: capacity.maxQty != null ? String(capacity.maxQty) : "",
    maxWeightLb: capacity.maxWeightOz != null ? formAmount(capacity.maxWeightOz / OZ_PER_LB) : "",
    maxVolumeCuFt: capacity.maxVolumeCuIn != null ? formAmount(capacity.maxVolumeCuIn / CU_IN_PER_CU_FT) : "",
  };
}
