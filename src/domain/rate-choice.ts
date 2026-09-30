import type { ParcelDims } from "./carrier-live";
import { localYmd, nextPickup } from "./promise";
import type { AutoRateStrategy } from "./ship-decision";
import { cutoffFor, type CarrierCutoffs } from "./wave-plan";

/** Live carrier calls in flight at once while a queue or a bulk ship shops rates. */
export const RATE_SHOP_CONCURRENCY = 4;
/** How long a live quote for one order, parcel, and pair of addresses is reused. */
export const RATE_QUOTE_TTL_MS = 10 * 60_000;
/** A carrier that has not answered by now is skipped for the rest of the request. */
export const RATE_SHOP_TIMEOUT_MS = 8_000;
export const MAX_DELIVERY_DAYS = 30;

/** What a rate choice needs from a carrier quote. */
export type RateOption = {
  id: string;
  company: string;
  service: string;
  connectionId: string | null;
  provider?: string;
  amountCents: number;
  /** Working days in transit once the carrier has it. */
  transitDays: number;
};

export type RateTiming = {
  now: number;
  timeZone: string;
  /** Pickup cutoff per carrier company; see `parseCarrierCutoffs`. */
  cutoffs: CarrierCutoffs;
};

export type RateChoice<Q extends RateOption> = {
  quote: Q;
  /** YYYYMMDD in the building's timezone. */
  arrival: number;
  /** Arrives after the order's promise date. */
  late: boolean;
  reason: string;
};

/* ------------------------------------------------------------------ working days */

function ymdDate(ymd: number): Date {
  return new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100));
}

function dateYmd(date: Date): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

function weekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** `ymd` plus `days` working days (Monday to Friday). A Saturday or Sunday start counts from Monday. */
export function addBusinessDays(ymd: number, days: number): number {
  const date = ymdDate(ymd);
  const step = () => date.setUTCDate(date.getUTCDate() + 1);
  while (weekend(date)) step();
  for (let left = Math.max(0, Math.floor(days)); left > 0; ) {
    step();
    if (!weekend(date)) left -= 1;
  }
  return dateYmd(date);
}

/** `Fri, Oct 2`. */
export function shortDay(ymd: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(
    ymdDate(ymd),
  );
}

/** The day an order was promised at the door: the day it was placed plus the building's delivery days. */
export function promiseYmd(orderedAt: number, timeZone: string, deliveryDays: number | null | undefined): number | null {
  if (deliveryDays == null || !Number.isInteger(deliveryDays) || deliveryDays < 1) return null;
  return addBusinessDays(localYmd(orderedAt, timeZone), deliveryDays);
}

/** The day a quote should arrive: the carrier's next pickup from now, then its transit days. */
export function arrivalYmd(quote: Pick<RateOption, "company" | "transitDays">, timing: RateTiming): number {
  const pickup = nextPickup(timing.now, timing.timeZone, cutoffFor(timing.cutoffs, quote.company));
  return addBusinessDays(localYmd(pickup, timing.timeZone), Math.max(0, Math.round(quote.transitDays)));
}

/* ------------------------------------------------------------------ choosing */

/**
 * Rackline Ground is the built-in demo carrier. Once a carrier account is connected a rate choice leaves it out, so
 * an account that fails to quote never turns into a demo label.
 */
export function rateCandidates<Q extends Pick<RateOption, "provider">>(quotes: Q[], accountConnected: boolean): Q[] {
  return accountConnected ? quotes.filter((row) => row.provider !== "rackline") : quotes;
}

/**
 * Cheapest: lowest price, then earliest arrival. Fastest: earliest arrival (pickup cutoff plus transit), then
 * lowest price. On time: the cheapest that arrives by the promise date; when none does, the fastest, marked late.
 * Without a promise date, on time picks the cheapest.
 */
export function chooseRate<Q extends RateOption>(
  quotes: Q[],
  strategy: AutoRateStrategy,
  input: { timing: RateTiming; promise: number | null; accountConnected: boolean },
): RateChoice<Q> | null {
  const rows = rateCandidates(quotes, input.accountConnected).map((quote) => ({ quote, arrival: arrivalYmd(quote, input.timing) }));
  if (!rows.length) return null;
  const name = (row: (typeof rows)[number]) => `${row.quote.company} ${row.quote.service}`;
  const byPrice = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    a.quote.amountCents - b.quote.amountCents || a.arrival - b.arrival || name(a).localeCompare(name(b));
  const bySpeed = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    a.arrival - b.arrival || a.quote.amountCents - b.quote.amountCents || name(a).localeCompare(name(b));
  const { promise } = input;
  const pick = (row: (typeof rows)[number], reason: string): RateChoice<Q> => ({
    ...row,
    late: promise != null && row.arrival > promise,
    reason,
  });

  if (strategy === "cheapest") return pick([...rows].sort(byPrice)[0]!, "Cheapest");
  if (strategy === "fastest") return pick([...rows].sort(bySpeed)[0]!, "Fastest");
  if (promise == null) return pick([...rows].sort(byPrice)[0]!, "Cheapest (no delivery promise set)");
  const onTime = rows.filter((row) => row.arrival <= promise).sort(byPrice);
  if (onTime.length) return pick(onTime[0]!, "Cheapest on time");
  return pick([...rows].sort(bySpeed)[0]!, `Fastest (nothing arrives by ${shortDay(promise)})`);
}

/* ------------------------------------------------------------------ shopping */

function fnv(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** One live quote per order, carrier account, parcel, both addresses, and the services asked for. */
export function rateQuoteKey(input: {
  organizationId: string;
  orderId: string;
  connectionId: string;
  parcel: ParcelDims;
  shipFrom: string;
  shipTo: string;
  serviceIds: string[];
}): string {
  const { parcel } = input;
  return [
    input.organizationId,
    input.orderId,
    input.connectionId,
    `${parcel.weightOz}oz:${parcel.lengthIn}x${parcel.widthIn}x${parcel.heightIn}`,
    fnv(input.shipFrom),
    fnv(input.shipTo),
    [...new Set(input.serviceIds)].sort().join(","),
  ].join("|");
}

/** A small expiring map. Oldest entries go first once it is full. */
export function expiringCache<V>(ttlMs: number, maxEntries: number) {
  const rows = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key: string, now: number): V | undefined {
      const row = rows.get(key);
      if (!row) return undefined;
      if (row.expiresAt <= now) {
        rows.delete(key);
        return undefined;
      }
      return row.value;
    },
    set(key: string, value: V, now: number): void {
      rows.delete(key);
      rows.set(key, { value, expiresAt: now + ttlMs });
      while (rows.size > maxEntries) {
        const oldest = rows.keys().next().value;
        if (oldest === undefined) break;
        rows.delete(oldest);
      }
    },
    get size() {
      return rows.size;
    },
  };
}

/** `fn` over `items` with at most `limit` running at once. Results keep the input order. */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(Math.floor(limit) || 1, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(lanes);
  return out;
}

/** Rejects with `message` when `promise` has not settled after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
