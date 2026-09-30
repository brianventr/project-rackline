import { DEFAULT_CUTOFF_MINUTES, cutoffLabel, localYmd, nextPickup, parseCutoff, type PromiseCode } from "./promise";
import { startOfZonedDay } from "./time-zone";

/** Carrier company ("UPS", "USPS", …) → pickup cutoff in minutes from local midnight. `*` is any carrier. */
export type CarrierCutoffs = Record<string, number>;

export const ANY_CARRIER = "*";

export function parseCarrierCutoffs(json: string | null | undefined): CarrierCutoffs {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const out: CarrierCutoffs = {};
    for (const [carrier, value] of Object.entries(raw)) {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 24 * 60) out[carrier] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** `{ UPS: "17:00", "*": "15:00" }` from the cutoffs editor; blank clears a carrier. */
export function cutoffsFromInput(input: Record<string, unknown>): CarrierCutoffs {
  const out: CarrierCutoffs = {};
  for (const [carrier, value] of Object.entries(input)) {
    const key = carrier.trim();
    if (!key || value == null || value === "") continue;
    out[key] = parseCutoff(value);
  }
  return out;
}

export function cutoffFor(cutoffs: CarrierCutoffs, carrier: string | null): number {
  return (carrier ? cutoffs[carrier] : undefined) ?? cutoffs[ANY_CARRIER] ?? DEFAULT_CUTOFF_MINUTES;
}

export type WavePlanOrder = {
  id: string;
  number: string;
  clientId: string | null;
  /** Carrier company the order will ship with, when known. */
  carrier: string | null;
  /** Zones its lines pick from; more than one makes it a multi-zone order. */
  zoneIds: string[];
  units: number;
  promise: { code: PromiseCode; promisedAt: number | null; reason: string } | null;
};

export type WaveUrgency = "missed" | "now" | "today" | "later";

export type WaveGroup = {
  key: string;
  carrier: string | null;
  cutoffAt: number;
  cutoffLabel: string;
  urgency: WaveUrgency;
  minutesLeft: number;
  /** Some orders were promised on an earlier pickup that has already gone. */
  missedToday: boolean;
  zoneId: string | null;
  clientId: string | null;
  orderIds: string[];
  numbers: string[];
  units: number;
};

export type WaveWaiting = { orderId: string; number: string; reason: string };

export type WavePlan = { groups: WaveGroup[]; waiting: WaveWaiting[] };

/** Within this window a cutoff reads as "release now". */
export const RELEASE_NOW_MINUTES = 90;

export function waveUrgency(cutoffAt: number, now: number, timeZone: string, missed: boolean): WaveUrgency {
  if (missed) return "missed";
  if (cutoffAt - now <= RELEASE_NOW_MINUTES * 60_000) return "now";
  return localYmd(cutoffAt, timeZone) === localYmd(now, timeZone) ? "today" : "later";
}

/**
 * This carrier's pickup on the day the Promise board says the order ships. When that pickup has
 * already gone, the next one, and `missed` when the promise was for today.
 */
export function carrierPickup(
  promisedAt: number | null,
  cutoffMinutes: number,
  now: number,
  timeZone: string,
): { at: number; missed: boolean } {
  const earliest = nextPickup(now, timeZone, cutoffMinutes);
  if (promisedAt == null) return { at: earliest, missed: false };
  const onShipDay = startOfZonedDay(promisedAt, timeZone) + cutoffMinutes * 60_000;
  if (onShipDay >= now) return { at: onShipDay, missed: false };
  return { at: earliest, missed: localYmd(promisedAt, timeZone) === localYmd(now, timeZone) };
}

/**
 * Groups open, un-waved orders into the waves a planner would release: one per carrier pickup,
 * pick zone, and 3PL client, earliest cutoff first. Orders the Promise board says are short or
 * waiting on inbound stay off the plan so a wave never releases work the floor cannot finish.
 */
export function planWaves(input: {
  now: number;
  timeZone: string;
  cutoffs: CarrierCutoffs;
  orders: WavePlanOrder[];
}): WavePlan {
  const { now, timeZone, cutoffs } = input;
  const groups = new Map<string, WaveGroup>();
  const waiting: WaveWaiting[] = [];

  for (const order of input.orders) {
    if (order.promise && (order.promise.code === "short" || order.promise.code === "inbound")) {
      waiting.push({ orderId: order.id, number: order.number, reason: order.promise.reason });
      continue;
    }
    const minutes = cutoffFor(cutoffs, order.carrier);
    const { at, missed } = carrierPickup(order.promise?.promisedAt ?? null, minutes, now, timeZone);
    const zoneId = order.zoneIds.length === 1 ? order.zoneIds[0]! : null;
    const key = [at, order.carrier ?? ANY_CARRIER, zoneId ?? "multi", order.clientId ?? "own"].join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        carrier: order.carrier,
        cutoffAt: at,
        cutoffLabel: cutoffLabel(minutes),
        urgency: "later",
        minutesLeft: Math.round((at - now) / 60_000),
        missedToday: false,
        zoneId,
        clientId: order.clientId,
        orderIds: [],
        numbers: [],
        units: 0,
      };
      groups.set(key, group);
    }
    group.orderIds.push(order.id);
    group.numbers.push(order.number);
    group.units += order.units;
    group.missedToday ||= missed;
  }

  const list = [...groups.values()].map((group) => ({
    ...group,
    urgency: waveUrgency(group.cutoffAt, now, timeZone, group.missedToday),
  }));
  list.sort((a, b) => a.cutoffAt - b.cutoffAt || b.units - a.units || a.key.localeCompare(b.key));
  return { groups: list, waiting };
}
