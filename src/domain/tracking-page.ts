import { resolveService } from "./carriers";
import { normalizeTrackerStatus, type TrackerStatus } from "./tracker";

export type TrackingEvent = {
  at: number;
  status: TrackerStatus | null;
  label: string;
  message: string | null;
  /** City, region, and country. Never a street or postcode. */
  place: string | null;
};

export type TrackerHistory = {
  /** Newest first. */
  events: TrackingEvent[];
  estimatedDeliveryAt: number | null;
};

export type TrackerReceipt = { payloadJson: string; createdAt: number };

const STATUS_LABELS: Record<TrackerStatus, string> = {
  pre_transit: "Label created",
  in_transit: "In transit",
  delivered: "Delivered",
  exception: "Delivery problem",
};

/** Raw carrier statuses worth a sharper label than their normalized group. */
const DETAIL_LABELS: Record<string, string> = {
  out_for_delivery: "Out for delivery",
  outfordelivery: "Out for delivery",
  available_for_pickup: "Ready for pickup",
  availableforpickup: "Ready for pickup",
  return_to_sender: "Returning to sender",
  returntosender: "Returning to sender",
  at: "Delivery attempted",
};

export function trackerStatusLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const detail = DETAIL_LABELS[raw.trim().toLowerCase().replace(/[\s-]+/g, "_")];
  if (detail) return detail;
  const status = normalizeTrackerStatus(raw);
  return status ? STATUS_LABELS[status] : null;
}

/**
 * One tracking number's history from its stored tracker webhooks. EasyPost and ShipEngine send the
 * whole history on every update; the demo carrier and hand-sent updates carry one status each.
 */
export function trackerHistory(receipts: TrackerReceipt[]): TrackerHistory {
  const events = new Map<string, TrackingEvent>();
  let estimatedDeliveryAt: number | null = null;
  for (const receipt of [...receipts].sort((a, b) => a.createdAt - b.createdAt)) {
    const payload = parseJson(receipt.payloadJson);
    if (!payload) continue;
    const parsed = receiptEvents(payload, receipt.createdAt);
    for (const event of parsed.events) events.set(`${event.at}|${event.status}|${event.message ?? ""}`, event);
    if (parsed.estimatedDeliveryAt != null) estimatedDeliveryAt = parsed.estimatedDeliveryAt;
  }
  return { events: [...events.values()].sort((a, b) => b.at - a.at), estimatedDeliveryAt };
}

function receiptEvents(
  payload: Record<string, unknown>,
  receivedAt: number,
): { events: TrackingEvent[]; estimatedDeliveryAt: number | null } {
  const easyPost = asRecord(payload.result) ?? asRecord(payload.tracker) ?? (payload.object === "Tracker" ? payload : null);
  if (easyPost && (text(easyPost.tracking_code) || text(easyPost.tracking_number))) {
    const details = Array.isArray(easyPost.tracking_details) ? easyPost.tracking_details : [];
    const events = details.map(easyPostDetail).filter((row): row is TrackingEvent => row !== null);
    return {
      events: events.length > 0 ? events : singleEvent(text(easyPost.status), null, receivedAt),
      estimatedDeliveryAt: parseTime(easyPost.est_delivery_date),
    };
  }
  const shipEngine = asRecord(payload.data) ?? (payload.resource_type ? payload : null);
  if (shipEngine && (text(shipEngine.tracking_number) || text(payload.tracking_number))) {
    const list = Array.isArray(shipEngine.events) ? shipEngine.events : [];
    const events = list.map(shipEngineEvent).filter((row): row is TrackingEvent => row !== null);
    const status = text(shipEngine.status_code) ?? text(shipEngine.status);
    return {
      events: events.length > 0 ? events : singleEvent(status, text(shipEngine.status_description), receivedAt),
      estimatedDeliveryAt: parseTime(shipEngine.estimated_delivery_date),
    };
  }
  const status = text(payload.status) ?? text(payload.status_code) ?? text(payload.statusCode);
  return {
    events: singleEvent(status, text(payload.message) ?? text(payload.description), parseTime(payload.at) ?? receivedAt),
    estimatedDeliveryAt: parseTime(payload.estimatedDeliveryAt) ?? parseTime(payload.est_delivery_date),
  };
}

