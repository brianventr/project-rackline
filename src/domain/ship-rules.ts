import { parseAddressText } from "./geo";
import { lookupCountry, lookupRegion } from "./geo-gazetteer";
import { formatOz } from "./ship-defaults";

/** Order sources a rule can match. Crowdfunding imports (`crowdfunding:kickstarter`, …) match as one channel. */
export const SHIP_RULE_CHANNELS = ["shopify", "etsy", "woocommerce", "faire", "manual", "crowdfunding"] as const;
export type ShipRuleChannel = (typeof SHIP_RULE_CHANNELS)[number];

export const SHIP_RULE_CHANNEL_LABELS: Record<ShipRuleChannel, string> = {
  shopify: "Shopify",
  etsy: "Etsy",
  woocommerce: "WooCommerce",
  faire: "Faire",
  manual: "Manual",
  crowdfunding: "Crowdfunding",
};

/** How a building (or a rule) picks the service when nothing names one; see `domain/rate-choice.ts`. */
export const RATE_STRATEGIES = ["default", "cheapest", "fastest", "on_time"] as const;
export type RateStrategy = (typeof RATE_STRATEGIES)[number];

export const RATE_STRATEGY_LABELS: Record<RateStrategy, string> = {
  default: "Default service",
  cheapest: "Cheapest",
  fastest: "Fastest",
  on_time: "Cheapest on time",
};

export function isRateStrategy(value: unknown): value is RateStrategy {
  return typeof value === "string" && (RATE_STRATEGIES as readonly string[]).includes(value);
}

/** Every field that is set must match; a list matches when any entry does. No fields matches every order. */
export type ShipRuleConditions = {
  skus?: string[];
  minWeightOz?: number;
  maxWeightOz?: number;
  /** Distinct SKUs on the order. */
  minItems?: number;
  maxItems?: number;
  minUnits?: number;
  maxUnits?: number;
  /** ISO codes: US, CA, GB. */
  countries?: string[];
  /** State or province codes: CA, NY, ON. */
  regions?: string[];
  postalPrefixes?: string[];
  channels?: ShipRuleChannel[];
};

export type ShipRule = {
  id: string;
  name: string;
  position: number;
  enabled: boolean;
  /** Null runs the rule in every building. */
  warehouseId: string | null;
  conditions: ShipRuleConditions;
  presetId: string | null;
  carrierService: string | null;
  carrierConnectionId: string | null;
  rateStrategy: RateStrategy | null;
  /** Keep matching orders out of one-click ship until someone looks. */
  hold: boolean;
};

export type ShipRuleOrder = {
  warehouseId: string;
  source: string;
  shipToAddress?: string | null;
  shipToRegion?: string | null;
  shipToCountry?: string | null;
  lines: { sku: string; qty: number; shipWeightOz?: number | null }[];
  /** A weight typed on the order or read off the scale. Without one, the SKU ship weights are summed. */
  weightOz?: number | null;
};

export type ShipRuleFacts = {
  skus: Set<string>;
  items: number;
  units: number;
  /** Null when a SKU has no ship weight and none was typed, so weight conditions cannot match. */
  weightOz: number | null;
  country: string | null;
  region: string | null;
  postal: string | null;
  channel: string;
};

export function shipRuleChannel(source: string | null | undefined): string {
  const value = (source || "manual").trim().toLowerCase();
  if (value === "pledge" || value.startsWith("crowdfunding:")) return "crowdfunding";
  return value;
}

function skuKey(sku: string): string {
  return sku.trim().toUpperCase();
}

function codeKey(value: string | null | undefined): string | null {
  const key = (value ?? "").replace(/\s+/g, "").toUpperCase();
  return key || null;
}

export function shipRuleFacts(order: ShipRuleOrder): ShipRuleFacts {
  const lines = order.lines.filter((line) => line.qty > 0);
  const parsed = order.shipToAddress?.trim() ? parseAddressText(order.shipToAddress) : {};
  const typed = order.weightOz != null && order.weightOz > 0 ? order.weightOz : null;
  const unweighed = lines.some((line) => !(line.shipWeightOz != null && line.shipWeightOz > 0));
  const summed = lines.reduce((sum, line) => sum + line.qty * (line.shipWeightOz ?? 0), 0);
  const skus = new Set(lines.map((line) => skuKey(line.sku)));
  return {
    skus,
    items: skus.size,
    units: lines.reduce((sum, line) => sum + line.qty, 0),
    weightOz: typed ?? (unweighed || lines.length === 0 ? null : summed),
    country: codeKey(order.shipToCountry || parsed.country),
    region: codeKey(order.shipToRegion || parsed.region),
    postal: codeKey(parsed.postal),
    channel: shipRuleChannel(order.source),
  };
}

