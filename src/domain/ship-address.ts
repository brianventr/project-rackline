import { parseAddressText } from "./geo";
import { lookupCountry, lookupRegion } from "./geo-gazetteer";

/** An address split the way carriers take it. A blank string is a part the text did not have. */
export type ShipAddressParts = {
  street1: string;
  street2: string;
  city: string;
  region: string;
  postal: string;
  country: string;
};

export type ShipAddressInput = {
  text?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
};

export function buildingAddress(
  building: { shipFromAddress?: string | null; city?: string | null; region?: string | null; country?: string | null } | null | undefined,
): ShipAddressInput {
  return { text: building?.shipFromAddress, city: building?.city, region: building?.region, country: building?.country };
}

/** `text` is the address a label is bought to when someone typed one over the order's. */
export function orderAddress(
  order: { shipToAddress?: string | null; shipToCity?: string | null; shipToRegion?: string | null; shipToCountry?: string | null },
  text?: string | null,
): ShipAddressInput {
  return { text: text ?? order.shipToAddress, city: order.shipToCity, region: order.shipToRegion, country: order.shipToCountry };
}

/** The ISO two-letter code for a country name, alias, or code; null when the text is none of those. */
export function countryCode(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const known = lookupCountry(text);
  if (known) return known.code;
  return /^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : null;
}

const REGION_REQUIRED = new Set(["US", "CA", "AU"]);

/** Countries with no postal code system, per the UPU list carriers follow. */
const NO_POSTAL_CODE = new Set(
  (
    "AE AG AO AW BF BI BJ BO BS BW BZ CD CF CG CI CK CM DJ DM ER FJ GA GD GH GM GQ GY HK IE JM KI KM KN KP LC " +
    "ML MO MR MS MW NR NU QA RW SB SC SL SO SR SS ST SY TD TF TG TK TL TO TT TV UG VU YE ZW"
  ).split(" "),
);

export function regionRequired(country: string): boolean {
  return REGION_REQUIRED.has(country);
}

export function postalRequired(country: string): boolean {
  return !NO_POSTAL_CODE.has(country);
}

/** Customs applies once both countries are known and differ; an unknown country counts as the building's own. */
export function crossesBorder(fromCountry: string | null | undefined, toCountry: string | null | undefined): boolean {
  return Boolean(fromCountry && toCountry && fromCountry !== toCountry);
}

export const POSTAL_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(?:-\d{4})?$/,
  CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
  GB: /^(?:GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/i,
  AU: /^\d{4}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  MX: /^\d{5}$/,
  NL: /^\d{4} ?[A-Z]{2}$/i,
  JP: /^\d{3}-?\d{4}$/,
};

/** Postal codes in the form carriers print: upper case, and the space UK and Canadian codes carry. */
export function formatPostal(country: string, postal: string): string {
  const compact = postal.trim().toUpperCase().replace(/\s+/g, "");
  if ((country === "GB" || country === "CA") && compact.length > 3) return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  if (country === "NL" && /^\d{4}[A-Z]{2}$/.test(compact)) return `${compact.slice(0, 4)} ${compact.slice(4)}`;
  return postal.trim().toUpperCase();
}

type Locality = { city: string; region: string; postal: string; country: string };

const AU_STATES = "NSW|VIC|QLD|SA|WA|TAS|NT|ACT";

/**
 * The city, region, and postal code at the end of an address, tried country by country. Each pattern only
 * matches from the start of the text or a comma, so a one-line address keeps its street in front of the match.
 */
