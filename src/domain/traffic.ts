import { resolveOrderDest, resolveOrigin, type GeoPlace } from "./geo";
import { lookupCountry, lookupRegion } from "./geo-gazetteer";
import { haversineMiles, interpolateGreatCircle } from "./geo-arc";
import { normalizeTrackerStatus, trackerToFlight } from "./tracker";

export type TrafficGrain = "country" | "region" | "city";
export type TrafficHorizon = "now" | "7d" | "30d";
export type TrafficFlightStatus = "at_gate" | "in_flight" | "arrived_estimate" | "arrived" | "exception" | "unmapped";

export type TrafficSkuQty = {
  itemId: string;
  sku: string;
  name: string;
  qty: number;
};

export type TrafficOrigin = {
  warehouseId: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

export type TrafficFlight = {
  orderId: string;
  number: string;
  trackingNumber: string | null;
  carrierService: string | null;
  status: TrafficFlightStatus;
  departedAt: number | null;
  etaAt: number | null;
  progress: number;
  position: { lat: number; lng: number } | null;
  origin: { warehouseId: string; lat: number; lng: number };
  dest: { city: string | null; region: string | null; country: string; lat: number; lng: number };
  skus: TrafficSkuQty[];
  units: number;
};

export type TrafficDestination = {
  key: string;
  grain: TrafficGrain;
  city: string | null;
  region: string | null;
  country: string;
  lat: number;
  lng: number;
  orders: number;
  units: number;
  skus: TrafficSkuQty[];
};

export type TrafficException = {
  orderId: string;
  number: string;
  reason: "unmapped_dest" | "unmapped_origin" | "tracker_exception";
};

export type TrafficSnapshot = {
  asOf: number;
  origins: TrafficOrigin[];
  flights: TrafficFlight[];
  destinations: TrafficDestination[];
  exceptions: TrafficException[];
  kpis: {
    inFlight: number;
    atGate: number;
    arrived: number;
    destCount: number;
    units: number;
    unmapped: number;
    exceptions: number;
  };
};

export type TrafficOrderLine = {
  itemId: string;
  sku: string;
  name: string;
  qty: number;
};

export type TrafficOrderRow = {
  id: string;
  number: string;
  status: string;
  warehouseId: string;
  packedAt: number | null;
  shippedAt: number | null;
  carrierService: string | null;
  trackingNumber: string | null;
  trackerStatus: string | null;
  shipToAddress: string | null;
  shipToCity: string | null;
  shipToRegion: string | null;
  shipToCountry: string | null;
  shipToLat: number | null;
  shipToLng: number | null;
  lines: TrafficOrderLine[];
};

export type TrafficWarehouseRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

const DAY_MS = 86_400_000;
const SLA_DAYS: Record<string, number> = {
  rackline_ground: 5,
  ups_ground: 4,
  usps_priority: 3,
};

export function horizonLookbackMs(horizon: TrafficHorizon): number {
  if (horizon === "30d") return 30 * DAY_MS;
  if (horizon === "7d") return 7 * DAY_MS;
  return 8 * DAY_MS;
}

export function isTrafficHorizon(value: string): value is TrafficHorizon {
  return value === "now" || value === "7d" || value === "30d";
}

export function isTrafficGrain(value: string): value is TrafficGrain {
  return value === "country" || value === "region" || value === "city";
}

export function laneEtaMs(
  carrierService: string | null | undefined,
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): number {
  const slaDays = SLA_DAYS[carrierService ?? ""] ?? 4;
  const miles = haversineMiles(origin, dest);
  const distanceDays = miles / 400 + 1;
  const days = Math.min(slaDays, Math.max(1, distanceDays));
  return Math.round(days * DAY_MS);
}

export function flightProgress(now: number, departedAt: number, etaAt: number): number {
  if (etaAt <= departedAt) return 1;
  return clamp((now - departedAt) / (etaAt - departedAt), 0, 1);
}

export function buildTrafficSnapshot(input: {
  now: number;
  warehouses: TrafficWarehouseRow[];
  orders: TrafficOrderRow[];
  skuIds?: string[];
  horizon: TrafficHorizon;
  grain: TrafficGrain;
}): TrafficSnapshot {
  const skuFilter = input.skuIds?.length ? new Set(input.skuIds) : null;
  const origins = input.warehouses.map((row) => {
    const place = resolveOrigin(row);
    return {
      warehouseId: row.id,
      name: row.name,
      city: place?.city ?? row.city,
      region: place?.region ?? row.region,
      country: place?.country ?? row.country,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
    };
  });
  const originById = new Map(origins.map((row) => [row.warehouseId, row]));

  const flights: TrafficFlight[] = [];
  const exceptions: TrafficException[] = [];
  const heatOrders: Array<{ dest: GeoPlace; lines: TrafficSkuQty[]; status: TrafficFlightStatus }> = [];

  for (const order of input.orders) {
    const lines = filterLines(order.lines, skuFilter);
    if (lines.length === 0) continue;
    const units = lines.reduce((sum, line) => sum + line.qty, 0);
    const dest = resolveOrderDest(order);
    const origin = originById.get(order.warehouseId);
    const originPoint =
      origin?.lat != null && origin.lng != null ? { warehouseId: origin.warehouseId, lat: origin.lat, lng: origin.lng } : null;

    if (!dest) {
      exceptions.push({ orderId: order.id, number: order.number, reason: "unmapped_dest" });
      continue;
    }
    if (!originPoint) {
      exceptions.push({ orderId: order.id, number: order.number, reason: "unmapped_origin" });
      continue;
    }

    const status = classifyFlight(input.now, order, originPoint, dest);
    const includeInHeat = input.horizon === "now" ? status === "at_gate" || status === "in_flight" : true;
    if (includeInHeat) heatOrders.push({ dest, lines, status });

    if (status === "exception") {
      exceptions.push({ orderId: order.id, number: order.number, reason: "tracker_exception" });
      continue;
    }

    if (status !== "at_gate" && status !== "in_flight") continue;

    const departedAt = order.shippedAt;
    const etaAt = departedAt != null ? departedAt + laneEtaMs(order.carrierService, originPoint, dest) : null;
    const rawProgress =
      status === "in_flight" && departedAt != null && etaAt != null ? flightProgress(input.now, departedAt, etaAt) : 0;
    const progress = status === "in_flight" && order.trackerStatus ? Math.min(rawProgress, 0.95) : rawProgress;
    const position =
      status === "at_gate" ? { lat: originPoint.lat, lng: originPoint.lng } : interpolateGreatCircle(originPoint, dest, progress);
    flights.push({
      orderId: order.id,
      number: order.number,
      trackingNumber: order.trackingNumber,
      carrierService: order.carrierService,
      status,
      departedAt,
      etaAt,
      progress,
      position,
      origin: originPoint,
      dest: {
        city: dest.city,
        region: dest.region,
        country: dest.country,
        lat: dest.lat,
        lng: dest.lng,
      },
      skus: lines,
      units,
    });
  }

  const destinations = rollupDestinations(heatOrders, input.grain);
  return {
    asOf: input.now,
    origins,
    flights,
    destinations,
    exceptions,
    kpis: {
      inFlight: flights.filter((row) => row.status === "in_flight").length,
      atGate: flights.filter((row) => row.status === "at_gate").length,
      arrived: heatOrders.filter((row) => row.status === "arrived_estimate" || row.status === "arrived").length,
      destCount: destinations.length,
      units: destinations.reduce((sum, row) => sum + row.units, 0),
      unmapped: exceptions.filter((row) => row.reason === "unmapped_dest" || row.reason === "unmapped_origin").length,
      exceptions: exceptions.filter((row) => row.reason === "tracker_exception").length,
    },
  };
}

function classifyFlight(
  now: number,
  order: TrafficOrderRow,
  origin: { lat: number; lng: number },
  dest: GeoPlace,
): TrafficFlightStatus {
  const tracker = normalizeTrackerStatus(order.trackerStatus);
  if (tracker) return trackerToFlight(tracker);
  if (order.status === "packed") return "at_gate";
  if (order.status !== "shipped" || order.shippedAt == null) return "unmapped";
  const etaAt = order.shippedAt + laneEtaMs(order.carrierService, origin, dest);
  if (now >= etaAt) return "arrived_estimate";
  return "in_flight";
}

function filterLines(lines: TrafficOrderLine[], skuFilter: Set<string> | null): TrafficSkuQty[] {
  const matched = skuFilter ? lines.filter((line) => skuFilter.has(line.itemId)) : lines;
  return matched.map((line) => ({ itemId: line.itemId, sku: line.sku, name: line.name, qty: line.qty }));
}

function rollupDestinations(
  rows: Array<{ dest: GeoPlace; lines: TrafficSkuQty[] }>,
  grain: TrafficGrain,
): TrafficDestination[] {
  const groups = new Map<
    string,
    { dest: GeoPlace; orders: number; units: number; skus: Map<string, TrafficSkuQty> }
  >();
  for (const row of rows) {
    const key = destinationKey(row.dest, grain);
    const existing = groups.get(key);
    const units = row.lines.reduce((sum, line) => sum + line.qty, 0);
    if (!existing) {
      const skus = new Map<string, TrafficSkuQty>();
      for (const line of row.lines) skus.set(line.itemId, { ...line });
      groups.set(key, { dest: row.dest, orders: 1, units, skus });
      continue;
    }
    existing.orders += 1;
    existing.units += units;
    for (const line of row.lines) {
      const prev = existing.skus.get(line.itemId);
      if (prev) prev.qty += line.qty;
      else existing.skus.set(line.itemId, { ...line });
    }
  }
  return [...groups.entries()]
    .map(([key, row]) => {
      const coord = grainCoord(row.dest, grain);
      return {
        key,
        grain,
        city: grain === "city" ? row.dest.city : null,
        region: grain === "country" ? null : row.dest.region,
        country: row.dest.country,
        lat: coord.lat,
        lng: coord.lng,
        orders: row.orders,
        units: row.units,
        skus: [...row.skus.values()].sort((a, b) => b.qty - a.qty),
      };
    })
    .sort((a, b) => b.units - a.units || a.key.localeCompare(b.key));
}

function destinationKey(dest: GeoPlace, grain: TrafficGrain): string {
  if (grain === "country") return dest.country;
  if (grain === "region") return `${dest.country}-${dest.region ?? "_"}`;
  return `${dest.country}-${dest.region ?? "_"}-${(dest.city ?? "unknown").trim().toLowerCase()}`;
}

function grainCoord(dest: GeoPlace, grain: TrafficGrain): { lat: number; lng: number } {
  if (grain === "city") return dest;
  if (grain === "country") {
    const country = lookupCountry(dest.country);
    return country ? { lat: country.lat, lng: country.lng } : dest;
  }
  const region = dest.region ? lookupRegion(dest.country, dest.region) : null;
  return region ? { lat: region.lat, lng: region.lng } : dest;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