function within(value: number | null, min: number | undefined, max: number | undefined): boolean {
  if (min == null && max == null) return true;
  if (value == null) return false;
  return (min == null || value >= min) && (max == null || value <= max);
}

export function shipRuleMatches(conditions: ShipRuleConditions, facts: ShipRuleFacts): boolean {
  const c = conditions;
  if (c.skus?.length && !c.skus.some((sku) => facts.skus.has(skuKey(sku)))) return false;
  if (!within(facts.weightOz, c.minWeightOz, c.maxWeightOz)) return false;
  if (!within(facts.items, c.minItems, c.maxItems)) return false;
  if (!within(facts.units, c.minUnits, c.maxUnits)) return false;
  if (c.countries?.length && !(facts.country && c.countries.includes(facts.country))) return false;
  if (c.regions?.length && !(facts.region && c.regions.includes(facts.region))) return false;
  if (c.postalPrefixes?.length) {
    const postal = facts.postal;
    if (!postal || !c.postalPrefixes.some((prefix) => postal.startsWith(prefix))) return false;
  }
  if (c.channels?.length && !(c.channels as string[]).includes(facts.channel)) return false;
  return true;
}

/** The rules that run in a building, in the order they are checked. */
export function rulesForBuilding<T extends Pick<ShipRule, "warehouseId" | "position" | "name" | "id">>(
  rules: T[],
  warehouseId: string,
): T[] {
  return rules
    .filter((rule) => rule.warehouseId == null || rule.warehouseId === warehouseId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** First enabled rule, top to bottom, whose conditions all match. */
export function matchShipRule(rules: ShipRule[], order: ShipRuleOrder): ShipRule | null {
  const facts = shipRuleFacts(order);
  return rulesForBuilding(rules, order.warehouseId).find((rule) => rule.enabled && shipRuleMatches(rule.conditions, facts)) ?? null;
}

/* ------------------------------------------------------------------ stored form */

/** Reads `conditions_json`, dropping anything malformed instead of failing the whole queue. */
export function parseShipRuleConditions(json: string | null | undefined): ShipRuleConditions {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  try {
    return parseConditions(raw as Record<string, unknown>);
  } catch {
    return {};
  }
}

export type ShipRuleInput = Omit<ShipRule, "id" | "position">;

const MAX_LIST = 200;

function listOf(value: unknown, label: string): string[] {
  if (value == null || value === "") return [];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]+/) : null;
  if (!raw) throw new Error(`${label} must be a list`);
  const out = [...new Set(raw.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean))];
  if (out.length > MAX_LIST) throw new Error(`${label} can list at most ${MAX_LIST} entries`);
  return out;
}

