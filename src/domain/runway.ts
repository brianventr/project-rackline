import { computeSellable } from "./shopify-sellable";
import { isExpiredLot, utcYyyymmdd } from "./expiry";
import { pickReorderVendor } from "./reorder";

export const DAY_MS = 86_400_000;
export const RUNWAY_HORIZON_DAYS = 90;
export const RUNWAY_BUFFER_DAYS = 14;
export const DEFAULT_LEAD_MS = 7 * DAY_MS;
export const MIN_LEAD_MS = DAY_MS;
export const MAX_LEAD_MS = 60 * DAY_MS;
export const THIN_SHIP_DAYS = 3;
export const ORDER_SOON_DAYS = 7;
export const WATCH_DAYS = 30;

export const RUNWAY_WINDOWS = ["7d", "30d", "90d"] as const;
export type RunwayWindow = (typeof RUNWAY_WINDOWS)[number];

export const RUNWAY_MULTIPLIERS = [0.5, 1, 1.5, 2] as const;
export type RunwayMultiplier = (typeof RUNWAY_MULTIPLIERS)[number];

export const RUNWAY_STATUSES = [
  "out",
  "order_now",
  "order_soon",
  "covered",
  "watch",
  "thin",
  "healthy",
  "idle",
] as const;
export type RunwayStatus = (typeof RUNWAY_STATUSES)[number];
export type RunwayRateSource = "baseline" | "observed" | "none";

export type InboundReceipt = {
  at: number;
  qty: number;
};

export type RunwayLot = {
  qty: number;
  expiresOn: number | null;
};

export type BomComponent = {
  parentItemId: string;
  componentItemId: string;
  qty: number;
};

export type RunwayProjection = {
  daysOfCover: number | null;
  stockoutAt: number | null;
  firstGapAt: number | null;
  coveredByInbound: boolean;
  horizonHit: boolean;
};

export type RunwayDailyPoint = {
  day: string;
  shipped: number;
  onHand: number;
  inbound: number;
};

export type RunwayItemFact = {
  itemId: string;
  sku: string;
  name: string;
  trackExpiry?: boolean;
  baselineShipRate: number | null;
  onHand: number;
  held: number;
  remainingToPick: number;
  lots?: RunwayLot[];
  unitsShipped: number;
  shipDays: number;
  dailyShipped?: Array<{ day: string; qty: number }>;
  inbound: InboundReceipt[];
  lastVendorName?: string | null;
  leadTimeMs: number;
  coveredByOpenPo: boolean;
};

export type RunwayRow = {
  itemId: string;
  sku: string;
  name: string;
  onHand: number;
  held: number;
  remainingToPick: number;
  sellable: number;
  observedRate: number;
  baselineRate: number | null;
  burnRate: number;
  rateSource: RunwayRateSource;
  inboundQty: number;
  inboundAt: number | null;
  daysOfCover: number | null;
  stockoutAt: number | null;
  firstGapAt: number | null;
  orderByAt: number | null;
  leadTimeMs: number;
  suggestedQty: number;
  coveredByInbound: boolean;
  coveredByOpenPo: boolean;
  lastVendorName: string | null;
  status: RunwayStatus;
  thin: boolean;
  shipDays: number;
  unitsShipped: number;
  daily: RunwayDailyPoint[];
};

export type RunwayKpis = {
  out: number;
  orderNow: number;
  covered: number;
  idle: number;
};

export type RunwayBoard = {
  asOf: number;
  window: RunwayWindow;
  multiplier: number;
  kpis: RunwayKpis;
  rows: RunwayRow[];
};

export type RunwayDraftLine = {
  itemId: string;
  sku: string;
  name: string;
  qty: number;
  vendorName: string;
};

const STATUS_RANK: Record<RunwayStatus, number> = {
  out: 0,
  order_now: 1,
  order_soon: 2,
  covered: 3,
  watch: 4,
  thin: 5,
  healthy: 6,
  idle: 7,
};

export function isRunwayWindow(value: string): value is RunwayWindow {
  return (RUNWAY_WINDOWS as readonly string[]).includes(value);
}

export function isRunwayMultiplier(value: number): value is RunwayMultiplier {
  return (RUNWAY_MULTIPLIERS as readonly number[]).includes(value);
}

export function windowDays(window: RunwayWindow): number {
  if (window === "7d") return 7;
  if (window === "90d") return 90;
  return 30;
}

export function windowLookbackMs(window: RunwayWindow): number {
  return windowDays(window) * DAY_MS;
}

