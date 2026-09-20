export type PickMapAllocation = {
  locationId: string;
  locationCode: string;
  qty: number;
};

export type PickMapLine = {
  lineId: string;
  sku: string;
  remaining: number;
  suggestedLocation?: { locationId: string; locationCode: string } | null;
  allocations?: PickMapAllocation[] | null;
};

export type PickMapLocation = {
  id: string;
  code: string;
  aisle?: string | null;
  rack?: string | null;
  bay?: string | null;
  level?: number;
};

export type PickMapSku = {
  lineId: string;
  sku: string;
  qty: number;
};

export type PickMapStop = {
  step: number;
  locationId: string;
  locationCode: string;
  aisle: string | null;
  rack: string | null;
  bay: string | null;
  level: number;
  skus: PickMapSku[];
  qty: number;
  label: string;
};

export type PickMapUnlocated = {
  lineId: string;
  sku: string;
  remaining: number;
};

export type PickMapPlan = {
  stops: PickMapStop[];
  unlocated: PickMapUnlocated[];
};

export type PickMapMarker = {
  locationId: string;
  step: number;
  label: string;
};

type Grab = {
  locationId: string;
  locationCode: string;
  lineId: string;
  sku: string;
  qty: number;
};

function addressSort(a: PickMapStop, b: PickMapStop): number {
  return (
    (a.aisle ?? "").localeCompare(b.aisle ?? "") ||
    (a.rack ?? "").localeCompare(b.rack ?? "") ||
    (a.bay ?? "").localeCompare(b.bay ?? "") ||
    a.level - b.level ||
    a.locationCode.localeCompare(b.locationCode)
  );
}

function stopLabel(skus: PickMapSku[]): string {
  return [...new Set(skus.map((row) => row.sku))].join(", ");
}

/** Remaining pick lines as numbered walk stops (aisle → rack → bay → level). */
export function buildPickMapStops(lines: PickMapLine[], locations: PickMapLocation[] = []): PickMapPlan {
  const grabs: Grab[] = [];
  const unlocated: PickMapUnlocated[] = [];

  for (const line of lines) {
    if (!Number.isFinite(line.remaining) || line.remaining <= 0) continue;
    const allocations = (line.allocations ?? []).filter((row) => row.qty > 0 && row.locationId);
    if (allocations.length) {
      for (const row of allocations) {
        grabs.push({
          locationId: row.locationId,
          locationCode: row.locationCode,
          lineId: line.lineId,
          sku: line.sku,
          qty: row.qty,
        });
      }
      continue;
    }
    if (line.suggestedLocation?.locationId) {
      grabs.push({
        locationId: line.suggestedLocation.locationId,
        locationCode: line.suggestedLocation.locationCode,
        lineId: line.lineId,
        sku: line.sku,
        qty: line.remaining,
      });
      continue;
    }
    unlocated.push({ lineId: line.lineId, sku: line.sku, remaining: line.remaining });
  }

  const grouped = new Map<string, { locationCode: string; skus: PickMapSku[] }>();
  for (const grab of grabs) {
    const existing = grouped.get(grab.locationId);
    if (existing) {
      const sameLine = existing.skus.find((row) => row.lineId === grab.lineId && row.sku === grab.sku);
      if (sameLine) sameLine.qty += grab.qty;
      else existing.skus.push({ lineId: grab.lineId, sku: grab.sku, qty: grab.qty });
    } else {
      grouped.set(grab.locationId, {
        locationCode: grab.locationCode,
        skus: [{ lineId: grab.lineId, sku: grab.sku, qty: grab.qty }],
      });
    }
  }

  const byId = new Map(locations.map((row) => [row.id, row]));
  const stops = [...grouped.entries()]
    .map(([locationId, group]) => {
      const location = byId.get(locationId);
      return {
        step: 0,
        locationId,
        locationCode: location?.code ?? group.locationCode,
        aisle: location?.aisle ?? null,
        rack: location?.rack ?? null,
        bay: location?.bay ?? null,
        level: location?.level ?? 1,
        skus: group.skus,
        qty: group.skus.reduce((sum, row) => sum + row.qty, 0),
        label: stopLabel(group.skus),
      };
    })
    .sort(addressSort)
    .map((stop, index) => ({ ...stop, step: index + 1 }));

  return { stops, unlocated };
}

export function pickMapLocationIds(stops: PickMapStop[]): string[] {
  return stops.map((stop) => stop.locationId);
}

export function pickMapMarkers(stops: PickMapStop[]): PickMapMarker[] {
  return stops.map((stop) => ({
    locationId: stop.locationId,
    step: stop.step,
    label: stop.label,
  }));
}
