import { CarrierLiveError } from "./carrier-live";
import { countryCode, crossesBorder, shipAddressParts, type ShipAddressInput } from "./ship-address";

/** What one item declares at the border. The description falls back to the item name. */
export type ItemCustoms = {
  hsCode: string | null;
  originCountry: string | null;
  customsDescription: string | null;
  customsValueCents: number | null;
};

export type CustomsLine = ItemCustoms & {
  itemId?: string;
  sku: string;
  itemName: string;
  qty: number;
  shipWeightOz?: number | null;
};

export type CustomsField = "hsCode" | "originCountry" | "customsValueCents";

const FIELD_NAMES: Record<CustomsField, string> = {
  hsCode: "an HS code",
  originCountry: "a country of origin",
  customsValueCents: "a declared value",
};

export type CustomsGap = { sku: string; itemId: string | null; missing: CustomsField[] };

export type CustomsItem = {
  sku: string;
  description: string;
  qty: number;
  unitValueCents: number;
  /** The line's total: unit value times quantity. */
  valueCents: number;
  /** The line's total weight. */
  weightOz: number;
  hsCode: string;
  originCountry: string;
};

export type CustomsDeclaration = {
  contents: "merchandise";
  /** Printed on the form as the person certifying it. */
  signer: string;
  /** The order number; UPS and DHL print it as the invoice number. */
  invoiceNumber: string;
  currency: "USD";
  fromCountry: string;
  toCountry: string;
  items: CustomsItem[];
  valueCents: number;
  /** The US export filing exemption the form carries, or null when the parcel does not leave the US. */
  exportFiling: string | null;
};

/** Over this per tariff code, a US export needs an EEI filing (an ITN) instead of an exemption. */
export const EEI_THRESHOLD_CENTS = 250_000;

/** Up to this declared value, the postal form is a CN22; above it, a CN23 or commercial invoice. */
export const CN22_LIMIT_CENTS = 40_000;

export const CUSTOMS_DESCRIPTION_MAX = 100;

/** Where goods are commonly made, by name, beyond the countries the address gazetteer knows. */
const ORIGIN_NAMES: Record<string, string> = {
  china: "CN",
  "peoples republic of china": "CN",
  prc: "CN",
  vietnam: "VN",
  "viet nam": "VN",
  india: "IN",
  taiwan: "TW",
  "south korea": "KR",
  korea: "KR",
  bangladesh: "BD",
  indonesia: "ID",
  thailand: "TH",
  malaysia: "MY",
  philippines: "PH",
  cambodia: "KH",
  pakistan: "PK",
  "sri lanka": "LK",
  "hong kong": "HK",
  turkey: "TR",
  turkiye: "TR",
  italy: "IT",
  spain: "ES",
  portugal: "PT",
  poland: "PL",
  "czech republic": "CZ",
  czechia: "CZ",
  switzerland: "CH",
  sweden: "SE",
  denmark: "DK",
  belgium: "BE",
  austria: "AT",
  brazil: "BR",
  israel: "IL",
  "new zealand": "NZ",
};

/** The two-letter code for a country of origin, typed as a code or a common name. */
export function originCountryCode(value: string | null | undefined): string | null {
  const name = value?.trim().toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ");
  return (name && ORIGIN_NAMES[name]) || countryCode(value);
}

/** HS and Schedule B codes are 6 to 10 digits; dots and spaces people type between groups are dropped. */
export function normalizeHsCode(value: string | null | undefined): string | null {
  const digits = value?.replace(/[\s.\-]/g, "") ?? "";
  return /^\d{6,10}$/.test(digits) ? digits : null;
}

export function customsDescriptionFor(line: { customsDescription?: string | null; itemName: string }): string {
  return (line.customsDescription?.trim() || line.itemName.trim()).slice(0, CUSTOMS_DESCRIPTION_MAX);
}

/** One gap per SKU that cannot be declared yet, in line order. */
export function customsGaps(lines: CustomsLine[]): CustomsGap[] {
  const gaps: CustomsGap[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.qty <= 0 || seen.has(line.sku)) continue;
    seen.add(line.sku);
    const missing: CustomsField[] = [];
    if (!normalizeHsCode(line.hsCode)) missing.push("hsCode");
    if (!originCountryCode(line.originCountry)) missing.push("originCountry");
    if (!line.customsValueCents || line.customsValueCents <= 0) missing.push("customsValueCents");
    if (missing.length) gaps.push({ sku: line.sku, itemId: line.itemId ?? null, missing });
  }
  return gaps;
}

function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")}${parts.length > 2 ? "," : ""} and ${parts[parts.length - 1]}`;
}