export function utcDayStart(at: number): number {
  return Math.floor(at / DAY_MS) * DAY_MS;
}

export function formatUtcDay(at: number): string {
  return new Date(utcDayStart(at)).toISOString().slice(0, 10);
}

export function yyyymmddToUtcMs(value: number): number {
  const year = Math.floor(value / 10000);
  const month = Math.floor((value % 10000) / 100) - 1;
  const day = value % 100;
  return Date.UTC(year, month, day);
}

export function observedShipRate(unitsShipped: number, days: number): number {
  if (!(days > 0)) return 0;
  return Math.max(0, unitsShipped) / days;
}

export function effectiveRate(input: {
  observed: number;
  baseline: number | null | undefined;
  multiplier: number;
}): { rate: number; rateSource: RunwayRateSource } {
  const multiplier = Number.isFinite(input.multiplier) && input.multiplier > 0 ? input.multiplier : 1;
  const baseline = input.baseline != null && input.baseline > 0 ? input.baseline : 0;
  if (baseline > 0) {
    return { rate: baseline * multiplier, rateSource: "baseline" };
  }
  const observed = Math.max(0, input.observed);
  if (observed > 0) {
    return { rate: observed * multiplier, rateSource: "observed" };
  }
  return { rate: 0, rateSource: "none" };
}

export function stackBomBurn(rates: Map<string, number>, boms: BomComponent[]): Map<string, number> {
  const next = new Map(rates);
  for (const [parentId, parentRate] of rates) {
    if (!(parentRate > 0)) continue;
    for (const line of boms) {
      if (line.parentItemId !== parentId || !(line.qty > 0)) continue;
      next.set(line.componentItemId, (next.get(line.componentItemId) ?? 0) + parentRate * line.qty);
    }
  }
  return next;
}

export function explodeMakeDemand(
  remainingByParent: Map<string, number>,
  boms: BomComponent[],
): Map<string, number> {
  const committed = new Map<string, number>();
  for (const line of boms) {
    const remaining = remainingByParent.get(line.parentItemId) ?? 0;
    if (!(remaining > 0) || !(line.qty > 0)) continue;
    committed.set(line.componentItemId, (committed.get(line.componentItemId) ?? 0) + remaining * line.qty);
  }
  return committed;
}

export function countShipDays(shippedAt: number[], windowStart: number, windowEnd: number): number {
  const days = new Set<number>();
  for (const at of shippedAt) {
    if (at < windowStart || at > windowEnd) continue;
    days.add(utcDayStart(at));
  }
  return days.size;
}

export function medianPositive(values: number[], fallback: number): number {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return fallback;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

export function clampLeadTimeMs(value: number, fallback = DEFAULT_LEAD_MS): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(MAX_LEAD_MS, Math.max(MIN_LEAD_MS, value));
}

export function pickLotsForCover(lots: RunwayLot[], sellable: number, asOfYmd: number): RunwayLot[] {
  const usable = lots
    .filter((lot) => lot.qty > 0 && !isExpiredLot(lot.expiresOn, asOfYmd))
    .sort((a, b) => {
      if (a.expiresOn == null && b.expiresOn == null) return 0;
      if (a.expiresOn == null) return 1;
      if (b.expiresOn == null) return -1;
      return a.expiresOn - b.expiresOn;
    });
  let remaining = Math.max(0, sellable);
  const out: RunwayLot[] = [];
  for (const lot of usable) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qty, remaining);
    out.push({ qty: take, expiresOn: lot.expiresOn });
    remaining -= take;
  }
  return out;
}

function cloneLots(lots: RunwayLot[]): RunwayLot[] {
  return lots.map((lot) => ({ ...lot }));
}

function lotTotal(lots: RunwayLot[]): number {
  return lots.reduce((sum, lot) => sum + Math.max(0, lot.qty), 0);
}

function dropExpired(lots: RunwayLot[], asOfYmd: number): number {
  let dropped = 0;
  for (const lot of lots) {
    if (lot.qty <= 0) continue;
    if (!isExpiredLot(lot.expiresOn, asOfYmd)) continue;
    dropped += lot.qty;
    lot.qty = 0;
  }
  return dropped;
}

function consumeLots(lots: RunwayLot[], amount: number): number {
  let remaining = Math.max(0, amount);
  const ordered = [...lots].sort((a, b) => {
    if (a.expiresOn == null && b.expiresOn == null) return 0;
    if (a.expiresOn == null) return 1;
    if (b.expiresOn == null) return -1;
    return a.expiresOn - b.expiresOn;
  });
  for (const lot of ordered) {
    if (remaining <= 0) break;
    if (lot.qty <= 0) continue;
    const take = Math.min(lot.qty, remaining);
    lot.qty -= take;
    remaining -= take;
  }
  return amount - remaining;
}

