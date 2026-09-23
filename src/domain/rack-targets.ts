import { baysForItem, shouldSuggestPutaway, suggestPutawayBay } from "./directed-putaway";
import { buildPickMapStops, type PickMapLine } from "./pick-map";
import { normalizeAisle, normalizeRack, padBay } from "./rack-builder";

/** How a unit of work touches a bay: stock leaves `from`, lands on `to`, or is handled `at` it. */
export type TargetRole = "from" | "to" | "at";

export type TargetItem = { sku: string; qty: number };

export type TargetDraft = {
  locationId: string;
  role: TargetRole;
  verb: string;
  items: TargetItem[];
};

export type RackTarget = TargetDraft & {
  /** Primary bays get the crosshair. Origins stay secondary unless the work has nowhere else to point. */
  primary: boolean;
};

export type TargetLocation = {
  id: string;
  code: string;
  name?: string;
  barcode?: string;
  type: string;
  slotRole?: string | null;
  area?: string | null;
  aisle: string | null;
  rack: string | null;
  bay: string | null;
  level: number;
  unitsOnHand?: number;
  contents?: { itemId: string; sku: string; qty: number }[];
};

export type TargetLine = { itemId: string; sku: string; qty: number };

export type TargetPlan = { targets: TargetDraft[]; unlocated: TargetItem[] };

const ROLE_ORDER: Record<TargetRole, number> = { from: 0, at: 1, to: 2 };

/** The receiving bay floor Receive lands on when the document names none. */
export function defaultDock(locations: TargetLocation[]): TargetLocation | null {
  return locations.find((row) => row.type === "receiving") ?? null;
}

function putawayBays(locations: TargetLocation[], itemId: string) {
  const bays = locations.map((row) => ({
    locationId: row.id,
    locationCode: row.code,
    locationName: row.name ?? row.code,
    barcode: row.barcode ?? row.code,
    type: row.type,
    slotRole: row.slotRole ?? "none",
    aisle: row.aisle,
  }));
  const onHand = locations.flatMap((row) =>
    (row.contents ?? []).map((content) => ({ locationId: row.id, itemId: content.itemId, qty: content.qty })),
  );
  return baysForItem(bays, onHand, itemId);
}

/**
 * Inbound paperwork has not touched a bay yet, so point at where it will: the dock it lands on, then
 * the bay directed putaway sends each SKU to from that dock. Receiving straight into storage skips putaway.
 */
export function receiveTargets(input: {
  dockId: string | null;
  lines: TargetLine[];
  locations: TargetLocation[];
}): TargetPlan {
  const lines = input.lines.filter((line) => line.qty > 0);
  const items = lines.map((line) => ({ sku: line.sku, qty: line.qty }));
  const dock =
    (input.dockId ? input.locations.find((row) => row.id === input.dockId) : null) ?? defaultDock(input.locations);
  if (!dock) return { targets: [], unlocated: items };
  if (!shouldSuggestPutaway(dock.type)) {
    return { targets: [{ locationId: dock.id, role: "to", verb: "Receive into", items }], unlocated: [] };
  }

  const targets: TargetDraft[] = [{ locationId: dock.id, role: "from", verb: "Receive into", items }];
  const unlocated: TargetItem[] = [];
  for (const line of lines) {
    const bay = suggestPutawayBay(putawayBays(input.locations, line.itemId), dock.id);
    if (bay) {
      targets.push({ locationId: bay.locationId, role: "to", verb: "Put away to", items: [{ sku: line.sku, qty: line.qty }] });
    } else {
      unlocated.push({ sku: line.sku, qty: line.qty });
    }
  }
  return { targets, unlocated };
}

/** Remaining pick lines as the bays they come off (allocations first, then the suggested pick face). */
export function pickTargets(lines: PickMapLine[], locations: TargetLocation[]): TargetPlan {
  const plan = buildPickMapStops(lines, locations);
  return {
    targets: plan.stops.map((stop) => ({
      locationId: stop.locationId,
      role: "from" as const,
      verb: "Pick from",
      items: stop.skus.map((row) => ({ sku: row.sku, qty: row.qty })),
    })),
    unlocated: plan.unlocated.map((row) => ({ sku: row.sku, qty: row.remaining })),
  };
}

/** Every bay holding the SKU right now. */
export function onHandTargets(itemId: string, sku: string, locations: TargetLocation[]): TargetPlan {
  const targets: TargetDraft[] = [];
  for (const row of locations) {
    const qty = (row.contents ?? []).filter((content) => content.itemId === itemId).reduce((sum, content) => sum + content.qty, 0);
    if (qty > 0) targets.push({ locationId: row.id, role: "at", verb: "On hand", items: [{ sku, qty }] });
  }
  return { targets, unlocated: targets.length ? [] : [{ sku, qty: 0 }] };
}

