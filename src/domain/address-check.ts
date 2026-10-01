import { lookupCountry, lookupRegion } from "./geo-gazetteer";
import {
  POSTAL_PATTERNS,
  countryCode,
  postalRequired,
  regionRequired,
  shipAddressParts,
  type ShipAddressInput,
  type ShipAddressParts,
} from "./ship-address";
import { usZipPrefixInState } from "./zip-prefixes";

export type AddressField = "street" | "city" | "region" | "postal";

/** Missing parts share one sentence in the message; each invalid part says what is wrong with it. */
export type AddressProblem = { field: AddressField; kind: "missing" | "invalid"; message: string };

/** Territories, freely associated states, and military post codes, which the gazetteer's state list leaves out. */
const US_EXTRA_REGIONS = new Set(["PR", "VI", "GU", "AS", "MP", "FM", "MH", "PW", "AA", "AE", "AP"]);

/** A Canadian postal code's first letter names its province. */
const CA_POSTAL_FIRST_LETTER: Record<string, string> = {
  A: "NL",
  B: "NS",
  C: "PE",
  E: "NB",
  G: "QC",
  H: "QC",
  J: "QC",
  K: "ON",
  L: "ON",
  M: "ON",
  N: "ON",
  P: "ON",
  R: "MB",
  S: "SK",
  T: "AB",
  V: "BC",
  X: "NT NU",
  Y: "YT",
};