function inboundByDay(inbound: InboundReceipt[], asOf: number, horizonDays: number): Map<number, number> {
  const origin = utcDayStart(asOf);
  const byDay = new Map<number, number>();
  for (const row of inbound) {
    if (!(row.qty > 0)) continue;
    const index = Math.round((utcDayStart(row.at) - origin) / DAY_MS);
    if (index < 0) {
      byDay.set(0, (byDay.get(0) ?? 0) + row.qty);
      continue;
    }
    if (index > horizonDays) continue;
    byDay.set(index, (byDay.get(index) ?? 0) + row.qty);
  }
  return byDay;
}

function simulateCover(input: {
  sellable: number;
  rate: number;
  inbound: InboundReceipt[];
  lots?: RunwayLot[];
  asOf: number;
  horizonDays: number;
}): { stockoutAt: number | null; daysOfCover: number | null; horizonHit: boolean } {
  const asOf = utcDayStart(input.asOf);
  const rate = Math.max(0, input.rate);
  const horizonDays = input.horizonDays;
  const asOfYmd = utcYyyymmdd(new Date(asOf));

  let lots: RunwayLot[];
  if (input.lots && input.lots.length > 0) {
    lots = cloneLots(pickLotsForCover(input.lots, input.sellable, asOfYmd));
  } else {
    lots = [{ qty: Math.max(0, input.sellable), expiresOn: null }];
  }

  if (rate <= 0) {
    return { stockoutAt: null, daysOfCover: null, horizonHit: lotTotal(lots) > 0 };
  }

  if (lotTotal(lots) <= 0 && !(inboundByDay(input.inbound, asOf, horizonDays).get(0) ?? 0)) {
    return { stockoutAt: asOf, daysOfCover: 0, horizonHit: false };
  }

  const inboundDays = inboundByDay(input.inbound, asOf, horizonDays);

  for (let day = 0; day <= horizonDays; day += 1) {
    const dayStart = asOf + day * DAY_MS;
    const dayYmd = utcYyyymmdd(new Date(dayStart));
    dropExpired(lots, dayYmd);
    const arriving = inboundDays.get(day) ?? 0;
    if (arriving > 0) lots.push({ qty: arriving, expiresOn: null });
    const start = lotTotal(lots);
    if (start <= 0) {
      return { stockoutAt: dayStart, daysOfCover: day, horizonHit: false };
    }
    const daysLeft = start / rate;
    if (daysLeft < 1) {
      return {
        stockoutAt: dayStart + daysLeft * DAY_MS,
        daysOfCover: day + daysLeft,
        horizonHit: false,
      };
    }
    consumeLots(lots, rate);
  }

  return { stockoutAt: null, daysOfCover: null, horizonHit: true };
}

export function projectRunway(input: {
  sellable: number;
  rate: number;
  inbound?: InboundReceipt[];
  lots?: RunwayLot[];
  asOf: number;
  horizonDays?: number;
}): RunwayProjection {
  const inbound = input.inbound ?? [];
  const horizonDays = input.horizonDays ?? RUNWAY_HORIZON_DAYS;
  const withInbound = simulateCover({ ...input, inbound, horizonDays });
  const without = simulateCover({ ...input, inbound: [], horizonDays });
  const coveredByInbound =
    without.stockoutAt != null && (withInbound.stockoutAt == null || withInbound.stockoutAt > without.stockoutAt);
  return {
    daysOfCover: withInbound.daysOfCover,
    stockoutAt: withInbound.stockoutAt,
    firstGapAt: without.stockoutAt,
    coveredByInbound,
    horizonHit: withInbound.horizonHit,
  };
}