/** Names the first SKU and what it lacks, e.g. `LAMP needs an HS code and a declared value to ship abroad.` */
export function customsRequiredMessage(gaps: CustomsGap[]): string {
  const first = gaps[0];
  if (!first) return "Every item needs customs details to ship abroad.";
  const others = gaps.length - 1;
  const fields = first.missing.map((field) => FIELD_NAMES[field]);
  if (others > 0) {
    const more = others === 1 ? "1 more SKU needs" : `${others} more SKUs need`;
    return `${first.sku} needs ${listOf(fields)} to ship abroad, and ${more} customs details too. Add them under Customs on each item.`;
  }
  return `${first.sku} needs ${listOf(fields)} to ship abroad. Add ${fields.length === 1 ? "it" : "them"} under Customs on the item.`;
}

export class CustomsRequiredError extends Error {
  readonly code = "CUSTOMS_REQUIRED";
  constructor(public gaps: CustomsGap[]) {
    super(customsRequiredMessage(gaps));
    this.name = "CustomsRequiredError";
  }

  get sku(): string | null {
    return this.gaps[0]?.sku ?? null;
  }
}

/**
 * Splits the parcel weight across lines: an item's own ship weight where it has one, the rest shared by
 * quantity. Carriers refuse customs lines that add up to more than the parcel, so known weights shrink to fit.
 */
export function customsWeights(lines: Array<{ qty: number; shipWeightOz?: number | null }>, parcelWeightOz: number): number[] {
  const known = lines.map((line) => (line.shipWeightOz && line.shipWeightOz > 0 ? line.shipWeightOz * line.qty : null));
  const knownTotal = known.reduce<number>((sum, weight) => sum + (weight ?? 0), 0);
  const scale = knownTotal > parcelWeightOz && knownTotal > 0 ? parcelWeightOz / knownTotal : 1;
  const left = Math.max(0, parcelWeightOz - knownTotal * scale);
  const unknownQty = lines.reduce((sum, line, index) => sum + (known[index] == null ? line.qty : 0), 0);
  return lines.map((line, index) => {
    const weight = known[index] != null ? known[index]! * scale : unknownQty > 0 ? (left * line.qty) / unknownQty : 0;
    return Math.max(1, Math.round(weight));
  });
}

/** The US exemption for this export, or null when none applies and it would need an ITN. */
export function exportFilingFor(fromCountry: string, toCountry: string, items: CustomsItem[]): string | null | "ITN" {
  if (fromCountry !== "US") return null;
  if (toCountry === "CA") return "NOEEI 30.36";
  const byCode = new Map<string, number>();
  for (const item of items) byCode.set(item.hsCode, (byCode.get(item.hsCode) ?? 0) + item.valueCents);
  return [...byCode.values()].every((cents) => cents <= EEI_THRESHOLD_CENTS) ? "NOEEI 30.37(a)" : "ITN";
}

/** The two countries a label runs between, read from the addresses the label prints. */
export function labelCountries(input: { shipFrom: ShipAddressInput; shipTo: ShipAddressInput }): {
  from: string | null;
  to: string | null;
} {
  const from = countryCode(input.shipFrom.country) || shipAddressParts(input.shipFrom).country || null;
  const to = shipAddressParts(input.shipTo).country || countryCode(input.shipTo.country) || null;
  return { from, to };
}

/**
 * The declaration an international label sends, or null for a domestic one. Throws `CustomsRequiredError`
 * naming the first SKU without customs details, and refuses a US export that would need an ITN.
 */
export function customsForLabel(input: {
  fromCountry: string | null;
  toCountry: string | null;
  lines: CustomsLine[];
  parcelWeightOz: number;
  signer: string;
  invoiceNumber: string;
}): CustomsDeclaration | null {
  const { fromCountry, toCountry } = input;
  if (!fromCountry || !toCountry || !crossesBorder(fromCountry, toCountry)) return null;
  const lines = input.lines.filter((line) => line.qty > 0);
  const gaps = customsGaps(lines);
  if (gaps.length) throw new CustomsRequiredError(gaps);
  const weights = customsWeights(lines, input.parcelWeightOz);
  const items = lines.map<CustomsItem>((line, index) => ({
    sku: line.sku,
    description: customsDescriptionFor(line),
    qty: line.qty,
    unitValueCents: line.customsValueCents!,
    valueCents: line.customsValueCents! * line.qty,
    weightOz: weights[index]!,
    hsCode: normalizeHsCode(line.hsCode)!,
    originCountry: originCountryCode(line.originCountry)!,
  }));
  const filing = exportFilingFor(fromCountry, toCountry, items);
  if (filing === "ITN") {
    throw new CarrierLiveError(
      "One tariff code on this parcel is worth over $2,500, which needs an export filing (an ITN) that Rackline cannot file yet. Buy this label on the carrier's site.",
      "CUSTOMS_UNSUPPORTED",
    );
  }
  return {
    contents: "merchandise",
    signer: input.signer.trim() || "Shipper",
    invoiceNumber: input.invoiceNumber,
    currency: "USD",
    fromCountry,
    toCountry,
    items,
    valueCents: items.reduce((sum, item) => sum + item.valueCents, 0),
    exportFiling: filing,
  };
}