const AU_STATES = new Set(["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]);

const REGION_WORD: Record<string, string> = { US: "state", CA: "province", AU: "state" };
const POSTAL_WORD: Record<string, string> = { US: "ZIP code", GB: "postcode", AU: "postcode" };
const POSTAL_NAME: Record<string, string> = {
  US: "a US ZIP code",
  CA: "a Canadian postal code",
  GB: "a UK postcode",
  AU: "an Australian postcode",
};

const UNIT_WITHOUT_NUMBER = /(?:^|[\s,])(apt|apartment|unit|suite|ste|#)\.?$/i;

/** The ship-to split for carriers. An address that names no country is in the building's. */
export function shipToParts(input: ShipAddressInput, buildingCountry?: string | null): ShipAddressParts {
  const parts = shipAddressParts(input);
  return { ...parts, country: parts.country || countryCode(buildingCountry) || "US" };
}

function regionCode(country: string, region: string): string {
  return lookupRegion(country, region)?.code ?? region.trim().toUpperCase();
}

function regionName(country: string, code: string): string {
  return lookupRegion(country, code)?.name ?? code;
}

function regionProblem(country: string, region: string): string | null {
  const shown = region.trim().toUpperCase();
  if (country === "US") return lookupRegion("US", region) || US_EXTRA_REGIONS.has(shown) ? null : `${shown} is not a US state.`;
  if (country === "CA") return lookupRegion("CA", region) ? null : `${shown} is not a Canadian province.`;
  if (country === "AU") return AU_STATES.has(shown) ? null : `${shown} is not an Australian state.`;
  return null;
}

function postalProblem(country: string, region: string, postal: string, regionOk: boolean): string | null {
  const shown = postal.trim().toUpperCase();
  const pattern = POSTAL_PATTERNS[country];
  if (pattern && !pattern.test(shown)) {
    return `${shown} is not ${POSTAL_NAME[country] ?? `a postal code in ${lookupCountry(country)?.name ?? country}`}.`;
  }
  if (!regionOk || !region) return null;
  const code = regionCode(country, region);
  if (country === "US" && !usZipPrefixInState(shown, code)) {
    return `ZIP code ${shown} is not in ${regionName("US", code)}.`;
  }
  if (country === "CA" && !CA_POSTAL_FIRST_LETTER[shown[0]!]?.split(" ").includes(code)) {
    return `Postal code ${shown} is not in ${regionName("CA", code)}.`;
  }
  return null;
}

/** What stops a carrier from delivering here, checked without asking one. */
export function checkAddressParts(parts: ShipAddressParts): AddressProblem[] {
  const { country } = parts;
  const problems: AddressProblem[] = [];
  const missing = (field: AddressField) => problems.push({ field, kind: "missing", message: missingSentence(country, [field]) });
  const invalid = (field: AddressField, message: string) => problems.push({ field, kind: "invalid", message });

  const street = [parts.street1, parts.street2].filter(Boolean);
  if (!parts.street1) missing("street");
  if (!parts.city) missing("city");
  const regionError = parts.region ? regionProblem(country, parts.region) : null;
  if (!parts.region && regionRequired(country)) missing("region");
  if (regionError) invalid("region", regionError);
  if (!parts.postal && postalRequired(country)) missing("postal");
  const postalError = parts.postal ? postalProblem(country, parts.region, parts.postal, !regionError) : null;
  if (postalError) invalid("postal", postalError);

  const unit = street.map((line) => line.match(UNIT_WITHOUT_NUMBER)?.[1]).find(Boolean);
  if (unit) {
    invalid("street", `The street ends in "${unit}" with no number after it.`);
  } else if ((country === "US" || country === "CA") && parts.street1 && !/\d/.test(street.join(" "))) {
    invalid("street", "The street has no house number.");
  }
  return problems;
}

function listOr(words: string[]): string {
  if (words.length <= 2) return words.join(" or ");
  return `${words.slice(0, -1).join(", ")}, or ${words[words.length - 1]}`;
}

function missingSentence(country: string, fields: AddressField[]): string {
  const words = fields.map((field) => {
    if (field === "region") return REGION_WORD[country] ?? "region";
    if (field === "postal") return POSTAL_WORD[country] ?? "postal code";
    return field;
  });
  return `The ship-to address has no ${listOr(words)}.`;
}

/** At most two sentences: everything missing in one, then the first part that is wrong. */
export function addressProblemMessage(parts: ShipAddressParts, problems: AddressProblem[]): string | null {
  if (!problems.length) return null;
  const missing = problems.filter((row) => row.kind === "missing").map((row) => row.field);
  if (missing.includes("street") && missing.includes("city")) return "The order has no ship-to address.";
  const invalid = problems.filter((row) => row.kind === "invalid").map((row) => row.message);
  return [...(missing.length ? [missingSentence(parts.country, missing)] : []), ...invalid].slice(0, 2).join(" ");
}

/** A carrier needs at least a street, a city, and a country to look an address up. */
export function isVerifiable(parts: ShipAddressParts): boolean {
  return Boolean(parts.street1 && parts.city && parts.country);
}

/** Stable across case, spacing, and punctuation, so retyping the same address keeps its check and override. */
export function addressHash(parts: ShipAddressParts): string {
  const key = [parts.street1, parts.street2, parts.city, parts.region, parts.postal, parts.country]
    .map((part) => part.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim())
    .join("|");
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function oneLineAddress(parts: ShipAddressParts): string {
  return [parts.street1, parts.street2, parts.city, [parts.region, parts.postal].filter(Boolean).join(" "), parts.country]
    .filter(Boolean)
    .join(", ");
}

export type AddressProvider = "easypost" | "shipengine";

export type AddressVerification = {
  provider: AddressProvider;
  status: "valid" | "corrected" | "invalid" | "unverified";
  /** The carrier's words when it could not verify the address. */
  message: string | null;
  /** The carrier's version of the address, when it differs from the one entered in a way that matters. */
  suggestion: ShipAddressParts | null;
};

const PROVIDER_NAME: Record<AddressProvider, string> = { easypost: "EasyPost", shipengine: "ShipEngine" };

/**
 * Spelling, case, and abbreviation fixes do not count, nor does the city: mail sorts by postal code. A different
 * country does, and a region or postal code the country uses that the entered address lacks. In the US and Canada
 * a different house number, region, or postal code counts too; elsewhere carriers return local spellings that
 * would read as changes.
 */
export function materialChange(entered: ShipAddressParts, suggested: ShipAddressParts): boolean {
  if (entered.country !== suggested.country) return true;
  const { country } = entered;
  if (!entered.postal && suggested.postal && postalRequired(country)) return true;
  if (!entered.region && suggested.region && regionRequired(country)) return true;
  if (country !== "US" && country !== "CA") return false;
  const houseNumber = (street: string) => street.trim().match(/^\d+[a-z]?\b/i)?.[0]?.toUpperCase() ?? "";
  const postal = (text: string) => (country === "US" ? text.replace(/\D/g, "").slice(0, 5) : text.replace(/\s+/g, "").toUpperCase());
  return (
    houseNumber(entered.street1) !== houseNumber(suggested.street1) ||
    regionCode(country, entered.region) !== regionCode(country, suggested.region) ||
    postal(entered.postal) !== postal(suggested.postal)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((row): row is Record<string, unknown> => row !== null) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function easyPostVerifyBody(parts: ShipAddressParts, name: string) {
  return {
    address: {
      name,
      street1: parts.street1,
      ...(parts.street2 ? { street2: parts.street2 } : {}),
      city: parts.city,
      state: parts.region,
      zip: parts.postal,
      country: parts.country,
    },
    verify: true,
  };
}

/** Codes for a country or moment EasyPost cannot check, which say nothing about the address itself. */
const EASYPOST_UNCHECKED = new Set(["E.COUNTRY.UNSUPPORTED", "E.ENGINE.UNAVAILABLE", "E.QUERY.UNANSWERABLE"]);

/** EasyPost reports a missing or unknown apartment as an error even when delivery verification succeeds. */
export function easyPostVerification(payload: unknown, entered: ShipAddressParts): AddressVerification {
  const address = asRecord(payload);
  const delivery = asRecord(asRecord(address?.verifications)?.delivery);
  const errors = records(delivery?.errors);
  const result = (status: AddressVerification["status"], message: string | null = null, suggestion: ShipAddressParts | null = null) => ({
    provider: "easypost" as const,
    status,
    message,
    suggestion,
  });
  if (!address || !delivery || errors.some((row) => EASYPOST_UNCHECKED.has(text(row.code)))) return result("unverified");
  const unit = errors.find((row) => text(row.code).startsWith("E.SECONDARY_INFORMATION"));
  if (delivery.success !== true || unit) return result("invalid", text((unit ?? errors[0])?.message) || "Address not found");
  const returned: ShipAddressParts = {
    street1: text(address.street1),
    street2: text(address.street2),
    city: text(address.city),
    region: text(address.state),
    postal: text(address.zip),
    country: text(address.country).toUpperCase() || entered.country,
  };
  return materialChange(entered, returned) ? result("corrected", null, returned) : result("valid");
}

export function shipEngineVerifyBody(parts: ShipAddressParts, name: string) {
  return [
    {
      name,
      address_line1: parts.street1,
      ...(parts.street2 ? { address_line2: parts.street2 } : {}),
      city_locality: parts.city,
      state_province: parts.region,
      postal_code: parts.postal,
      country_code: parts.country,
    },
  ];
}

/** ShipEngine's `warning` means verified with a caveat, and `unverified` that it could not check this country. */
export function shipEngineVerification(payload: unknown, entered: ShipAddressParts): AddressVerification {
  const row = asRecord(Array.isArray(payload) ? payload[0] : payload);
  const status = text(row?.status);
  const matched = asRecord(row?.matched_address);
  const result = (status: AddressVerification["status"], message: string | null = null, suggestion: ShipAddressParts | null = null) => ({
    provider: "shipengine" as const,
    status,
    message,
    suggestion,
  });
  if (status === "error") {
    const error = records(row?.messages).find((message) => text(message.type) === "error");
    return result("invalid", text(error?.message) || "Address not found");
  }
  if (status !== "verified" && status !== "warning") return result("unverified");
  if (!matched) return result("valid");
  const returned: ShipAddressParts = {
    street1: text(matched.address_line1),
    street2: [text(matched.address_line2), text(matched.address_line3)].filter(Boolean).join(", "),
    city: text(matched.city_locality),
    region: text(matched.state_province),
    postal: text(matched.postal_code),
    country: text(matched.country_code).toUpperCase() || entered.country,
  };
  return materialChange(entered, returned) ? result("corrected", null, returned) : result("valid");
}

const STATUSES = new Set<AddressVerification["status"]>(["valid", "corrected", "invalid", "unverified"]);

function isParts(value: unknown): value is ShipAddressParts {
  const row = asRecord(value);
  return Boolean(row) && ["street1", "street2", "city", "region", "postal", "country"].every((key) => typeof row![key] === "string");
}

/** A cached carrier answer from `address_checks`; null for a row that only records an override. */
export function storedVerification(row: {
  provider: string | null;
  status: string;
  message: string | null;
  suggestionJson: string | null;
}): AddressVerification | null {
  if (row.provider !== "easypost" && row.provider !== "shipengine") return null;
  if (!STATUSES.has(row.status as AddressVerification["status"])) return null;
  let suggestion: unknown = null;
  try {
    suggestion = row.suggestionJson ? JSON.parse(row.suggestionJson) : null;
  } catch {
    suggestion = null;
  }
  return {
    provider: row.provider,
    status: row.status as AddressVerification["status"],
    message: row.message,
    suggestion: isParts(suggestion) ? suggestion : null,
  };
}

export type AddressVerdict = {
  hash: string;
  parts: ShipAddressParts;
  blocked: boolean;
  /** Someone chose to ship to this exact address as it is. */
  overridden: boolean;
  /** Why the label waits, for the 409 and the ship queue. */
  message: string | null;
  /** The carrier's corrected address, offered as "Use suggested address". */
  suggestion: ShipAddressParts | null;
};

function sentence(value: string): string {
  const trimmed = value.trim().replace(/[.!\s]+$/, "");
  return `${trimmed}.`;
}

/**
 * An override ships to the address as it is; it belongs to this exact address, so editing it checks again. A
 * carrier that delivers to the address as entered outranks the local checks on the parts it has, so a General
 * Delivery street with no house number ships; a missing part still holds the label.
 */
export function addressVerdict(input: {
  parts: ShipAddressParts;
  verification?: AddressVerification | null;
  overridden?: boolean;
}): AddressVerdict {
  const { parts } = input;
  const hash = addressHash(parts);
  if (input.overridden) return { hash, parts, blocked: false, overridden: true, message: null, suggestion: null };
  const verification = input.verification ?? null;
  const offered = verification?.status === "corrected" ? verification.suggestion : null;
  const suggestion = offered && checkAddressParts(offered).length === 0 ? offered : null;
  const name = verification ? PROVIDER_NAME[verification.provider] : "";
  const problems = checkAddressParts(parts).filter((row) => verification?.status !== "valid" || row.kind === "missing");
  const message =
    addressProblemMessage(parts, problems) ??
    (verification?.status === "invalid" ? `${name} could not verify this address: ${sentence(verification.message ?? "Address not found")}` : null) ??
    (suggestion ? `${name} knows this address as ${oneLineAddress(suggestion)}.` : null);
  return { hash, parts, blocked: message !== null, overridden: false, message, suggestion };
}

/** The 409 a label purchase or quick-ship answers with; `suggestion` is the carrier's address on one line. */
export class AddressInvalidError extends Error {
  readonly code = "ADDRESS_INVALID";
  readonly suggestion: string | null;
  constructor(verdict: Pick<AddressVerdict, "message" | "suggestion">) {
    super(verdict.message ?? "The ship-to address needs a look before a label.");
    this.name = "AddressInvalidError";
    this.suggestion = verdict.suggestion ? oneLineAddress(verdict.suggestion) : null;
  }
}