export function projectDaily(input: {
  sellable: number;
  rate: number;
  inbound?: InboundReceipt[];
  lots?: RunwayLot[];
  asOf: number;
  days?: number;
  shippedByDay?: Map<string, number>;
}): RunwayDailyPoint[] {
  const asOf = utcDayStart(input.asOf);
  const days = input.days ?? 14;
  const rate = Math.max(0, input.rate);
  const asOfYmd = utcYyyymmdd(new Date(asOf));
  let lots: RunwayLot[];
  if (input.lots && input.lots.length > 0) {
    lots = cloneLots(pickLotsForCover(input.lots, input.sellable, asOfYmd));
  } else {
    lots = [{ qty: Math.max(0, input.sellable), expiresOn: null }];
  }
  const inboundDays = inboundByDay(input.inbound ?? [], asOf, days);
  const points: RunwayDailyPoint[] = [];
  for (let day = 0; day < days; day += 1) {
    const dayStart = asOf + day * DAY_MS;
    const key = formatUtcDay(dayStart);
    const dayYmd = utcYyyymmdd(new Date(dayStart));
    dropExpired(lots, dayYmd);
    const arriving = inboundDays.get(day) ?? 0;
    if (arriving > 0) lots.push({ qty: arriving, expiresOn: null });
    if (rate > 0) consumeLots(lots, rate);
    points.push({
      day: key,
      shipped: input.shippedByDay?.get(key) ?? 0,
      onHand: Math.max(0, lotTotal(lots)),
      inbound: arriving,
    });
  }
  return points;
}

export function orderByAt(stockoutAt: number | null, leadTimeMs: number): number | null {
  if (stockoutAt == null) return null;
  return stockoutAt - clampLeadTimeMs(leadTimeMs);
}

export function suggestedRunwayQty(input: {
  rate: number;
  leadDays: number;
  bufferDays?: number;
  sellable: number;
  inbound: number;
}): number {
  const rate = Math.max(0, input.rate);
  if (!(rate > 0)) return 0;
  const leadDays = Math.max(0, input.leadDays);
  const bufferDays = input.bufferDays ?? RUNWAY_BUFFER_DAYS;
  const need = rate * (leadDays + bufferDays);
  const cover = Math.max(0, input.sellable) + Math.max(0, input.inbound);
  const gap = need - cover;
  if (gap <= 0) return 0;
  return Math.max(1, Math.ceil(gap));
}

export function isThinHistory(shipDays: number, rateSource: RunwayRateSource): boolean {
  return rateSource !== "baseline" && shipDays < THIN_SHIP_DAYS;
}

export function runwayStatus(input: {
  sellable: number;
  rate: number;
  asOf: number;
  stockoutAt: number | null;
  orderByAt: number | null;
  coveredByInbound: boolean;
  thin: boolean;
}): RunwayStatus {
  const sellable = Math.max(0, input.sellable);
  const rate = Math.max(0, input.rate);
  if (!(rate > 0)) return "idle";
  if (sellable <= 0 || (input.stockoutAt != null && input.stockoutAt <= input.asOf)) return "out";
  if (input.orderByAt != null && input.orderByAt <= input.asOf) return "order_now";
  if (input.orderByAt != null && input.orderByAt <= input.asOf + ORDER_SOON_DAYS * DAY_MS) return "order_soon";
  if (input.coveredByInbound && input.stockoutAt == null) return "covered";
  if (input.stockoutAt != null && input.stockoutAt <= input.asOf + WATCH_DAYS * DAY_MS) return "watch";
  if (input.thin) return "thin";
  return "healthy";
}

export function runsOutThisWeek(stockoutAt: number | null, asOf: number): boolean {
  if (stockoutAt == null) return false;
  return stockoutAt <= asOf + ORDER_SOON_DAYS * DAY_MS;
}

export function buildRunwayDraftLines(
  rows: Array<{
    itemId: string;
    sku: string;
    name: string;
    suggestedQty: number;
    status: RunwayStatus;
    coveredByOpenPo: boolean;
    lastVendorName?: string | null;
  }>,
  orgVendor?: string | null,
): RunwayDraftLine[] {
  const lines: RunwayDraftLine[] = [];
  for (const row of rows) {
    if (row.coveredByOpenPo) continue;
    if (row.status !== "out" && row.status !== "order_now") continue;
    if (row.suggestedQty <= 0) continue;
    lines.push({
      itemId: row.itemId,
      sku: row.sku,
      name: row.name,
      qty: row.suggestedQty,
      vendorName: pickReorderVendor([row.lastVendorName, orgVendor]),
    });
  }
  return lines;
}

