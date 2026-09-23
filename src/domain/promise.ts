import { LIVE_PACE_MIN_MS, LIVE_PACE_WINDOW_MS } from "./live";
import { startOfZonedDay, zonedParts } from "./time-zone";

/** Carrier pickup, minutes from local midnight. 3:00pm. */
export const DEFAULT_CUTOFF_MINUTES = 15 * 60;
/** Used until the floor has 15 minutes of work in the current pace window. */
export const BENCH_UNITS_PER_HOUR = 40;
/** Dock to a pickable shelf after a dated receipt lands. */
export const INBOUND_SLACK_MS = 4 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_SHIP_DAYS = 21;

export const PROMISE_CODES = ["leaves_today", "next_pickup", "inbound", "short"] as const;
export type PromiseCode = (typeof PROMISE_CODES)[number];

export const PROMISE_ORDER_STATUSES = ["draft", "open", "picking", "picked", "packing", "packed"] as const;

export type PromiseLot = { qty: number; expiresOn: number | null };
export type PromiseInbound = { at: number; qty: number; ref: string };

export type PromiseQuote = {
  qty: number;
  code: PromiseCode;
  promisedAt: number | null;
  shipDay: string | null;
  reason: string;
  waitingOn: string | null;
  expiryBlocked: number;
  unitsAhead: number;
};

export type PromiseQuoteInput = {
  qty: number;
  sellable: number;
  lots?: PromiseLot[];
  inbound?: PromiseInbound[];
  aheadUnits?: number;
  pacePerHour?: number | null;
  now: number;
  timeZone: string;
  cutoffMinutes?: number;
};

type QuoteResult = PromiseQuote & {
  consumedSellable: number;
  consumedShipDay: number;
  consumedInbound: PromiseInbound[];
};

export type PromiseOrderLineInput = {
  itemId: string;
  sku: string;
  name: string;
  /** Original line qty, used when the line is already picked. */
  qty: number;
  /** Still to pick. Already-picked units do not consume the shelf. */
  pickQty: number;
};

export type PromiseOrderInput = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  createdAt: number;
  /** Carrier already has the goods. Omitted from the board when nothing is left to pick. */
  handedOff?: boolean;
  lines: PromiseOrderLineInput[];
};

export type PromiseStock = {
  itemId: string;
  sku: string;
  name: string;
  sellable: number;
  lots?: PromiseLot[];
  inbound?: PromiseInbound[];
};

export type PromiseBoardInput = {
  now: number;
  timeZone: string;
  cutoffMinutes?: number;
  pacePerHour?: number | null;
  orders: PromiseOrderInput[];
  stock: PromiseStock[];
};

export type PromiseLine = {
  itemId: string;
  sku: string;
  name: string;
  qty: number;
  code: PromiseCode;
  promisedAt: number | null;
  shipDay: string | null;
  reason: string;
  waitingOn: string | null;
  expiryBlocked: number;
};

export type PromiseOrder = {
  orderId: string;
  number: string;
  customerName: string;
  status: string;
  createdAt: number;
  units: number;
  unitsAhead: number;
  code: PromiseCode;
  promisedAt: number | null;
  shipDay: string | null;
  reason: string;
  waitingOn: string | null;
  slowSku: string | null;
  /** Some lines could leave on an earlier pickup than the order. */
  split: boolean;
  lines: PromiseLine[];
};

export type PromiseKpis = {
  leavesToday: number;
  nextPickup: number;
  inbound: number;
  short: number;
};

export type PromiseBoard = {
  kind: "rackline.promise";
  reservesStock: false;
  asOf: number;
  timeZone: string;
  cutoffMinutes: number;
  cutoffLabel: string;
  pacePerHour: number | null;
  paceAssumed: boolean;
  benchUnitsPerHour: number;
  inboundSlackHours: number;
  notice: string;
  kpis: PromiseKpis;
  orders: PromiseOrder[];
};

