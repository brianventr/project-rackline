import { DAY_MS, medianPositive, projectRunway, suggestedRunwayQty, type InboundReceipt } from "./runway";

/** Ocean, air, and ground defaults until a vendor's own receipts replace them. */
export const TRANSIT_DEFAULT_DAYS = { ocean: 35, air: 7, ground: 5 } as const;
export type TransitMode = keyof typeof TRANSIT_DEFAULT_DAYS;

export const RESTOCK_POLICIES = ["off", "alert", "draft"] as const;
export type RestockPolicy = (typeof RESTOCK_POLICIES)[number];

export const ASN_MILESTONES = ["booked", "on_water", "at_port", "to_warehouse", "received"] as const;
export type AsnMilestone = (typeof ASN_MILESTONES)[number];

export const ASN_MILESTONE_LABELS: Record<AsnMilestone, string> = {
  booked: "Booked",
  on_water: "On the water",
  at_port: "At the port",
  to_warehouse: "To the warehouse",
  received: "Received",
};

/** Make plus an ocean crossing can run past the runway chart's 60-day cap. */
export const RESTOCK_MAX_LEAD_DAYS = 180;
export const RESTOCK_MIN_LEAD_DAYS = 1;
/** Learned transit replaces the default once this many containers have arrived. */
export const TRANSIT_LEARN_SAMPLES = 3;
export const RESTOCK_WINDOW_DAYS = 30;

export type RestockPool = { kind: "house" } | { kind: "client"; clientId: string; clientName: string };

export function isTransitMode(value: unknown): value is TransitMode {
  return value === "ocean" || value === "air" || value === "ground";
}

export function isRestockPolicy(value: unknown): value is RestockPolicy {
  return value === "off" || value === "alert" || value === "draft";
}

export function isAsnMilestone(value: unknown): value is AsnMilestone {
  return typeof value === "string" && (ASN_MILESTONES as readonly string[]).includes(value);
}

export function parseRestockPolicy(value: unknown): RestockPolicy {
  if (!isRestockPolicy(value)) throw new Error("Restock policy must be off, alert, or draft.");
  return value;
}

/** Whole days, or null when the field is cleared. Throws on a bad number. */
export function parseOptionalDays(value: unknown, label: string, max = 365): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new Error(`${label} must be whole days, 0 to ${max}.`);
  }
  return n;
}

export function defaultTransitDays(mode: TransitMode): number {
  return TRANSIT_DEFAULT_DAYS[mode];
}

export function poolKey(pool: RestockPool): string {
  return pool.kind === "house" ? "house" : pool.clientId;
}

export function poolLabel(pool: RestockPool): string {
  return pool.kind === "house" ? "house" : pool.clientName;
}

/**
 * Lead time for a restock. A vendor with no transit mode keeps the runway's existing lead
 * (observed purchase-to-ASN, otherwise 7 days, capped at 60). A set lane is make days plus
 * transit days, up to 180, and a learned transit median wins after enough receipts.
 */
export function restockLead(input: {
  laneSet: boolean;
  makeDays: number | null;
  transitMode: TransitMode | null;
  transitDays: number | null;
  learnedTransitDays: number | null;
  learnedSamples: number;
  legacyLeadDays: number;
}): { makeDays: number; transitDays: number; leadDays: number; learned: boolean } {
  if (!input.laneSet || !input.transitMode) {
    const legacy = Math.min(60, Math.max(RESTOCK_MIN_LEAD_DAYS, input.legacyLeadDays));
    return { makeDays: legacy, transitDays: 0, leadDays: legacy, learned: false };
  }
  const learned = input.learnedSamples >= TRANSIT_LEARN_SAMPLES && (input.learnedTransitDays ?? 0) > 0;
  const transit = learned
    ? input.learnedTransitDays!
    : (input.transitDays ?? defaultTransitDays(input.transitMode));
  const make = Math.max(0, input.makeDays ?? 0);
  const leadDays = Math.min(RESTOCK_MAX_LEAD_DAYS, Math.max(RESTOCK_MIN_LEAD_DAYS, Math.round(make + transit)));
  return { makeDays: make, transitDays: Math.max(0, transit), leadDays, learned };
}