export function buildRunwayBoard(input: {
  asOf: number;
  window: RunwayWindow;
  multiplier: number;
  items: RunwayItemFact[];
  boms?: BomComponent[];
  makeRemaining?: Map<string, number>;
}): RunwayBoard {
  const asOf = input.asOf;
  const days = windowDays(input.window);
  const boms = input.boms ?? [];
  const makeRemaining = input.makeRemaining ?? new Map<string, number>();
  const committed = explodeMakeDemand(makeRemaining, boms);

  const sellableByItem = new Map<string, ReturnType<typeof computeSellable> & { cover: number; lots?: RunwayLot[] }>();
  const asOfYmd = utcYyyymmdd(new Date(utcDayStart(asOf)));

  for (const item of input.items) {
    const base = computeSellable({
      onHand: item.onHand,
      held: item.held,
      remainingToPick: item.remainingToPick,
    });
    const afterMake = Math.max(0, base.sellable - (committed.get(item.itemId) ?? 0));
    let cover = afterMake;
    let lots: RunwayLot[] | undefined;
    if (item.trackExpiry && item.lots) {
      lots = pickLotsForCover(item.lots, afterMake, asOfYmd);
      cover = Math.min(afterMake, lots.reduce((sum, lot) => sum + lot.qty, 0));
    }
    sellableByItem.set(item.itemId, { ...base, sellable: afterMake, cover, lots });
  }

  const directRates = new Map<string, { rate: number; rateSource: RunwayRateSource; observed: number }>();
  for (const item of input.items) {
    const observed = observedShipRate(item.unitsShipped, days);
    const next = effectiveRate({
      observed,
      baseline: item.baselineShipRate,
      multiplier: input.multiplier,
    });
    directRates.set(item.itemId, { ...next, observed });
  }

  const burnRates = stackBomBurn(new Map([...directRates].map(([id, row]) => [id, row.rate])), boms);

  const rows: RunwayRow[] = input.items.map((item) => {
    const stock = sellableByItem.get(item.itemId)!;
    const direct = directRates.get(item.itemId)!;
    const burn = burnRates.get(item.itemId) ?? direct.rate;
    const inboundQty = item.inbound.reduce((sum, row) => sum + Math.max(0, row.qty), 0);
    const inboundAt =
      item.inbound.length === 0
        ? null
        : item.inbound.reduce((soonest, row) => (soonest == null || row.at < soonest ? row.at : soonest), null as number | null);
    const projection = projectRunway({
      sellable: stock.cover,
      rate: burn,
      inbound: item.inbound,
      lots: stock.lots,
      asOf,
    });
    const leadTimeMs = clampLeadTimeMs(item.leadTimeMs);
    const orderBy = orderByAt(projection.stockoutAt, leadTimeMs);
    const thin = isThinHistory(item.shipDays, direct.rateSource);
    const status = runwayStatus({
      sellable: stock.cover,
      rate: burn,
      asOf,
      stockoutAt: projection.stockoutAt,
      orderByAt: orderBy,
      coveredByInbound: projection.coveredByInbound,
      thin,
    });
    const shippedByDay = new Map((item.dailyShipped ?? []).map((row) => [row.day, row.qty]));
    return {
      itemId: item.itemId,
      sku: item.sku,
      name: item.name,
      onHand: stock.onHand,
      held: stock.held,
      remainingToPick: stock.remainingToPick,
      sellable: stock.cover,
      observedRate: direct.observed,
      baselineRate: item.baselineShipRate != null && item.baselineShipRate > 0 ? item.baselineShipRate : null,
      burnRate: burn,
      rateSource: direct.rateSource,
      inboundQty,
      inboundAt,
      daysOfCover: projection.daysOfCover,
      stockoutAt: projection.stockoutAt,
      firstGapAt: projection.firstGapAt,
      orderByAt: orderBy,
      leadTimeMs,
      suggestedQty: suggestedRunwayQty({
        rate: burn,
        leadDays: leadTimeMs / DAY_MS,
        sellable: stock.cover,
        inbound: inboundQty,
      }),
      coveredByInbound: projection.coveredByInbound,
      coveredByOpenPo: item.coveredByOpenPo,
      lastVendorName: item.lastVendorName ?? null,
      status,
      thin,
      shipDays: item.shipDays,
      unitsShipped: item.unitsShipped,
      daily: projectDaily({
        sellable: stock.cover,
        rate: burn,
        inbound: item.inbound,
        lots: stock.lots,
        asOf,
        days: Math.min(14, days),
        shippedByDay,
      }),
    };
  });

  rows.sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    const aDays = a.daysOfCover ?? Number.POSITIVE_INFINITY;
    const bDays = b.daysOfCover ?? Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;
    return a.sku.localeCompare(b.sku);
  });

  const kpis: RunwayKpis = {
    out: rows.filter((row) => row.status === "out").length,
    orderNow: rows.filter((row) => row.status === "order_now").length,
    covered: rows.filter((row) => row.status === "covered").length,
    idle: rows.filter((row) => row.status === "idle").length,
  };

  return {
    asOf,
    window: input.window,
    multiplier: input.multiplier,
    kpis,
    rows,
  };
}
