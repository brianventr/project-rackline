import { areaForType, defaultSize, type WarehouseMapSize } from "./map-layout";

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

export type Box3 = {
  posX: number;
  posY: number;
  posZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
};

export type LocationLike = Box3 & {
  id?: string;
  code?: string;
  type: string;
  area?: string | null;
  aisle?: string | null;
  rack?: string | null;
  bay?: string | null;
  level?: number | null;
  unitsOnHand?: number;
};

export type RackSpec = {
  aisle: string;
  rack: string;
  posX: number;
  posY: number;
  rotation: Rotation;
  bays: number;
  levels: number;
  bayWidth: number;
  bayDepth: number;
  bayPitch: number;
  levelHeight: number;
};

export type AreaSpec = {
  type: "receiving" | "production" | "shipping";
  code: string;
  name: string;
  posX: number;
  posY: number;
  posZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
};

export type LocationDraft = Box3 & {
  id?: string;
  code: string;
  name: string;
  barcode: string;
  type: "storage" | "receiving" | "production" | "shipping";
  area: string;
  aisle: string | null;
  rack: string | null;
  bay: string | null;
  level: number;
};

export type RackObject = {
  kind: "rack";
  id: string;
  aisle: string;
  rack: string;
  spec: RackSpec;
  locations: LocationLike[];
  occupied: boolean;
};

export type AreaObject = {
  kind: "area";
  id: string;
  spec: AreaSpec;
  location: LocationLike;
  occupied: boolean;
};

export type FloorObject = RackObject | AreaObject;

export function isRotation(value: number): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

export function normalizeAisle(value: string): string {
  const trimmed = value.trim().toUpperCase();
  return trimmed || "A";
}

export function normalizeRack(value: string | number): string {
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return raw.padStart(2, "0");
  return (raw || "01").toUpperCase();
}

export function padBay(value: string | number): string {
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return raw.padStart(2, "0");
  return (raw || "01").toUpperCase();
}

export function binCode(aisle: string, rack: string, bay: string | number, level: number): string {
  const base = `${normalizeAisle(aisle)}-${normalizeRack(rack)}-${padBay(bay)}`;
  return level > 1 ? `${base}-${level}` : base;
}