const LOCALITY_PATTERNS: Array<{ country: string | null; pattern: RegExp; read: (m: RegExpMatchArray) => Locality | null }> = [
  {
    country: "US",
    pattern: /(?:^|,)\s*([^,]+?),?\s+([A-Za-z]{2})\.?,?\s+(\d{5}(?:-\d{4})?)$/,
    read: (m) => regionLocality("US", m[1]!, m[2]!, m[3]!),
  },
  {
    country: "US",
    pattern: /(?:^|,)\s*([^,]+),?\s+([A-Za-z][A-Za-z .]+?),?\s+(\d{5}(?:-\d{4})?)$/,
    read: (m) => regionLocality("US", m[1]!, m[2]!, m[3]!),
  },
  {
    country: "CA",
    pattern: /(?:^|,)\s*([^,]+?),?\s+([A-Za-z]{2}),?\s+([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)$/,
    read: (m) => regionLocality("CA", m[1]!, m[2]!, m[3]!),
  },
  {
    country: "CA",
    pattern: /(?:^|,)\s*([^,]+),?\s+([A-Za-z][A-Za-z .]+?),?\s+([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)$/,
    read: (m) => regionLocality("CA", m[1]!, m[2]!, m[3]!),
  },
  {
    country: "AU",
    pattern: new RegExp(`(?:^|,)\\s*([^,]+?),?\\s+(${AU_STATES}),?\\s+(\\d{4})$`, "i"),
    read: (m) => ({ city: m[1]!.trim(), region: m[2]!.toUpperCase(), postal: m[3]!, country: "AU" }),
  },
  {
    country: "GB",
    pattern: /(?:^|,)\s*([^,]+?),?\s+(?:[A-Za-z]{2,3}\s+)?([A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2})$/,
    read: (m) => ({ city: m[1]!.trim(), region: "", postal: formatPostal("GB", m[2]!), country: "GB" }),
  },
  {
    country: null,
    pattern: /(?:^|,)\s*(\d{4}\s?[A-Za-z]{2}(?=\s)|\d{3}-\d{4}|\d{2}-\d{3}|\d{4,6})\s+([^,\d][^,]*)$/,
    read: (m) => ({ city: m[2]!.trim(), region: "", postal: m[1]!.toUpperCase(), country: "" }),
  },
  {
    country: null,
    pattern: /(?:^|,)\s*([^,\d][^,]*?),?\s+(?:([A-Za-z]{2,3})\s+)?(\d{3,6}(?:[- ]\d{2,4})?)$/,
    read: (m) => ({ city: m[1]!.trim(), region: m[2]?.toUpperCase() ?? "", postal: m[3]!, country: "" }),
  },
  {
    country: "US",
    pattern: /,\s*([^,]+?),?\s+([A-Za-z]{2})$|^([^,]+?),\s*([A-Za-z]{2})$/,
    read: (m) => regionLocality("US", m[1] ?? m[3]!, m[2] ?? m[4]!, ""),
  },
  {
    country: "CA",
    pattern: /,\s*([^,]+?),?\s+([A-Za-z]{2})$|^([^,]+?),\s*([A-Za-z]{2})$/,
    read: (m) => regionLocality("CA", m[1] ?? m[3]!, m[2] ?? m[4]!, ""),
  },
];

function regionLocality(country: "US" | "CA", city: string, region: string, postal: string): Locality | null {
  const known = lookupRegion(country, region.trim());
  if (!known) return null;
  return { city: city.trim(), region: known.code, postal: postal ? formatPostal(country, postal) : "", country };
}

function matchLocality(text: string, country: string | null): { locality: Locality; before: string } | null {
  for (const entry of LOCALITY_PATTERNS) {
    if (country && entry.country && entry.country !== country) continue;
    const match = text.match(entry.pattern);
    if (!match || match.index === undefined) continue;
    const locality = entry.read(match);
    if (!locality?.city) continue;
    return { locality, before: text.slice(0, match.index).replace(/[,\s]+$/, "") };
  }
  return null;
}

const TWO_LETTERS = /^[A-Za-z]{2}$/;
const ENDS_IN_POSTAL = /(?:\d{3,}|[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d|\d[A-Za-z]{2})$/;

/**
 * The trailing line or comma part, when it names the country. On one line a bare `CA` or `OR` after a city
 * is the state, unless the part before it ends in a postal code.
 */
function trailingCountry(part: string, oneLine: boolean, previous: string): string | null {
  const code = countryCode(part);
  if (!code) return null;
  if (!oneLine || !TWO_LETTERS.test(part.trim())) return code;
  if (lookupCountry(part) && !lookupRegion("US", part)) return code;
  return ENDS_IN_POSTAL.test(previous.trim()) ? code : null;
}

/**
 * Splits an address into carrier parts. Handles one-line (`14 Dock St, Portland, OR 97209`) and multi-line
 * text, US, Canadian, Australian, and UK forms, and the `12345 City` or `City 12345` forms elsewhere.
 * Falls back to the stored city, region, and country for parts the text does not say.
 */
export function shipAddressParts(input: ShipAddressInput): ShipAddressParts {
  const text = input.text?.trim() ?? "";
  let lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const oneLine = lines.length === 1;
  if (oneLine) lines = lines[0]!.split(/\s*,\s*/).filter(Boolean);

  let country = "";
  if (lines.length > 1) {
    const named = trailingCountry(lines[lines.length - 1]!, oneLine, lines[lines.length - 2]!);
    if (named) {
      country = named;
      lines = lines.slice(0, -1);
    }
  }
  const hintCountry = countryCode(input.country) ?? "";

  let streetLines: string[] = [];
  let locality: Locality | null = null;
  if (oneLine) {
    const hit = matchLocality(lines.join(", "), country || null);
    if (hit) {
      locality = hit.locality;
      streetLines = hit.before ? hit.before.split(/\s*,\s*/) : [];
    }
  } else if (lines.length) {
    const last = lines[lines.length - 1]!;
    const hit = matchLocality(last, country || null);
    if (hit) {
      locality = hit.locality;
      streetLines = [...lines.slice(0, -1), ...(hit.before ? [hit.before] : [])];
    }
  }

  if (!locality) {
    const leadingStreet = oneLine && lines.length > 1 && /\d/.test(lines[0]!) ? lines[0]! : null;
    const rest = leadingStreet ? lines.slice(1).join(", ") : oneLine ? text : lines.join("\n");
    const parsed = parseAddressText(country ? `${rest}\n${country}` : rest);
    const parsedStreet = leadingStreet ?? parsed.street ?? "";
    const street = parsedStreet.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    return {
      street1: street[0] ?? "",
      street2: street.slice(1).join(", "),
      city: parsed.city?.trim() || input.city?.trim() || "",
      region: parsed.region?.trim() || input.region?.trim() || "",
      postal: parsed.postal?.trim() || "",
      country: countryCode(parsed.country) || country || hintCountry,
    };
  }
  return {
    street1: streetLines[0] ?? "",
    street2: streetLines.slice(1).join(", "),
    city: locality.city || input.city?.trim() || "",
    region: locality.region || input.region?.trim() || "",
    postal: locality.postal,
    country: country || locality.country || hintCountry,
  };
}

/** The address back as text, one part per line, the way a label prints it. */
export function formatShipAddress(parts: ShipAddressParts): string {
  const cityLine = [parts.city, [parts.region, parts.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [parts.street1, parts.street2, cityLine, parts.country].filter(Boolean).join("\n");
}