function singleEvent(raw: string | null, message: string | null, at: number): TrackingEvent[] {
  const label = trackerStatusLabel(raw);
  if (!label) return [];
  return [{ at, status: normalizeTrackerStatus(raw), label, message, place: null }];
}

function easyPostDetail(value: unknown): TrackingEvent | null {
  const row = asRecord(value);
  const at = row ? parseTime(row.datetime) : null;
  if (!row || at == null) return null;
  const raw = text(row.status);
  const location = asRecord(row.tracking_location);
  return {
    at,
    status: normalizeTrackerStatus(raw),
    label: trackerStatusLabel(raw) ?? "Update",
    message: text(row.message) ?? text(row.description),
    place: placeLine(text(location?.city), text(location?.state), text(location?.country)),
  };
}

function shipEngineEvent(value: unknown): TrackingEvent | null {
  const row = asRecord(value);
  const at = row ? (parseTime(row.occurred_at) ?? parseTime(row.carrier_occurred_at)) : null;
  if (!row || at == null) return null;
  const raw = text(row.status_code) ?? text(row.status);
  return {
    at,
    status: normalizeTrackerStatus(raw),
    label: trackerStatusLabel(raw) ?? "Update",
    message: text(row.description) ?? text(row.carrier_status_description),
    place: placeLine(text(row.city_locality), text(row.state_province), text(row.country_code)),
  };
}

/**
 * City, region, country for public pages. Older one-line addresses stored the street in the city
 * column ("1 Main St, Austin"), so anything carrying digits (streets, postcodes) is dropped.
 */