export function binName(aisle: string, rack: string, bay: string | number, level: number): string {
  const parts = [`Aisle ${normalizeAisle(aisle)}`, `rack ${normalizeRack(rack)}`, `bay ${padBay(bay)}`];
  if (level > 1) parts.push(`level ${level}`);
  return parts.join(" / ");
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const RACK_PRESETS = [
  {
    id: "pallet-3x2",
    label: "Pallet 3 × 2",
    hint: "Selective rack, 3 bays and 2 levels",
    bays: 3,
    levels: 2,
    bayWidth: 3,
    bayDepth: 4,
    bayPitch: 4,
    levelHeight: 2,
  },
  {
    id: "pallet-4x3",
    label: "Pallet 4 × 3",
    hint: "Standard pick faces, three shelves",
    bays: 4,
    levels: 3,
    bayWidth: 3,
    bayDepth: 4,
    bayPitch: 4,
    levelHeight: 2,
  },
  {
    id: "high-6x4",
    label: "High bay 6 × 4",
    hint: "Longer run, four levels",
    bays: 6,
    levels: 4,
    bayWidth: 3,
    bayDepth: 4,
    bayPitch: 4,
    levelHeight: 2,
  },
] as const;

export type RackPreset = (typeof RACK_PRESETS)[number];

export function defaultRackSpec(partial?: Partial<RackSpec>): RackSpec {
  const bayWidth = clampInt(partial?.bayWidth ?? 3, 1, 24);
  return {
    aisle: normalizeAisle(partial?.aisle ?? "A"),
    rack: normalizeRack(partial?.rack ?? "01"),
    posX: clampInt(partial?.posX ?? 2, 0, 400),
    posY: clampInt(partial?.posY ?? 2, 0, 400),
    rotation: isRotation(partial?.rotation ?? 0) ? (partial?.rotation ?? 0) : 0,
    bays: clampInt(partial?.bays ?? 4, 1, 40),
    levels: clampInt(partial?.levels ?? 3, 1, 12),
    bayWidth,
    bayDepth: clampInt(partial?.bayDepth ?? 4, 1, 24),
    bayPitch: clampInt(partial?.bayPitch ?? bayWidth, 1, 40),
    levelHeight: clampInt(partial?.levelHeight ?? 2, 1, 12),
  };
}

export function applyRackPreset(spec: RackSpec, preset: RackPreset): RackSpec {
  return defaultRackSpec({
    ...spec,
    bays: preset.bays,
    levels: preset.levels,
    bayWidth: preset.bayWidth,
    bayDepth: preset.bayDepth,
    bayPitch: preset.bayPitch,
    levelHeight: preset.levelHeight,
  });
}

export function bayBox(spec: RackSpec, bayIndex: number, level: number): Box3 {
  const alongX = spec.rotation === 90 || spec.rotation === 270;
  const dir = spec.rotation === 180 || spec.rotation === 270 ? -1 : 1;
  const sizeX = alongX ? spec.bayWidth : spec.bayDepth;
  const sizeY = alongX ? spec.bayDepth : spec.bayWidth;
  const step = dir * bayIndex * spec.bayPitch;
  return {
    posX: spec.posX + (alongX ? step : 0),
    posY: spec.posY + (alongX ? 0 : step),
    posZ: (level - 1) * spec.levelHeight,
    sizeX,
    sizeY,
    sizeZ: spec.levelHeight,
  };
}

export function expandRack(spec: RackSpec): LocationDraft[] {
  const aisle = normalizeAisle(spec.aisle);
  const rack = normalizeRack(spec.rack);
  const drafts: LocationDraft[] = [];
  for (let bayIndex = 0; bayIndex < spec.bays; bayIndex += 1) {
    const bay = padBay(bayIndex + 1);
    for (let level = 1; level <= spec.levels; level += 1) {
      const box = bayBox(spec, bayIndex, level);
      const code = binCode(aisle, rack, bay, level);
      drafts.push({
        ...box,
        code,
        name: binName(aisle, rack, bay, level),
        barcode: code,
        type: "storage",
        area: areaForType("storage", aisle),
        aisle,
        rack,
        bay,
        level,
      });
    }
  }
  return drafts;
}

export function expandArea(spec: AreaSpec): LocationDraft {
  return {
    code: spec.code.toUpperCase(),
    name: spec.name,
    barcode: spec.code.toUpperCase(),
    type: spec.type,
    area: areaForType(spec.type),
    aisle: null,
    rack: null,
    bay: null,
    level: 1,
    posX: spec.posX,
    posY: spec.posY,
    posZ: spec.posZ,
    sizeX: spec.sizeX,
    sizeY: spec.sizeY,
    sizeZ: spec.sizeZ,
  };
}

export function footprint(boxes: Box3[]): Box3 | null {
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((b) => b.posX));
  const minY = Math.min(...boxes.map((b) => b.posY));
  const minZ = Math.min(...boxes.map((b) => b.posZ));
  const maxX = Math.max(...boxes.map((b) => b.posX + b.sizeX));
  const maxY = Math.max(...boxes.map((b) => b.posY + b.sizeY));
  const maxZ = Math.max(...boxes.map((b) => b.posZ + b.sizeZ));
  return {
    posX: minX,
    posY: minY,
    posZ: minZ,
    sizeX: maxX - minX,
    sizeY: maxY - minY,
    sizeZ: maxZ - minZ,
  };
}

export function aabbOverlap(a: Box3, b: Box3): boolean {
  return (
    a.posX < b.posX + b.sizeX &&
    a.posX + a.sizeX > b.posX &&
    a.posY < b.posY + b.sizeY &&
    a.posY + a.sizeY > b.posY &&
    a.posZ < b.posZ + b.sizeZ &&
    a.posZ + a.sizeZ > b.posZ
  );
}

export function inWarehouse(box: Box3, warehouse: WarehouseMapSize): boolean {
  return (
    box.posX >= 0 &&
    box.posY >= 0 &&
    box.posZ >= 0 &&
    box.posX + box.sizeX <= warehouse.mapWidth &&
    box.posY + box.sizeY <= warehouse.mapDepth &&
    box.posZ + box.sizeZ <= warehouse.mapHeight
  );
}

export type PlacementIssue = { code: "bounds" | "overlap" | "collision-code"; message: string };

