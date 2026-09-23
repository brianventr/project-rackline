import { buildPickMapStops, type PickMapLine, type PickMapLocation } from "./pick-map";

/**
 * Guided pick: one line at one bay per screen, in the same walk order as the pick map and the
 * printed pick list (aisle → rack → bay → level, from `buildPickMapStops`). Lines with no bay to
 * send the picker to come last.
 */

/** The order-line fields guided pick reads. `OrderLine` from the API fits as is. */
export type GuidedPickLine = {
  id: string;
  sku: string;
  itemName: string;
  imageUrl?: string | null;
  qty: number;
  qtyPicked?: number | null;
  /** Server-computed; falls back to `qty - qtyPicked` when missing. */
  remaining?: number | null;
  trackLot?: boolean | null;
  trackSerial?: boolean | null;
  catchWeight?: boolean | null;
  suggestedLocation?: { locationId: string; locationCode: string } | null;
  allocations?: { locationId: string; locationCode: string; qty: number }[] | null;
};

/** The bay fields guided pick reads. `Location` from the API fits as is. */
export type GuidedPickLocation = PickMapLocation;

/** One screen of guided pick: go to this bay, pick this qty of this SKU. */
export type PickStop = {
  lineId: string;
  sku: string;
  itemName: string;
  imageUrl: string | null;
  qty: number;
  /** Null when nothing points at a bay for this qty (no reservation, no stocked pick face). */
  locationId: string | null;
  locationCode: string | null;
  trackLot: boolean;
  trackSerial: boolean;
  catchWeight: boolean;
};

/** Units still to pick on a line, never below zero. */
export function lineRemaining(line: Pick<GuidedPickLine, "qty" | "qtyPicked" | "remaining">): number {
  const raw =
    typeof line.remaining === "number" && Number.isFinite(line.remaining)
      ? line.remaining
      : (line.qty ?? 0) - (line.qtyPicked ?? 0);
  return Math.max(0, Math.floor(raw));
}

type Grab = { locationId: string; locationCode: string; qty: number };

/**
 * Where each remaining unit of a line should come from. Reserved bays first (capped at what is
 * left, so a stale reservation never asks for more than the order needs); whatever the
 * reservations do not cover goes to the suggested pick face, or to "no bay" when there is none.
 */
function lineGrabs(line: GuidedPickLine, remaining: number): { grabs: Grab[]; unlocated: number } {
  const grabs: Grab[] = [];
  let left = remaining;
  for (const row of line.allocations ?? []) {
    if (left <= 0) break;
    if (!row.locationId || !(row.qty > 0)) continue;
    const take = Math.min(row.qty, left);
    grabs.push({ locationId: row.locationId, locationCode: row.locationCode, qty: take });
    left -= take;
  }
  if (left > 0 && line.suggestedLocation?.locationId) {
    grabs.push({
      locationId: line.suggestedLocation.locationId,
      locationCode: line.suggestedLocation.locationCode,
      qty: left,
    });
    left = 0;
  }
  return { grabs, unlocated: left };
}

function asStop(line: GuidedPickLine, qty: number, locationId: string | null, locationCode: string | null): PickStop {
  return {
    lineId: line.id,
    sku: line.sku,
    itemName: line.itemName,
    imageUrl: line.imageUrl ?? null,
    qty,
    locationId,
    locationCode,
    trackLot: Boolean(line.trackLot),
    trackSerial: Boolean(line.trackSerial),
    catchWeight: Boolean(line.catchWeight),
  };
}

/**
 * Remaining lines as guided-pick stops, one per line per bay, in walk order. Reuses the pick map's
 * walk (`buildPickMapStops`) so the stop order matches the map and the printed pick list. Several
 * lines at one bay keep their order-line order. Bays missing from `locations` (a reservation or
 * suggestion pointing at a bay that was deleted or not loaded) have no address to walk by, so they
 * come after every known bay, in the order the map gives them. Qty with no bay comes last, in line
 * order.
 */
