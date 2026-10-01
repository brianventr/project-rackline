/**
 * USB postal scales (DYMO, Stamps.com, Mettler Toledo, Fairbanks, and friends) speak the HID Point of Sale "Scale"
 * page, usage page 0x8D. Their data report carries five bytes after the report id:
 *
 *   status · unit · exponent (signed) · weight low byte · weight high byte
 *
 * so a report of `04 0B FF 7B 00` reads "stable, ounces, times 10^-1, 123": 12.3 oz.
 */
export const SCALE_USAGE_PAGE = 0x8d;

export const SCALE_STATUSES = [
  "fault",
  "zero",
  "motion",
  "stable",
  "under_zero",
  "over_weight",
  "calibrate",
  "rezero",
] as const;
export type ScaleStatus = (typeof SCALE_STATUSES)[number];

/** HID POS weight units, by their report code (1 to 12), with ounces per unit where the unit is fixed. */
const UNITS: { code: number; unit: string; oz: number | null }[] = [
  { code: 1, unit: "mg", oz: 1 / 28_349.523125 },
  { code: 2, unit: "g", oz: 1 / 28.349523125 },
  { code: 3, unit: "kg", oz: 1000 / 28.349523125 },
  { code: 4, unit: "ct", oz: 0.2 / 28.349523125 },
  // Taels differ by country, so they are shown but never turned into ounces.
  { code: 5, unit: "tael", oz: null },
  { code: 6, unit: "gr", oz: 1 / 437.5 },
  { code: 7, unit: "dwt", oz: 1.55517384 / 28.349523125 },
  { code: 8, unit: "t", oz: 1_000_000 / 28.349523125 },
  { code: 9, unit: "ton", oz: 32_000 },
  { code: 10, unit: "ozt", oz: 31.1034768 / 28.349523125 },
  { code: 11, unit: "oz", oz: 1 },
  { code: 12, unit: "lb", oz: 16 },
];

export type ScaleReading = {
  status: ScaleStatus;
  /** `oz`, `lb`, `g`, `kg`, and the rarer HID units. */
  unit: string;
  /** The weight in the scale's own unit. Negative under zero. */
  value: number;
  /** The same weight in ounces; null when the scale shows none or reads in taels. */
  weightOz: number | null;
  /** The scale says the weight has settled (at zero or above it). */
  stable: boolean;
};

const STATUS_WORDS: Record<ScaleStatus, string> = {
  fault: "Scale fault",
  zero: "Empty",
  motion: "Settling",
  stable: "Stable",
  under_zero: "Below zero, re-zero the scale",
  over_weight: "Over the scale's limit",
  calibrate: "Needs calibration",
  rezero: "Needs re-zeroing",
};

/** Report ids that carry the weight: 3 is the POS data report, 0 means the scale does not number its reports. */
const DATA_REPORT_IDS = new Set([0, 3]);

/**
 * One input report (the bytes after the report id), or null for anything that is not a weight. Some scales send
 * an under-zero weight as a negative 16-bit number rather than its size; both read the same.
 */
export function parseScaleReport(bytes: ArrayLike<number>, reportId = 3): ScaleReading | null {
  if (!DATA_REPORT_IDS.has(reportId) || bytes.length < 5) return null;
  const status = SCALE_STATUSES[(bytes[0] ?? 0) - 1];
  const unit = UNITS.find((row) => row.code === bytes[1]);
  if (!status || !unit) return null;
  const exponent = ((bytes[2] ?? 0) << 24) >> 24;
  const word = (bytes[3] ?? 0) | ((bytes[4] ?? 0) << 8);
  const raw = status === "under_zero" && word > 0x7fff ? 0x10000 - word : word;
  const magnitude = exponent >= 0 ? raw * 10 ** exponent : raw / 10 ** -exponent;
  const value = status === "zero" ? 0 : status === "under_zero" ? -magnitude : magnitude;
  const weighs = status === "zero" || status === "motion" || status === "stable" || status === "under_zero";
  return {
    status,
    unit: unit.unit,
    value,
    weightOz: weighs && unit.oz !== null ? value * unit.oz : null,
    stable: status === "stable" || status === "zero",
  };
}

/** Whole ounces for the label, rounded up the way carriers bill; null unless the scale has settled above zero. */
export function labelOunces(reading: ScaleReading | null): number | null {
  if (!reading?.stable || reading.weightOz == null || reading.weightOz <= 0) return null;
  return Math.max(1, Math.ceil(reading.weightOz - 1e-6));
}

/** `12.3 oz`, `1.25 lb`, `340 g`. */
export function formatScaleValue(reading: ScaleReading): string {
  const rounded = Math.round(reading.value * 100) / 100;
  return `${rounded} ${reading.unit}`;
}

export function scaleStatusWords(reading: ScaleReading): string {
  return STATUS_WORDS[reading.status];
}

export type ScaleWatch = { armed: boolean; fired: boolean };

/** Watch for one order, starting the moment it comes up on the station. */
export const FRESH_SCALE_WATCH: ScaleWatch = { armed: false, fired: false };

/**
 * Auto-ship on a stable weight fires once per order: on the first stable weight above zero after the scale has
 * moved or read empty since the order came up. A box left on the scale from the last order never ships the next.
 */
export function watchScale(watch: ScaleWatch, reading: ScaleReading): { watch: ScaleWatch; fire: boolean } {
  if (watch.fired) return { watch, fire: false };
  if (labelOunces(reading) === null) return { watch: watch.armed ? watch : { ...watch, armed: true }, fire: false };
  if (!watch.armed) return { watch, fire: false };
  return { watch: { armed: false, fired: true }, fire: true };
}