export type PromiseAsk = PromiseQuote & {
  kind: "rackline.promise.ask";
  reservesStock: false;
  sku: string;
  name: string;
  itemId: string;
  asOf: number;
  timeZone: string;
  cutoffMinutes: number;
  cutoffLabel: string;
  pacePerHour: number | null;
  paceAssumed: boolean;
  benchUnitsPerHour: number;
  notice: string;
};

const NOTICE = "A promise does not reserve inventory. ATP is reserved when pick starts.";

const HANDED_OFF = new Set(["in_transit", "delivered", "exception", "failure", "return_to_sender", "cancelled", "error"]);

export function isHandedOff(trackerStatus: string | null | undefined): boolean {
  if (!trackerStatus) return false;
  return HANDED_OFF.has(trackerStatus);
}

function unitsWord(n: number): string {
  return `${n} ${n === 1 ? "unit" : "units"}`;
}

const CODE_RANK: Record<PromiseCode, number> = {
  short: 0,
  inbound: 1,
  next_pickup: 2,
  leaves_today: 3,
};

type Pool = {
  itemId: string;
  sku: string;
  name: string;
  sellable: number;
  lots: PromiseLot[];
  inbound: PromiseInbound[];
};

export function parsePromiseQty(raw: unknown): number {
  const qty = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
  if (!Number.isInteger(qty) || qty <= 0 || qty > 100_000) throw new Error("qty must be a positive integer");
  return qty;
}

export function parsePromiseSku(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("sku is required");
  return raw.trim();
}

/** `HH:MM` (24-hour) or minutes from midnight. */
export function parseCutoff(raw: unknown): number {
  if (typeof raw === "number" && Number.isInteger(raw)) return assertCutoff(raw);
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Cutoff must be HH:MM");
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return assertCutoff(Number(trimmed));
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error("Cutoff must be HH:MM");
  return assertCutoff(Number(match[1]) * 60 + Number(match[2]));
}

function assertCutoff(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 23 * 60 + 59) {
    throw new Error("Cutoff must be HH:MM");
  }
  return minutes;
}

export function cutoffLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function localYmd(ms: number, timeZone: string): number {
  const parts = zonedParts(ms, timeZone);
  return parts.year * 10000 + parts.month * 100 + parts.day;
}