export function placeLine(
  city: string | null | undefined,
  region: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const parts = [wordPart(city), wordPart(region?.replace(/\s+\S*\d\S*/g, "")), wordPart(country)]
    .filter((part): part is string => Boolean(part))
    .map(tidyCase);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** The last comma part without digits. */
function wordPart(value: string | null | undefined): string | null {
  const parts = (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/\d/.test(part));
  return parts.at(-1) ?? null;
}

/** Carriers shout ("SAN FRANCISCO"); short codes like "OR" or "US" stay as they are. */
function tidyCase(value: string): string {
  if (value.length <= 3 || value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase());
}

export type PublicTrackingLine = { name: string; qty: number };

export type PublicTrackingPackage = {
  label: string;
  carrier: string | null;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: TrackerStatus | null;
  statusLabel: string;
  estimatedDeliveryAt: number | null;
  deliveredAt: number | null;
  events: TrackingEvent[];
  items: PublicTrackingLine[];
};

export type PublicTrackingView = {
  shop: { name: string; brandColor: string | null; logoUrl: string | null };
  order: {
    number: string;
    status: "processing" | "shipped" | "delivered" | "cancelled";
    shippedAt: number | null;
    destination: string | null;
  };
  packages: PublicTrackingPackage[];
  items: PublicTrackingLine[];
};

type TrackedParcel = {
  trackingNumber: string | null;
  trackingCompany: string | null;
  trackingUrl: string | null;
  carrierService: string | null;
  trackerStatus: string | null;
  shippedAt: number | null;
};

export type TrackingPageInput = {
  shop: { name: string; brandColor: string | null; logoUrl: string | null };
  order: TrackedParcel & {
    number: string;
    status: string;
    shipToCity: string | null;
    shipToRegion: string | null;
    shipToCountry: string | null;
  };
  /** Cartons in `seq` order; empty when the order went out as one parcel. */
  packages: Array<TrackedParcel & { items: PublicTrackingLine[] }>;
  items: PublicTrackingLine[];
  receiptsByTracking: Map<string, TrackerReceipt[]>;
};

/**
 * What the public tracking page may show. Built from named fields only, so ids, costs, the street,
 * the postcode, and other orders cannot leak through a spread.
 */
export function publicTrackingView(input: TrackingPageInput): PublicTrackingView {
  const sent = input.packages.filter((row) => row.trackingNumber || row.shippedAt);
  const parcels =
    sent.length > 0
      ? sent
      : input.order.trackingNumber || input.order.shippedAt
        ? [{ ...pickParcel(input.order), items: input.items }]
        : [];
  const packages = parcels.map((parcel, index) =>
    publicPackage(parcel, parcels.length > 1 ? `Package ${index + 1} of ${parcels.length}` : "Package", input.receiptsByTracking),
  );
  return {
    shop: { name: input.shop.name, brandColor: input.shop.brandColor, logoUrl: input.shop.logoUrl },
    order: {
      number: input.order.number,
      status: orderStatus(input.order.status, packages),
      shippedAt: input.order.shippedAt ?? packages.find((row) => row.events.length > 0)?.events.at(-1)?.at ?? null,
      destination: placeLine(input.order.shipToCity, input.order.shipToRegion, input.order.shipToCountry),
    },
    packages,
    items: input.items.map((line) => ({ name: line.name, qty: line.qty })),
  };
}

function pickParcel(row: TrackedParcel): TrackedParcel {
  return {
    trackingNumber: row.trackingNumber,
    trackingCompany: row.trackingCompany,
    trackingUrl: row.trackingUrl,
    carrierService: row.carrierService,
    trackerStatus: row.trackerStatus,
    shippedAt: row.shippedAt,
  };
}

function publicPackage(
  parcel: TrackedParcel & { items: PublicTrackingLine[] },
  label: string,
  receiptsByTracking: Map<string, TrackerReceipt[]>,
): PublicTrackingPackage {
  const history = parcel.trackingNumber ? trackerHistory(receiptsByTracking.get(parcel.trackingNumber) ?? []) : null;
  const carrierEvents = history?.events ?? [];
  const latest = carrierEvents.find((event) => event.status);
  const status = normalizeTrackerStatus(parcel.trackerStatus) ?? latest?.status ?? (parcel.shippedAt ? "pre_transit" : null);
  const events = [...carrierEvents];
  if (parcel.shippedAt && !events.some((event) => event.at === parcel.shippedAt)) {
    events.push({ at: parcel.shippedAt, status: "pre_transit", label: "Shipped", message: null, place: null });
    events.sort((a, b) => b.at - a.at);
  }
  const service = resolveService(parcel.carrierService);
  const delivered = carrierEvents.find((event) => event.status === "delivered");
  return {
    label,
    carrier: parcel.trackingCompany ?? service?.company ?? null,
    service: service ? `${service.company} ${service.service}` : null,
    trackingNumber: parcel.trackingNumber,
    trackingUrl: safeLink(parcel.trackingUrl),
    status,
    statusLabel: packageHeadline(status, latest),
    estimatedDeliveryAt: status === "delivered" ? null : (history?.estimatedDeliveryAt ?? null),
    deliveredAt: status === "delivered" ? (delivered?.at ?? null) : null,
    events,
    items: parcel.items.map((line) => ({ name: line.name, qty: line.qty })),
  };
}

function packageHeadline(status: TrackerStatus | null, latest: TrackingEvent | undefined): string {
  if (!status) return "Getting ready";
  if (latest?.status === status && latest.label !== STATUS_LABELS[status]) return latest.label;
  return status === "pre_transit" ? "Shipped" : STATUS_LABELS[status];
}

function orderStatus(status: string, packages: PublicTrackingPackage[]): PublicTrackingView["order"]["status"] {
  if (status === "cancelled") return "cancelled";
  if (packages.length > 0 && packages.every((row) => row.status === "delivered")) return "delivered";
  if (status === "shipped" || packages.length > 0) return "shipped";
  return "processing";
}

/** A link a public page may render: http or https only. */
export function safeLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