export function validateDrafts(
  drafts: LocationDraft[],
  existing: LocationLike[],
  warehouse: WarehouseMapSize,
  ignoreIds: Set<string> = new Set(),
): PlacementIssue | null {
  const others = existing.filter((row) => !row.id || !ignoreIds.has(row.id));
  const existingCodes = new Set(others.map((row) => row.code).filter(Boolean));
  for (const draft of drafts) {
    if (!inWarehouse(draft, warehouse)) {
      return {
        code: "bounds",
        message: `${draft.code} sits outside the warehouse (${warehouse.mapWidth}×${warehouse.mapDepth}×${warehouse.mapHeight}).`,
      };
    }
    if (existingCodes.has(draft.code)) {
      return { code: "collision-code", message: `${draft.code} already exists. Pick another aisle or rack.` };
    }
    const hit = others.find((row) => aabbOverlap(draft, row));
    if (hit) {
      return { code: "overlap", message: `${draft.code} overlaps ${hit.code ?? "another bay"}.` };
    }
  }
  return null;
}

function bayNumber(value: string | null | undefined): number {
  const n = Number.parseInt(String(value ?? "1"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function inferRotation(bays: LocationLike[]): Rotation {
  if (bays.length < 2) return 0;
  const sorted = bays.slice().sort((a, b) => bayNumber(a.bay) - bayNumber(b.bay));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const dx = last.posX - first.posX;
  const dy = last.posY - first.posY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 90 : 270;
  return dy >= 0 ? 0 : 180;
}

export function groupFloorObjects(locations: LocationLike[]): FloorObject[] {
  const racks = new Map<string, LocationLike[]>();
  const areas: LocationLike[] = [];
  for (const location of locations) {
    if (location.type === "storage" && location.aisle && location.rack) {
      const key = `${normalizeAisle(location.aisle)}:${normalizeRack(location.rack)}`;
      const list = racks.get(key) ?? [];
      list.push(location);
      racks.set(key, list);
    } else {
      areas.push(location);
    }
  }

  const objects: FloorObject[] = [];
  for (const [key, rows] of racks) {
    const [aisle, rack] = key.split(":") as [string, string];
    const uniqueBays = [...new Map(rows.map((row) => [padBay(row.bay ?? "01"), row])).values()].sort(
      (a, b) => bayNumber(a.bay) - bayNumber(b.bay),
    );
    const levels = [...new Set(rows.map((row) => row.level ?? 1))].sort((a, b) => a - b);
    const origin =
      rows
        .slice()
        .sort((a, b) => bayNumber(a.bay) - bayNumber(b.bay) || (a.level ?? 1) - (b.level ?? 1))[0] ?? rows[0]!;
    const rotation = inferRotation(uniqueBays);
    const along = rotation === 90 || rotation === 270 ? "posX" : "posY";
    const pitch =
      uniqueBays.length > 1
        ? Math.abs((uniqueBays[1]![along] as number) - (uniqueBays[0]![along] as number))
        : rotation === 90 || rotation === 270
          ? origin.sizeX
          : origin.sizeY;
    const height =
      levels.length > 1
        ? Math.abs(
            (rows.find((row) => (row.level ?? 1) === levels[1])?.posZ ?? origin.sizeZ) -
              (rows.find((row) => (row.level ?? 1) === levels[0])?.posZ ?? 0),
          )
        : origin.sizeZ;
    const spec = defaultRackSpec({
      aisle,
      rack,
      posX: origin.posX,
      posY: origin.posY,
      rotation,
      bays: uniqueBays.length,
      levels: levels.length,
      bayWidth: rotation === 90 || rotation === 270 ? origin.sizeX : origin.sizeY,
      bayDepth: rotation === 90 || rotation === 270 ? origin.sizeY : origin.sizeX,
      bayPitch: Math.max(1, pitch),
      levelHeight: Math.max(1, height),
    });
    objects.push({
      kind: "rack",
      id: `rack:${aisle}:${rack}`,
      aisle,
      rack,
      spec,
      locations: rows,
      occupied: rows.some((row) => (row.unitsOnHand ?? 0) > 0),
    });
  }

  for (const location of areas) {
    const type =
      location.type === "receiving" || location.type === "production" || location.type === "shipping"
        ? location.type
        : "receiving";
    objects.push({
      kind: "area",
      id: `area:${location.id ?? location.code ?? "unknown"}`,
      spec: {
        type,
        code: location.code ?? type.toUpperCase(),
        name: location.code ?? type,
        posX: location.posX,
        posY: location.posY,
        posZ: location.posZ,
        sizeX: location.sizeX,
        sizeY: location.sizeY,
        sizeZ: location.sizeZ,
      },
      location,
      occupied: (location.unitsOnHand ?? 0) > 0,
    });
  }

  return objects.sort((a, b) => a.id.localeCompare(b.id));
}

export function objectForLocation(objects: FloorObject[], locationId: string): FloorObject | null {
  for (const object of objects) {
    if (object.kind === "rack" && object.locations.some((row) => row.id === locationId)) return object;
    if (object.kind === "area" && object.location.id === locationId) return object;
  }
  return null;
}

export function nextRackAddress(objects: FloorObject[], aisle = "A"): { aisle: string; rack: string } {
  const letter = normalizeAisle(aisle);
  const racks = objects
    .filter((object): object is RackObject => object.kind === "rack" && object.aisle === letter)
    .map((object) => Number.parseInt(object.rack, 10))
    .filter((n) => Number.isFinite(n));
  const next = (racks.length ? Math.max(...racks) : 0) + 1;
  return { aisle: letter, rack: normalizeRack(next) };
}

export function nextAreaCode(existing: LocationLike[], type: AreaSpec["type"]): string {
  const prefix = type === "receiving" ? "RECV" : type === "shipping" ? "SHIP" : "PROD";
  const codes = new Set(existing.map((row) => row.code));
  if (!codes.has(prefix)) return prefix;
  for (let i = 2; i < 100; i += 1) {
    const code = `${prefix}-${i}`;
    if (!codes.has(code)) return code;
  }
  return `${prefix}-${Date.now().toString().slice(-4)}`;
}

export function defaultAreaSpec(type: AreaSpec["type"], existing: LocationLike[], posX: number, posY: number): AreaSpec {
  const size = defaultSize(type);
  const code = nextAreaCode(existing, type);
  const name = type === "receiving" ? "Receiving dock" : type === "shipping" ? "Outbound staging" : "Assembly bench";
  return {
    type,
    code,
    name,
    posX,
    posY,
    posZ: 0,
    sizeX: size.sizeX,
    sizeY: size.sizeY,
    sizeZ: size.sizeZ,
  };
}

export function translateSpec(spec: RackSpec, posX: number, posY: number): RackSpec {
  return { ...spec, posX, posY };
}

export function rotateSpec(spec: RackSpec, rotation: Rotation): RackSpec {
  return { ...spec, rotation };
}

export function worldCenter(box: Box3): { x: number; y: number; z: number } {
  return {
    x: box.posX + box.sizeX / 2,
    y: box.posZ + box.sizeZ / 2,
    z: box.posY + box.sizeY / 2,
  };
}

export function snap(value: number, step = 1): number {
  return Math.round(value / step) * step;
}

export function findOpenPosition(
  draftsAt: (posX: number, posY: number) => LocationDraft[],
  existing: LocationLike[],
  warehouse: WarehouseMapSize,
  ignoreIds: Set<string> = new Set(),
  seed?: { posX: number; posY: number },
): { posX: number; posY: number } | null {
  const tried = new Set<string>();
  const consider = (posX: number, posY: number) => {
    const x = clampInt(posX, 0, warehouse.mapWidth);
    const y = clampInt(posY, 0, warehouse.mapDepth);
    const key = `${x}:${y}`;
    if (tried.has(key)) return null;
    tried.add(key);
    if (!validateDrafts(draftsAt(x, y), existing, warehouse, ignoreIds)) return { posX: x, posY: y };
    return null;
  };

  if (seed) {
    const hit = consider(seed.posX, seed.posY);
    if (hit) return hit;
  }

  for (let posY = 0; posY <= warehouse.mapDepth; posY += 1) {
    for (let posX = 0; posX <= warehouse.mapWidth; posX += 1) {
      const hit = consider(posX, posY);
      if (hit) return hit;
    }
  }
  return null;
}