function wholeOrUndefined(value: unknown, label: string): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a whole number, 0 or more`);
  return n;
}

function range(body: Record<string, unknown>, minKey: string, maxKey: string, label: string) {
  const min = wholeOrUndefined(body[minKey], `Minimum ${label}`);
  const max = wholeOrUndefined(body[maxKey], `Maximum ${label}`);
  if (min != null && max != null && min > max) throw new Error(`Minimum ${label} is more than the maximum`);
  return { min, max };
}

function countryCode(entry: string): string {
  const found = lookupCountry(entry);
  if (found) return found.code;
  if (/^[A-Za-z]{2}$/.test(entry)) return entry.toUpperCase();
  throw new Error(`Use a two-letter country code for ${entry}, like US or CA`);
}

function regionCode(entry: string): string {
  return lookupRegion("US", entry)?.code ?? lookupRegion("CA", entry)?.code ?? entry.replace(/\s+/g, "").toUpperCase();
}

function parseConditions(body: Record<string, unknown>): ShipRuleConditions {
  const out: ShipRuleConditions = {};
  const skus = listOf(body.skus, "SKUs").map(skuKey);
  if (skus.length) out.skus = [...new Set(skus)];
  const weight = range(body, "minWeightOz", "maxWeightOz", "weight");
  if (weight.min != null) out.minWeightOz = weight.min;
  if (weight.max != null) out.maxWeightOz = weight.max;
  const items = range(body, "minItems", "maxItems", "items");
  if (items.min != null) out.minItems = items.min;
  if (items.max != null) out.maxItems = items.max;
  const units = range(body, "minUnits", "maxUnits", "units");
  if (units.min != null) out.minUnits = units.min;
  if (units.max != null) out.maxUnits = units.max;
  const countries = [...new Set(listOf(body.countries, "Countries").map(countryCode))];
  if (countries.length) out.countries = countries;
  const regions = [...new Set(listOf(body.regions, "States").map(regionCode))];
  if (regions.length) out.regions = regions;
  const postal = [...new Set(listOf(body.postalPrefixes, "Postal codes").map((entry) => entry.replace(/\s+/g, "").toUpperCase()))];
  if (postal.length) out.postalPrefixes = postal;
  const channels = listOf(body.channels, "Channels").map((entry) => entry.toLowerCase());
  for (const channel of channels) {
    if (!(SHIP_RULE_CHANNELS as readonly string[]).includes(channel)) throw new Error(`Unknown channel ${channel}`);
  }
  if (channels.length) out.channels = [...new Set(channels)] as ShipRuleChannel[];
  return out;
}

function optionalId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Validates a rule from the setup screen. The route still checks that the box, service, and building
 * belong to the org and that a carrier account offers the service.
 */
export function parseShipRuleInput(body: Record<string, unknown>): ShipRuleInput {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new Error("Rule name is required");
  if (name.length > 80) throw new Error("Keep the rule name under 80 characters");
  const conditionsRaw = body.conditions ?? {};
  if (!conditionsRaw || typeof conditionsRaw !== "object" || Array.isArray(conditionsRaw)) {
    throw new Error("Conditions must be an object");
  }
  const conditions = parseConditions(conditionsRaw as Record<string, unknown>);
  const presetId = optionalId(body.presetId);
  const carrierService = optionalId(body.carrierService);
  const rawStrategy = body.rateStrategy == null || body.rateStrategy === "" ? null : body.rateStrategy;
  if (rawStrategy !== null && !isRateStrategy(rawStrategy)) throw new Error("Unknown rate choice");
  const rateStrategy = rawStrategy as RateStrategy | null;
  if (carrierService && rateStrategy) throw new Error("Pick a service or a rate choice, not both");
  const hold = body.hold === true;
  if (!presetId && !carrierService && !rateStrategy && !hold) {
    throw new Error("Give the rule something to do: a box, a service, a rate choice, or hold for review");
  }
  return {
    name,
    enabled: body.enabled !== false,
    warehouseId: optionalId(body.warehouseId),
    conditions,
    presetId,
    carrierService,
    carrierConnectionId: carrierService ? optionalId(body.carrierConnectionId) : null,
    rateStrategy,
    hold,
  };
}

/** New positions for `ids` in the order given; rules left out keep their place after them. */
export function reorderShipRules(rules: { id: string; position: number }[], ids: string[]): { id: string; position: number }[] {
  const known = new Set(rules.map((rule) => rule.id));
  const listed = [...new Set(ids.filter((id) => known.has(id)))];
  const rest = [...rules]
    .filter((rule) => !listed.includes(rule.id))
    .sort((a, b) => a.position - b.position)
    .map((rule) => rule.id);
  return [...listed, ...rest].map((id, index) => ({ id, position: index + 1 }));
}

/* ------------------------------------------------------------------ plain words */

function orList(values: string[]): string {
  if (values.length <= 2) return values.join(" or ");
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}

function rangeText(min: number | undefined, max: number | undefined, format: (n: number) => string): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return min === max ? format(min) : `${format(min)} to ${format(max)}`;
  if (min != null) return `${format(min)} or more`;
  return `up to ${format(max!)}`;
}

/** One phrase per condition, for the rules list: `SKU LAMP or SHADE`, `Weight up to 1 lb`. */
export function describeShipRuleConditions(conditions: ShipRuleConditions): string[] {
  const c = conditions;
  const parts: string[] = [];
  if (c.skus?.length) parts.push(`SKU ${orList(c.skus)}`);
  const weight = rangeText(c.minWeightOz, c.maxWeightOz, formatOz);
  if (weight) parts.push(`Weight ${weight}`);
  const items = rangeText(c.minItems, c.maxItems, String);
  if (items) parts.push(`${items} ${c.minItems === 1 && c.maxItems === 1 ? "SKU" : "SKUs"}`);
  const units = rangeText(c.minUnits, c.maxUnits, String);
  if (units) parts.push(`${units} ${c.minUnits === 1 && c.maxUnits === 1 ? "unit" : "units"}`);
  if (c.countries?.length) parts.push(`To ${orList(c.countries)}`);
  if (c.regions?.length) parts.push(`State ${orList(c.regions)}`);
  if (c.postalPrefixes?.length) parts.push(`Postal code starts ${orList(c.postalPrefixes)}`);
  if (c.channels?.length) parts.push(`From ${orList(c.channels.map((channel) => SHIP_RULE_CHANNEL_LABELS[channel]))}`);
  return parts.length ? parts : ["Every order"];
}