export function pickStops(lines: GuidedPickLine[], locations: GuidedPickLocation[]): PickStop[] {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const walkLines: PickMapLine[] = [];
  const noBay: PickStop[] = [];

  for (const line of lines) {
    const remaining = lineRemaining(line);
    if (remaining <= 0) continue;
    const { grabs, unlocated } = lineGrabs(line, remaining);
    if (grabs.length) {
      walkLines.push({
        lineId: line.id,
        sku: line.sku,
        remaining: grabs.reduce((sum, grab) => sum + grab.qty, 0),
        suggestedLocation: null,
        allocations: grabs,
      });
    }
    if (unlocated > 0) noBay.push(asStop(line, unlocated, null, null));
  }

  const plan = buildPickMapStops(walkLines, locations);
  const walked = plan.stops.flatMap((stop) =>
    stop.skus.flatMap((grab) => {
      const line = byId.get(grab.lineId);
      return line ? [asStop(line, grab.qty, stop.locationId, stop.locationCode)] : [];
    }),
  );
  // The map's sort reads a missing aisle as "", which would put unknown bays first. Stable-partition
  // them behind the known bays instead.
  const known = new Set(locations.map((location) => location.id));
  const knownStops = walked.filter((stop) => stop.locationId !== null && known.has(stop.locationId));
  const unknownStops = walked.filter((stop) => stop.locationId === null || !known.has(stop.locationId));
  return [...knownStops, ...unknownStops, ...noBay];
}

/**
 * Progress through an order in LINES, not units: `done` is lines with nothing left to pick,
 * `total` is every line with a qty. Guided pick moves one line per screen, so counting lines keeps
 * the bar in step with the screens and stops one 40-unit line from swamping four 1-unit lines.
 */
export function stopProgress(
  lines: Pick<GuidedPickLine, "qty" | "qtyPicked" | "remaining">[],
): { done: number; total: number } {
  const counted = lines.filter((line) => (line.qty ?? 0) > 0);
  return {
    done: counted.filter((line) => lineRemaining(line) <= 0).length,
    total: counted.length,
  };
}

/** Stable identity for a stop across reloads: the line and the bay it is picked from. */
export function stopKey(stop: Pick<PickStop, "lineId" | "locationId">): string {
  return `${stop.lineId}@${stop.locationId ?? "-"}`;
}

/** Index of the stop with `key`, or 0 (the first stop in the walk) when it is gone or unset. */
export function stopIndex(stops: PickStop[], key: string | null | undefined): number {
  if (!key) return 0;
  const at = stops.findIndex((stop) => stopKey(stop) === key);
  return at < 0 ? 0 : at;
}

/** Key of the stop after `key`, wrapping to the start so skipped stops come round again. */
export function nextStopKey(stops: PickStop[], key: string | null | undefined): string | null {
  if (!stops.length) return null;
  const at = key ? stops.findIndex((stop) => stopKey(stop) === key) : -1;
  const next = stops[(at + 1) % stops.length];
  return next ? stopKey(next) : null;
}

/**
 * "Stop x of y" for the screen. Lines already picked count as stops behind the picker, so the
 * total holds steady as stops are picked and drop off the list, and survives a reload.
 */
export function stopCounter(
  lines: Pick<GuidedPickLine, "qty" | "qtyPicked" | "remaining">[],
  stops: PickStop[],
  index: number,
): { current: number; total: number } {
  const { done } = stopProgress(lines);
  const total = done + stops.length;
  if (!stops.length) return { current: total, total };
  const at = Math.min(Math.max(0, index), stops.length - 1);
  return { current: done + at + 1, total };
}

/** Clamp a typed or stepped qty to 0…max. Blank or junk reads as 0. */
export function clampPickQty(raw: string | number, max: number): number {
  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.floor(value)), Math.max(0, Math.floor(max)));
}

export type GuidedScan =
  | { kind: "location"; locationId: string; locationCode?: string }
  | { kind: "item"; sku: string };

export type GuidedScanResult =
  /**
   * The picker is at the bay for stop `index` (the current stop, or the next stop at that bay). The
   * scanned bay becomes that stop's pick bay: apply `withPickBay` so an earlier "Other bay" choice
   * the picker has walked away from is dropped.
   */
  | { type: "bay"; index: number; jumped: boolean }
  /** The SKU for stop `index` is confirmed (the current stop, or the next stop for that SKU). */
  | { type: "item"; index: number; jumped: boolean }
  /** The current stop has no bay; the scanned bay becomes its bay. */
  | { type: "choose-bay"; index: number }
  | { type: "wrong-bay"; expected: string | null }
  | { type: "not-on-order" };