export function formatShipDay(ymd: number): string {
  const year = Math.floor(ymd / 10000);
  const month = String(Math.floor((ymd % 10000) / 100)).padStart(2, "0");
  const day = String(ymd % 100).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatPickupLabel(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

/** Next carrier cutoff at or after `readyAt`. */
export function nextPickup(readyAt: number, timeZone: string, cutoffMinutes: number): number {
  let dayStart = startOfZonedDay(readyAt, timeZone);
  for (let i = 0; i < 4; i++) {
    const cutoff = dayStart + cutoffMinutes * 60_000;
    if (readyAt <= cutoff) return cutoff;
    dayStart = startOfZonedDay(dayStart + 36 * 60 * 60 * 1000, timeZone);
  }
  return dayStart + cutoffMinutes * 60_000;
}

/**
 * Units per hour from signed floor touches.
 * Blank until the oldest touch in the window is at least 15 minutes ago.
 */
export function floorPace(touches: { at: number; qty: number }[], now: number, dayStart: number): number | null {
  const windowStart = Math.max(dayStart, now - LIVE_PACE_WINDOW_MS);
  const paceTouches = touches.filter((touch) => touch.at >= windowStart && touch.at <= now && touch.qty !== 0);
  if (!paceTouches.length) return null;
  const first = paceTouches.reduce((min, touch) => Math.min(min, touch.at), Number.POSITIVE_INFINITY);
  if (now - first < LIVE_PACE_MIN_MS) return null;
  const elapsed = now - Math.max(windowStart, first);
  if (!(elapsed > 0)) return null;
  const units = paceTouches.reduce((sum, touch) => sum + touch.qty, 0);
  const rate = units / (elapsed / LIVE_PACE_WINDOW_MS);
  return rate > 0 ? rate : null;
}

function usableFor(shipDay: number, sellable: number, lots: PromiseLot[]): { usable: number; expiryBlocked: number } {
  const dated = lots.reduce((sum, lot) => sum + Math.max(0, lot.qty), 0);
  const undated = Math.max(0, sellable - dated);
  let lasting = 0;
  let expiryBlocked = 0;
  for (const lot of lots) {
    const qty = Math.max(0, lot.qty);
    if (lot.expiresOn == null || lot.expiresOn >= shipDay) lasting += qty;
    else expiryBlocked += qty;
  }
  return { usable: undated + lasting, expiryBlocked };
}

function uniqueRefs(rows: PromiseInbound[]): string | null {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const row of rows) {
    const ref = row.ref.trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs.length ? refs.join(", ") : null;
}

function leavePhrase(pickup: number, now: number, timeZone: string, cutoffMinutes: number): { today: boolean; phrase: string } {
  const today = localYmd(pickup, timeZone) === localYmd(now, timeZone);
  if (today) return { today: true, phrase: `today's ${cutoffLabel(cutoffMinutes)} pickup` };
  return { today: false, phrase: formatPickupLabel(pickup, timeZone) };
}

export function quotePromise(input: PromiseQuoteInput): QuoteResult {
  const qty = parsePromiseQty(input.qty);
  const cutoffMinutes = input.cutoffMinutes == null ? DEFAULT_CUTOFF_MINUTES : assertCutoff(input.cutoffMinutes);
  const aheadUnits = Math.max(0, input.aheadUnits ?? 0);
  const paceAssumed = !(input.pacePerHour != null && input.pacePerHour > 0);
  const pace = paceAssumed ? BENCH_UNITS_PER_HOUR : input.pacePerHour!;
  const sellable = Math.max(0, input.sellable);
  const lots = (input.lots ?? []).map((lot) => ({ qty: Math.max(0, lot.qty), expiresOn: lot.expiresOn }));
  const inbound = (input.inbound ?? [])
    .map((row) => ({ at: row.at, qty: Math.max(0, row.qty), ref: row.ref }))
    .filter((row) => row.qty > 0)
    .sort((a, b) => a.at - b.at || a.ref.localeCompare(b.ref));

  const hours = (units: number) => (units / pace) * HOUR_MS;
  let shipDay = localYmd(input.now, input.timeZone);

  for (let pass = 0; pass < MAX_SHIP_DAYS; pass++) {
    const { usable, expiryBlocked } = usableFor(shipDay, sellable, lots);
    const fromShelf = Math.min(qty, usable);
    const need = qty - fromShelf;
    const taken: PromiseInbound[] = [];
    let covered = 0;
    let lastArrival = input.now;
    if (need > 0) {
      for (const row of inbound) {
        if (covered >= need) break;
        const take = Math.min(row.qty, need - covered);
        if (take <= 0) continue;
        const arrive = Math.max(input.now, row.at) + INBOUND_SLACK_MS;
        taken.push({ at: row.at, qty: take, ref: row.ref });
        if (arrive > lastArrival) lastArrival = arrive;
        covered += take;
      }
    }
    const shortfall = need - covered;
    const waitingOn = uniqueRefs(taken);
    if (shortfall > 0) {
      const parts: string[] = [];
      if (expiryBlocked > 0) parts.push(`${expiryBlocked} on hand expire before they can ship.`);
      if (fromShelf > 0 && expiryBlocked > 0) parts.push(`${fromShelf} can still ship.`);
      else if (fromShelf > 0) parts.push(`${fromShelf} on the shelf.`);
      if (waitingOn && covered > 0) parts.push(`${waitingOn} covers ${covered}.`);
      const gap = fromShelf > 0 || covered > 0 ? `the other ${shortfall}` : String(shortfall);
      parts.push(`Nothing dated covers ${gap}.`);
      return {
        qty,
        code: "short",
        promisedAt: null,
        shipDay: null,
        reason: parts.join(" "),
        waitingOn,
        expiryBlocked,
        unitsAhead: aheadUnits,
        consumedSellable: fromShelf,
        consumedShipDay: shipDay,
        consumedInbound: taken,
      };
    }

    const shelfFinish = input.now + hours(aheadUnits + fromShelf);
    const readyAt = need === 0 ? shelfFinish : Math.max(shelfFinish, lastArrival) + hours(need);
    const pickup = nextPickup(Math.max(readyAt, input.now), input.timeZone, cutoffMinutes);
    const pickupDay = localYmd(pickup, input.timeZone);
    if (pickupDay !== shipDay) {
      shipDay = pickupDay;
      continue;
    }

    const { today, phrase } = leavePhrase(pickup, input.now, input.timeZone, cutoffMinutes);
    const expiry =
      expiryBlocked > 0 && fromShelf < qty ? `${expiryBlocked} on hand expire before that pickup. ` : "";
    let reason: string;
    let code: PromiseCode;
    if (need > 0) {
      code = "inbound";
      const cover = !waitingOn
        ? "Dated inbound covers it after the dock."
        : fromShelf > 0
          ? `${waitingOn} covers the rest after the dock.`
          : `${waitingOn} covers ${qty} after the dock.`;
      const shelf = fromShelf > 0 ? `Short ${need} on the shelf. ` : "None on the shelf. ";
      reason = `${expiry}${shelf}${cover} Leaves ${today ? `on ${phrase}` : phrase}.`;
    } else if (today) {
      code = "leaves_today";
      const behind = aheadUnits > 0 ? `, behind ${unitsWord(aheadUnits)}` : "";
      reason = `On the shelf${behind}. Leaves on ${phrase}.`;
    } else {
      code = "next_pickup";
      const behind = aheadUnits > 0 ? `, behind ${unitsWord(aheadUnits)}` : "";
      reason = `On the shelf${behind}. Leaves ${phrase}.`;
    }
    return {
      qty,
      code,
      promisedAt: pickup,
      shipDay: formatShipDay(pickupDay),
      reason,
      waitingOn: need > 0 ? waitingOn : null,
      expiryBlocked,
      unitsAhead: aheadUnits,
      consumedSellable: fromShelf,
      consumedShipDay: shipDay,
      consumedInbound: taken,
    };
  }

  return {
    qty,
    code: "short",
    promisedAt: null,
    shipDay: null,
    reason: "Nothing dated covers this inside 21 days.",
    waitingOn: null,
    expiryBlocked: 0,
    unitsAhead: aheadUnits,
    consumedSellable: 0,
    consumedShipDay: shipDay,
    consumedInbound: [],
  };
}

function consumeShelf(pool: Pool, take: number, shipDay: number) {
  let left = Math.max(0, take);
  const lasting = pool.lots
    .filter((lot) => lot.expiresOn != null && lot.expiresOn >= shipDay)
    .sort((a, b) => a.expiresOn! - b.expiresOn!);
  for (const lot of lasting) {
    if (left <= 0) break;
    const use = Math.min(lot.qty, left);
    lot.qty -= use;
    left -= use;
  }
  const undated = pool.lots.filter((lot) => lot.expiresOn == null);
  for (const lot of undated) {
    if (left <= 0) break;
    const use = Math.min(lot.qty, left);
    lot.qty -= use;
    left -= use;
  }
  pool.lots = pool.lots.filter((lot) => lot.qty > 0);
  pool.sellable = Math.max(0, pool.sellable - take);
}

function consumeInbound(pool: Pool, used: PromiseInbound[]) {
  for (const row of used) {
    let left = row.qty;
    for (const have of pool.inbound) {
      if (left <= 0) break;
      if (have.ref !== row.ref || have.at !== row.at) continue;
      const take = Math.min(have.qty, left);
      have.qty -= take;
      left -= take;
    }
  }
  pool.inbound = pool.inbound.filter((row) => row.qty > 0);
}

function emptyPool(itemId: string, sku: string, name: string): Pool {
  return { itemId, sku, name, sellable: 0, lots: [], inbound: [] };
}

function clonePools(stock: PromiseStock[]): Map<string, Pool> {
  const pools = new Map<string, Pool>();
  for (const row of stock) {
    pools.set(row.itemId, {
      itemId: row.itemId,
      sku: row.sku,
      name: row.name,
      sellable: Math.max(0, row.sellable),
      lots: (row.lots ?? []).map((lot) => ({ qty: Math.max(0, lot.qty), expiresOn: lot.expiresOn })),
      inbound: (row.inbound ?? []).map((inbound) => ({ at: inbound.at, qty: Math.max(0, inbound.qty), ref: inbound.ref })),
    });
  }
  return pools;
}

function readyOrder(order: PromiseOrderInput, now: number, timeZone: string, cutoffMinutes: number, unitsAhead: number): PromiseOrder {
  const pickup = nextPickup(now, timeZone, cutoffMinutes);
  const { today, phrase } = leavePhrase(pickup, now, timeZone, cutoffMinutes);
  const units = order.lines.reduce((sum, line) => sum + Math.max(0, line.qty), 0);
  const code: PromiseCode = today ? "leaves_today" : "next_pickup";
  const reason = today ? `Picked. Leaves on ${phrase}.` : `Picked. Leaves ${phrase}.`;
  return {
    orderId: order.id,
    number: order.number,
    customerName: order.customerName,
    status: order.status,
    createdAt: order.createdAt,
    units,
    unitsAhead,
    code,
    promisedAt: pickup,
    shipDay: formatShipDay(localYmd(pickup, timeZone)),
    reason,
    waitingOn: null,
    slowSku: null,
    split: false,
    lines: order.lines.map((line) => ({
      itemId: line.itemId,
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      code,
      promisedAt: pickup,
      shipDay: formatShipDay(localYmd(pickup, timeZone)),
      reason,
      waitingOn: null,
      expiryBlocked: 0,
    })),
  };
}

function toLine(row: PromiseOrderLineInput, quote: QuoteResult): PromiseLine {
  return {
    itemId: row.itemId,
    sku: row.sku,
    name: row.name,
    qty: row.pickQty,
    code: quote.code,
    promisedAt: quote.promisedAt,
    shipDay: quote.shipDay,
    reason: `${row.sku}: ${quote.reason}`,
    waitingOn: quote.waitingOn,
    expiryBlocked: quote.expiryBlocked,
  };
}

function rollup(order: PromiseOrderInput, lines: PromiseLine[], unitsAhead: number, units: number): PromiseOrder {
  const short = lines.find((line) => line.code === "short");
  const slowest =
    short ??
    lines.reduce((best, line) => ((line.promisedAt ?? 0) >= (best.promisedAt ?? 0) ? line : best));
  const split = lines.some((line) => line.code === "leaves_today") && lines.some((line) => line.code !== "leaves_today");
  return {
    orderId: order.id,
    number: order.number,
    customerName: order.customerName,
    status: order.status,
    createdAt: order.createdAt,
    units,
    unitsAhead,
    code: slowest.code,
    promisedAt: slowest.promisedAt,
    shipDay: slowest.shipDay,
    reason: slowest.reason,
    waitingOn: slowest.waitingOn,
    slowSku: slowest.sku,
    split,
    lines,
  };
}

export type PromisePlan = {
  board: PromiseBoard;
  pools: Map<string, Pool>;
  pace: number;
  paceAssumed: boolean;
  cutoffMinutes: number;
  unitsAhead: number;
};

export function planPromises(input: PromiseBoardInput): PromisePlan {
  const cutoffMinutes = input.cutoffMinutes == null ? DEFAULT_CUTOFF_MINUTES : assertCutoff(input.cutoffMinutes);
  const paceAssumed = !(input.pacePerHour != null && input.pacePerHour > 0);
  const pace = paceAssumed ? BENCH_UNITS_PER_HOUR : input.pacePerHour!;
  const pools = clonePools(input.stock);
  const fifo = [...input.orders].sort((a, b) => a.createdAt - b.createdAt || a.number.localeCompare(b.number));
  const planned: PromiseOrder[] = [];
  let unitsAhead = 0;

  for (const order of fifo) {
    const pickLines = order.lines.filter((line) => line.pickQty > 0);
    if (pickLines.length === 0) {
      if (order.lines.length === 0 || order.handedOff) continue;
      planned.push(readyOrder(order, input.now, input.timeZone, cutoffMinutes, unitsAhead));
      continue;
    }
    const lines: PromiseLine[] = [];
    let lineAhead = unitsAhead;
    for (const line of pickLines) {
      const pool = pools.get(line.itemId) ?? emptyPool(line.itemId, line.sku, line.name);
      if (!pools.has(line.itemId)) pools.set(line.itemId, pool);
      const quote = quotePromise({
        qty: line.pickQty,
        sellable: pool.sellable,
        lots: pool.lots,
        inbound: pool.inbound,
        aheadUnits: lineAhead,
        pacePerHour: input.pacePerHour,
        now: input.now,
        timeZone: input.timeZone,
        cutoffMinutes,
      });
      consumeShelf(pool, quote.consumedSellable, quote.consumedShipDay);
      consumeInbound(pool, quote.consumedInbound);
      lines.push(toLine(line, quote));
      lineAhead += line.pickQty;
    }
    const units = pickLines.reduce((sum, line) => sum + line.pickQty, 0);
    planned.push(rollup(order, lines, unitsAhead, units));
    unitsAhead = lineAhead;
  }

  planned.sort((a, b) => {
    const byCode = CODE_RANK[a.code] - CODE_RANK[b.code];
    if (byCode !== 0) return byCode;
    const at = (a.promisedAt ?? Number.MAX_SAFE_INTEGER) - (b.promisedAt ?? Number.MAX_SAFE_INTEGER);
    if (at !== 0) return at;
    return a.createdAt - b.createdAt || a.number.localeCompare(b.number);
  });

  const kpis: PromiseKpis = { leavesToday: 0, nextPickup: 0, inbound: 0, short: 0 };
  for (const order of planned) {
    if (order.code === "leaves_today") kpis.leavesToday += 1;
    else if (order.code === "next_pickup") kpis.nextPickup += 1;
    else if (order.code === "inbound") kpis.inbound += 1;
    else kpis.short += 1;
  }

  return {
    board: {
      kind: "rackline.promise",
      reservesStock: false,
      asOf: input.now,
      timeZone: input.timeZone,
      cutoffMinutes,
      cutoffLabel: cutoffLabel(cutoffMinutes),
      pacePerHour: paceAssumed ? null : pace,
      paceAssumed,
      benchUnitsPerHour: BENCH_UNITS_PER_HOUR,
      inboundSlackHours: INBOUND_SLACK_MS / HOUR_MS,
      notice: NOTICE,
      kpis,
      orders: planned,
    },
    pools,
    pace,
    paceAssumed,
    cutoffMinutes,
    unitsAhead,
  };
}

export function askPromise(
  plan: PromisePlan,
  ask: { itemId: string; sku: string; name: string; qty: number },
  now: number,
  timeZone: string,
  pacePerHour: number | null,
): PromiseAsk {
  const pool = plan.pools.get(ask.itemId) ?? emptyPool(ask.itemId, ask.sku, ask.name);
  const quote = quotePromise({
    qty: ask.qty,
    sellable: pool.sellable,
    lots: pool.lots,
    inbound: pool.inbound,
    aheadUnits: plan.unitsAhead,
    pacePerHour,
    now,
    timeZone,
    cutoffMinutes: plan.cutoffMinutes,
  });
  return {
    kind: "rackline.promise.ask",
    reservesStock: false,
    sku: ask.sku,
    name: ask.name,
    itemId: ask.itemId,
    qty: quote.qty,
    code: quote.code,
    promisedAt: quote.promisedAt,
    shipDay: quote.shipDay,
    reason: quote.reason,
    waitingOn: quote.waitingOn,
    expiryBlocked: quote.expiryBlocked,
    unitsAhead: quote.unitsAhead,
    asOf: now,
    timeZone,
    cutoffMinutes: plan.cutoffMinutes,
    cutoffLabel: cutoffLabel(plan.cutoffMinutes),
    pacePerHour: plan.paceAssumed ? null : plan.pace,
    paceAssumed: plan.paceAssumed,
    benchUnitsPerHour: BENCH_UNITS_PER_HOUR,
    notice: NOTICE,
  };
}