function mergeItems(items: TargetItem[]): TargetItem[] {
  const bySku = new Map<string, TargetItem>();
  for (const item of items) {
    const existing = bySku.get(item.sku);
    if (existing) existing.qty += item.qty;
    else bySku.set(item.sku, { ...item });
  }
  return [...bySku.values()];
}

function addressCompare(a: TargetLocation | undefined, b: TargetLocation | undefined): number {
  return (
    (a?.aisle ?? "").localeCompare(b?.aisle ?? "") ||
    (a?.rack ?? "").localeCompare(b?.rack ?? "", undefined, { numeric: true }) ||
    (a?.bay ?? "").localeCompare(b?.bay ?? "", undefined, { numeric: true }) ||
    (a?.level ?? 1) - (b?.level ?? 1) ||
    (a?.code ?? "").localeCompare(b?.code ?? "")
  );
}

/**
 * One row per bay and role, in walk order (from → at → to). Bays that are not on this building's map
 * are dropped because they cannot be drawn. When a job has a destination, that is where the crosshair goes;
 * otherwise the bays it works at or takes from are the target.
 */
export function finalizeTargets(drafts: TargetDraft[], locations: TargetLocation[]): RackTarget[] {
  const byId = new Map(locations.map((row) => [row.id, row]));
  const merged = new Map<string, TargetDraft>();
  for (const draft of drafts) {
    if (!byId.has(draft.locationId)) continue;
    const key = `${draft.locationId}:${draft.role}`;
    const existing = merged.get(key);
    if (existing) existing.items = mergeItems([...existing.items, ...draft.items]);
    else merged.set(key, { ...draft, items: mergeItems(draft.items) });
  }
  const rows = [...merged.values()];
  const pointsSomewhere = rows.some((row) => row.role !== "from");
  return rows
    .map((row) => ({ ...row, primary: row.role !== "from" || !pointsSomewhere }))
    .sort(
      (a, b) =>
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || addressCompare(byId.get(a.locationId), byId.get(b.locationId)),
    );
}

export function isRackBin(location: Pick<TargetLocation, "type" | "aisle" | "rack">): boolean {
  return location.type === "storage" && Boolean(location.aisle) && Boolean(location.rack);
}

/** "Aisle A · Rack 01 · Bay 02 · Level 3" for rack bins; the area's name for docks and benches. */
export function binAddress(
  location: Pick<TargetLocation, "type" | "aisle" | "rack" | "bay" | "level" | "code"> & { name?: string; area?: string | null },
): string {
  if (isRackBin(location)) {
    return [
      `Aisle ${normalizeAisle(location.aisle!)}`,
      `Rack ${normalizeRack(location.rack!)}`,
      location.bay ? `Bay ${padBay(location.bay)}` : null,
      `Level ${location.level ?? 1}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return location.name || location.area || location.code;
}

export type RackFaceCell = {
  locationId: string;
  code: string;
  bay: string;
  level: number;
  units: number;
};

export type RackFace = {
  aisle: string;
  rack: string;
  /** Left to right as you face the rack. */
  bays: string[];
  /** Bottom to top. */
  levels: number[];
  cells: RackFaceCell[];
};

function unitsAt(location: TargetLocation): number {
  if (typeof location.unitsOnHand === "number") return location.unitsOnHand;
  return (location.contents ?? []).reduce((sum, content) => sum + content.qty, 0);
}

/** The front of the rack a bin sits in, as a bay × level grid. Null for docks, benches, and loose bays. */
export function rackFace(locations: TargetLocation[], locationId: string): RackFace | null {
  const bin = locations.find((row) => row.id === locationId);
  if (!bin || !isRackBin(bin)) return null;
  const aisle = normalizeAisle(bin.aisle!);
  const rack = normalizeRack(bin.rack!);
  const rows = locations.filter(
    (row) => isRackBin(row) && normalizeAisle(row.aisle!) === aisle && normalizeRack(row.rack!) === rack,
  );
  const cells = rows.map((row) => ({
    locationId: row.id,
    code: row.code,
    bay: padBay(row.bay ?? "01"),
    level: row.level ?? 1,
    units: unitsAt(row),
  }));
  const bays = [...new Set(cells.map((cell) => cell.bay))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const levels = [...new Set(cells.map((cell) => cell.level))].sort((a, b) => a - b);
  return { aisle, rack, bays, levels, cells };
}

export function formatTargetItems(items: TargetItem[]): string {
  return items.map((item) => (item.qty > 0 ? `${item.sku} × ${item.qty}` : item.sku)).join(", ");
}
