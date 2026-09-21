import { parseAddressText, type AddressParts } from "./geo";
import type { CarrierProviderId, CarrierRateQuote, EnabledCarrierService } from "./carriers";

export const DEFAULT_PARCEL = {
  weightOz: 16,
  lengthIn: 12,
  widthIn: 9,
  heightIn: 6,
} as const;

export type ParcelDims = {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

export type LiveShipAddress = {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

export class CarrierLiveError extends Error {
  constructor(
    message: string,
    public code: "CARRIER_LIVE" | "LIVE_ADDRESS" | "NO_RATE" = "CARRIER_LIVE",
  ) {
    super(message);
    this.name = "CarrierLiveError";
  }
}

export function isLiveAggregator(provider: string, mode: string): boolean {
  return mode === "live" && (provider === "easypost" || provider === "shipengine");
}

export function resolveParcel(input?: Partial<ParcelDims> | null): ParcelDims {
  const weightOz = input?.weightOz && input.weightOz > 0 ? input.weightOz : DEFAULT_PARCEL.weightOz;
  const lengthIn = input?.lengthIn && input.lengthIn > 0 ? input.lengthIn : DEFAULT_PARCEL.lengthIn;
  const widthIn = input?.widthIn && input.widthIn > 0 ? input.widthIn : DEFAULT_PARCEL.widthIn;
  const heightIn = input?.heightIn && input.heightIn > 0 ? input.heightIn : DEFAULT_PARCEL.heightIn;
  return { weightOz, lengthIn, widthIn, heightIn };
}

const STREET_CITY_ST_ZIP =
  /^(.+),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)(?:\s*,?\s*([A-Za-z]{2}))?$/;

export function liveShipAddress(input: {
  name: string;
  text?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): LiveShipAddress | { error: string } {
  const text = input.text?.trim() || "";
  const oneLine = text.split(/\n+/).length === 1 ? text.match(STREET_CITY_ST_ZIP) : null;
  const parsed: AddressParts = oneLine
    ? {
        street: oneLine[1]!.trim(),
        city: oneLine[2]!.trim(),
        region: oneLine[3]!.toUpperCase(),
        postal: oneLine[4]!,
        country: oneLine[5]?.toUpperCase() || "US",
      }
    : parseAddressText(text);
  const city = parsed.city || input.city?.trim() || "";
  const state = parsed.region || input.region?.trim() || "";
  const zip = parsed.postal?.trim() || "";
  const country = (parsed.country || input.country?.trim() || "US").toUpperCase();
  const street1 = parsed.street?.trim() || "";
  if (!street1 || !city || !state || !zip) {
    return { error: "Live postage needs a street, city, region, and postal code on ship-from and ship-to." };
  }
  return {
    name: input.name.trim() || "Warehouse",
    street1,
    city,
    state,
    zip,
    country: country.length === 2 ? country : "US",
  };
}

export function requireLiveShipAddress(input: {
  name: string;
  text?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): LiveShipAddress {
  const next = liveShipAddress(input);
  if ("error" in next) throw new CarrierLiveError(next.error, "LIVE_ADDRESS");
  return next;
}

const SERVICE_ALIASES: Record<string, string> = {
  ups_ground: "ups_ground",
  ground: "ups_ground",
  upsground: "ups_ground",
  ups_2nd_day_air: "ups_2day",
  ups_2nddayair: "ups_2day",
  "2nddayair": "ups_2day",
  ups_next_day_air: "ups_next_day",
  nextdayair: "ups_next_day",
  fedex_ground: "fedex_ground",
  fedexground: "fedex_ground",
  fedex_home_delivery: "fedex_home",
  homedelivery: "fedex_home",
  fedex_2day: "fedex_2day",
  fedex2day: "fedex_2day",
  usps_priority_mail: "usps_priority",
  priority: "usps_priority",
  prioritymail: "usps_priority",
  usps_ground_advantage: "usps_ground_advantage",
  groundadvantage: "usps_ground_advantage",
  usps_priority_mail_express: "usps_express",
  express: "usps_express",
  prioritymailexpress: "usps_express",
  dhl_express: "dhl_express",
  dhl_express_worldwide: "dhl_express",
  expressworldwide: "dhl_express",
};

export function mapAggregatorService(carrier: string, service: string): string | null {
  const carrierKey = carrier.toLowerCase().replace(/[^a-z0-9]/g, "");
  const serviceKey = service.toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliased = SERVICE_ALIASES[service.toLowerCase()] || SERVICE_ALIASES[serviceKey];
  if (aliased) {
    if (carrierKey.includes("fedex") && aliased.startsWith("ups_")) return null;
    if (carrierKey.includes("usps") && aliased.startsWith("ups_")) {
      if (aliased === "ups_ground") return "usps_ground_advantage";
      return aliased.startsWith("usps_") ? aliased : null;
    }
    if (carrierKey.includes("dhl") && !aliased.startsWith("dhl_")) return "dhl_express";
    if (carrierKey.includes("ups") && aliased.startsWith("ups_")) return aliased;
    if (carrierKey.includes("fedex") && aliased.startsWith("fedex_")) return aliased;
    if (carrierKey.includes("usps") && aliased.startsWith("usps_")) return aliased;
    if (!carrierKey) return aliased;
  }
  if (carrierKey.includes("ups")) {
    if (serviceKey.includes("next") || serviceKey.includes("overnight")) return "ups_next_day";
    if (serviceKey.includes("2nd") || serviceKey.includes("2day")) return "ups_2day";
    return "ups_ground";
  }
  if (carrierKey.includes("fedex")) {
    if (serviceKey.includes("home")) return "fedex_home";
    if (serviceKey.includes("2day") || serviceKey.includes("2nd")) return "fedex_2day";
    return "fedex_ground";
  }
  if (carrierKey.includes("usps")) {
    if (serviceKey.includes("express")) return "usps_express";
    if (serviceKey.includes("advantage") || serviceKey.includes("ground")) return "usps_ground_advantage";
    return "usps_priority";
  }
  if (carrierKey.includes("dhl")) return "dhl_express";
  return aliased ?? null;
}

export function shipEngineServiceCode(serviceId: string): string {
  switch (serviceId) {
    case "ups_2day":
      return "ups_2nd_day_air";
    case "ups_next_day":
      return "ups_next_day_air";
    case "fedex_home":
      return "fedex_home_delivery";
    case "usps_priority":
      return "usps_priority_mail";
    case "usps_express":
      return "usps_priority_mail_express";
    case "dhl_express":
      return "dhl_express_worldwide";
    default:
      return serviceId;
  }
}

export function toLiveRateQuote(
  service: EnabledCarrierService,
  input: { amountCents: number; transitDays?: number | null; liveRateId?: string | null },
): CarrierRateQuote {
  return {
    ...service,
    amountCents: Math.max(0, Math.round(input.amountCents)),
    currency: "USD",
    transitDays: input.transitDays && input.transitDays > 0 ? input.transitDays : 5,
    liveRateId: input.liveRateId ?? null,
  };
}

export type LiveLabelResult = {
  trackingNumber: string;
  trackingUrl?: string | null;
  shipmentId?: string | null;
  labelId?: string | null;
  postageCents?: number | null;
  provider: CarrierProviderId;
};

export function pickMatchingLiveRate<T extends { serviceId: string; amountCents: number }>(
  rates: T[],
  serviceId: string,
): T | null {
  const matches = rates.filter((row) => row.serviceId === serviceId);
  if (matches.length === 0) return null;
  return matches.reduce((best, row) => (row.amountCents < best.amountCents ? row : best));
}