/** Look for a stop matching `match`, starting at `from` and wrapping, so the walk moves forward. */
function findFrom(stops: PickStop[], from: number, match: (stop: PickStop) => boolean): number {
  for (let step = 0; step < stops.length; step += 1) {
    const at = (from + step) % stops.length;
    const stop = stops[at];
    if (stop && match(stop)) return at;
  }
  return -1;
}

/**
 * What a bay or SKU scan means on the current guided stop. `currentBayId` is the bay the picker is
 * actually picking from when they chose another one; it defaults to the stop's own bay. Scanning
 * either that bay or the stop's own bay keeps the picker on the current stop; the caller then makes
 * the scanned bay the pick bay with `withPickBay`.
 */
export function routeGuidedScan(
  stops: PickStop[],
  index: number,
  scan: GuidedScan,
  currentBayId?: string | null,
): GuidedScanResult {
  const current = stops[index];
  if (scan.kind === "location") {
    const bayId = currentBayId ?? current?.locationId ?? null;
    if (current && !bayId) return { type: "choose-bay", index };
    if (current && (bayId === scan.locationId || current.locationId === scan.locationId)) {
      return { type: "bay", index, jumped: false };
    }
    const at = findFrom(stops, index + 1, (stop) => stop.locationId === scan.locationId);
    if (at >= 0) return { type: "bay", index: at, jumped: at !== index };
    return { type: "wrong-bay", expected: current?.locationCode ?? null };
  }
  const sku = scan.sku.trim().toUpperCase();
  if (current && current.sku.toUpperCase() === sku) return { type: "item", index, jumped: false };
  const at = findFrom(stops, index + 1, (stop) => stop.sku.toUpperCase() === sku);
  if (at >= 0) return { type: "item", index: at, jumped: at !== index };
  return { type: "not-on-order" };
}

/** Other-bay choices, by `stopKey`: the bay a stop is picked from instead of its own. */
export type BayOverrides = Record<string, string>;

/** The bay a stop is picked from: the picker's other-bay choice, else the stop's own bay. */
export function pickBayFor(overrides: BayOverrides, stop: Pick<PickStop, "lineId" | "locationId">): string | null {
  return overrides[stopKey(stop)] ?? stop.locationId;
}

/**
 * Make `bayId` the bay `stop` is picked from. Choosing the stop's own bay drops the other-bay
 * choice, so a scan or tap on the suggested bay after picking "Other bay" posts the bay the picker
 * is standing at, not the one they walked away from. Returns `overrides` itself when nothing changes.
 */
export function withPickBay(
  overrides: BayOverrides,
  stop: Pick<PickStop, "lineId" | "locationId">,
  bayId: string | null,
): BayOverrides {
  const key = stopKey(stop);
  if (!bayId || bayId === stop.locationId) {
    if (!(key in overrides)) return overrides;
    const next = { ...overrides };
    delete next[key];
    return next;
  }
  return overrides[key] === bayId ? overrides : { ...overrides, [key]: bayId };
}

export type PickPostLine = {
  lineId: string;
  qty: number;
  lotCode: string | undefined;
  serials: string | undefined;
  weightGrams: number | undefined;
};

/**
 * Body for `POST /api/orders/:id/pick` with just this stop's line: the same `{ locationId, lines }`
 * shape the list-mode Pick posts, blanks sent as undefined (dropped by JSON) exactly as it does.
 */
export function stopPickBody(input: {
  locationId: string;
  lineId: string;
  qty: number;
  lotCode?: string | null;
  serials?: string | null;
  weightGrams?: number | null;
}): { locationId: string; lines: PickPostLine[] } {
  return {
    locationId: input.locationId,
    lines: [
      {
        lineId: input.lineId,
        qty: input.qty,
        lotCode: input.lotCode || undefined,
        serials: input.serials || undefined,
        weightGrams: input.weightGrams ?? undefined,
      },
    ],
  };
}

/** Add a scanned serial to the typed list unless it is already there. */
export function appendSerial(current: string, serial: string): string {
  const code = serial.trim();
  if (!code) return current;
  const parts = current.split(/[\s,;]+/).filter(Boolean);
  if (parts.includes(code)) return current;
  return [...parts, code].join(", ");
}
