import { normalizeBarcode, PREFIXES } from "./barcodes";
import { labelOunces, scaleStatusWords, type ScaleReading } from "./scale-report";

function orderKey(value: string): string {
  return normalizeBarcode(value).replace(/^#/, "");
}

/**
 * The queue order a scan names. The pack slip's barcode is the order number; a scan also matches with or without
 * `#`, with an `ORD:` or `SO:` prefix, ignoring spaces, or by order id. The part after the last dash alone (`WAVE1`
 * for `ORD-WAVE1`) matches when just one order ends that way. Numbers are not read as GS1 codes here, so `1004`
 * stays an order number.
 */
export function matchShipScan<T extends { id: string; number: string }>(raw: string, orders: T[]): T | null {
  const value = normalizeBarcode(raw);
  const prefix = PREFIXES.find((entry) => value.startsWith(entry.prefix));
  if (prefix && prefix.kind !== "order") return null;
  const needle = orderKey(prefix ? value.slice(prefix.prefix.length) : value);
  if (!needle) return null;
  const exact = orders.find((row) => orderKey(row.number) === needle || row.id.toUpperCase() === needle);
  if (exact) return exact;
  const tail = orders.filter((row) => orderKey(row.number).endsWith(`-${needle}`));
  return tail.length === 1 ? tail[0]! : null;
}

export type StationWeight = { ok: true; weightOz: number; source: "typed" | "scale" | "order" } | { ok: false; error: string };

/**
 * The weight a station ship sends, in whole ounces. A typed weight wins. Otherwise a connected scale has to have
 * settled above zero. Without a scale, the weight the queue worked out from ship weights and the box stands in.
 */
export function stationWeight(input: {
  typed: string;
  scale: { connected: boolean; reading: ScaleReading | null };
  computedOz?: number | null;
}): StationWeight {
  const typed = input.typed.trim();
  if (typed) {
    const oz = Number(typed);
    if (!Number.isFinite(oz) || oz <= 0) return { ok: false, error: "Type the weight in ounces, above 0." };
    return { ok: true, weightOz: Math.ceil(oz - 1e-6), source: "typed" };
  }
  if (input.scale.connected) {
    const oz = labelOunces(input.scale.reading);
    if (oz !== null) return { ok: true, weightOz: oz, source: "scale" };
    const reading = input.scale.reading;
    if (!reading || reading.status === "zero") return { ok: false, error: "Put the box on the scale, or type the weight." };
    if (reading.status === "motion") return { ok: false, error: "Wait for the scale to settle." };
    return { ok: false, error: `${scaleStatusWords(reading)}. Type the weight instead.` };
  }
  if (input.computedOz && input.computedOz > 0) return { ok: true, weightOz: input.computedOz, source: "order" };
  return { ok: false, error: "Type the weight, or connect a scale." };
}