/** What a live rate quote declares: the label's declaration, or none while it cannot be built. Buying the label says why. */
export function quoteCustoms(input: Parameters<typeof customsForLabel>[0]): CustomsDeclaration | null {
  try {
    return customsForLabel(input);
  } catch (err) {
    if (err instanceof CustomsRequiredError || err instanceof CarrierLiveError) return null;
    throw err;
  }
}

/** The queue's blocker for an international order whose items lack customs details. */
export function customsBlocker(input: {
  shipFrom: ShipAddressInput;
  shipTo: ShipAddressInput;
  lines: CustomsLine[];
}): { code: "CUSTOMS_REQUIRED"; error: string; sku: string; itemId: string | null } | null {
  const { from, to } = labelCountries(input);
  if (!crossesBorder(from, to)) return null;
  const gaps = customsGaps(input.lines);
  if (!gaps.length) return null;
  return { code: "CUSTOMS_REQUIRED", error: customsRequiredMessage(gaps), sku: gaps[0]!.sku, itemId: gaps[0]!.itemId };
}

/** The form a postal carrier expects for this value. */
export function customsFormKind(valueCents: number): "CN22" | "CN23" {
  return valueCents <= CN22_LIMIT_CENTS ? "CN22" : "CN23";
}

function parseRecord(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isDeclaration(value: unknown): value is CustomsDeclaration {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CustomsDeclaration>;
  return typeof row.fromCountry === "string" && typeof row.toCountry === "string" && Array.isArray(row.items) && typeof row.valueCents === "number";
}

/**
 * What the purchase of the label with `trackingNumber` declared, read from carrier buy events newest first.
 * Null when no event bought that label, or it bought it without customs.
 */
export function declaredCustoms(
  events: Array<{ requestJson: string; responseJson: string | null }>,
  trackingNumber: string | null | undefined,
): CustomsDeclaration | null {
  if (!trackingNumber) return null;
  for (const event of events) {
    if (parseRecord(event.responseJson)?.trackingNumber !== trackingNumber) continue;
    const customs = parseRecord(event.requestJson)?.customs;
    return isDeclaration(customs) ? customs : null;
  }
  return null;
}

export type CustomsPatch = Partial<ItemCustoms>;

/** Checks an item's customs edit. Blank clears a field. */
export function parseCustomsPatch(body: Record<string, unknown>): { ok: true; patch: CustomsPatch } | { ok: false; error: string } {
  const patch: CustomsPatch = {};
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : value == null ? "" : null);
  if ("hsCode" in body) {
    const raw = text(body.hsCode);
    if (raw === null) return { ok: false, error: "HS code must be text." };
    const code = raw ? normalizeHsCode(raw) : null;
    if (raw && !code) return { ok: false, error: "HS code should be 6 to 10 digits, like 9405.20." };
    patch.hsCode = code;
  }
  if ("originCountry" in body) {
    const raw = text(body.originCountry);
    if (raw === null) return { ok: false, error: "Country of origin must be text." };
    const code = raw ? originCountryCode(raw) : null;
    if (raw && !code) return { ok: false, error: "Country of origin should be a two-letter code, like US or CN." };
    patch.originCountry = code;
  }
  if ("customsDescription" in body) {
    const raw = text(body.customsDescription);
    if (raw === null) return { ok: false, error: "Customs description must be text." };
    if (raw.length > CUSTOMS_DESCRIPTION_MAX) {
      return { ok: false, error: `Customs description should be ${CUSTOMS_DESCRIPTION_MAX} characters or fewer.` };
    }
    patch.customsDescription = raw || null;
  }
  if ("customsValueCents" in body) {
    const raw = body.customsValueCents;
    if (raw === null || raw === "" || raw === undefined) {
      patch.customsValueCents = null;
    } else {
      const cents = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isInteger(cents) || cents <= 0) return { ok: false, error: "Declared value should be above $0." };
      patch.customsValueCents = cents;
    }
  }
  return { ok: true, patch };
}