/** Median transit days from containers that have both a departure and a receipt. */
export function learnedTransitDays(samples: readonly number[]): { days: number | null; count: number } {
  const usable = samples.filter((days) => Number.isFinite(days) && days > 0);
  if (usable.length === 0) return { days: null, count: 0 };
  return { days: medianPositive(usable, usable[0]!), count: usable.length };
}

/**
 * When the freight arrives. An entered ETA or expected date wins. Otherwise departure plus
 * transit, or the order date plus make and transit.
 */
export function freightEta(input: {
  expectedAt?: number | null;
  eta?: number | null;
  departedAt?: number | null;
  orderedAt?: number | null;
  makeDays: number;
  transitDays: number;
  fallbackAt: number;
}): { at: number; source: "entered" | "departed" | "scheduled" } {
  if (input.expectedAt != null && input.expectedAt > 0) return { at: input.expectedAt, source: "entered" };
  if (input.eta != null && input.eta > 0) return { at: input.eta, source: "entered" };
  const transitMs = Math.max(0, input.transitDays) * DAY_MS;
  const makeMs = Math.max(0, input.makeDays) * DAY_MS;
  if (input.departedAt != null && input.departedAt > 0) {
    return { at: input.departedAt + transitMs, source: "departed" };
  }
  if (input.orderedAt != null && input.orderedAt > 0) {
    return { at: input.orderedAt + makeMs + transitMs, source: "scheduled" };
  }
  return { at: input.fallbackAt, source: "scheduled" };
}

export type RestockDecision = {
  stockoutAt: number | null;
  orderByAt: number | null;
  suggestedQty: number;
  /** Order-by is today or past, and no open PO covers this pool. */
  due: boolean;
  daysOfCover: number | null;
};

export function decideRestock(input: {
  asOf: number;
  rate: number;
  sellable: number;
  inbound: readonly InboundReceipt[];
  leadDays: number;
  bufferDays?: number;
  covered: boolean;
}): RestockDecision {
  const rate = Math.max(0, input.rate);
  const leadDays = Math.min(RESTOCK_MAX_LEAD_DAYS, Math.max(0, input.leadDays));
  const horizonDays = Math.max(180, Math.ceil(leadDays) + 30);
  const projection = projectRunway({
    sellable: Math.max(0, input.sellable),
    rate,
    inbound: [...input.inbound],
    asOf: input.asOf,
    horizonDays,
  });
  const orderByAt = projection.stockoutAt == null ? null : projection.stockoutAt - leadDays * DAY_MS;
  const inboundQty = input.inbound.reduce((sum, row) => sum + Math.max(0, row.qty), 0);
  const suggestedQty = suggestedRunwayQty({
    rate,
    leadDays,
    bufferDays: input.bufferDays ?? 14,
    sellable: input.sellable,
    inbound: inboundQty,
  });
  const due = !input.covered && suggestedQty > 0 && orderByAt != null && orderByAt <= input.asOf && rate > 0;
  return { stockoutAt: projection.stockoutAt, orderByAt, suggestedQty, due, daysOfCover: projection.daysOfCover };
}

export function restockGap(makeDays: number, transitDays: number): "make" | "transit" {
  return makeDays >= transitDays ? "make" : "transit";
}

/** How far across the 120-day restock timeline a date sits. Past dates sit at the start. */
export const RESTOCK_TIMELINE_DAYS = 120;

export function timelineFraction(at: number | null, now: number, days = RESTOCK_TIMELINE_DAYS): number | null {
  if (at == null || !Number.isFinite(at)) return null;
  const start = now - (now % DAY_MS);
  const span = days * DAY_MS;
  if (!(span > 0)) return null;
  return Math.min(1, Math.max(0, (at - start) / span));
}

/** The container arrives after the shelf is already empty. */
export function freightIsLate(freightAt: number | null, stockoutAt: number | null): boolean {
  return freightAt != null && stockoutAt != null && freightAt > stockoutAt;
}
