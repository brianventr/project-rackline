export type PlaceableLocation = {
  type: string;
  area?: string | null;
  aisle?: string | null;
  rack?: string | null;
  bay?: string | null;
  level?: number | null;
  posX: number;
  posY: number;
  posZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
};

export type WarehouseMapSize = {
  mapWidth: number;
  mapDepth: number;
  mapHeight: number;
};

export type Placement = {
  area: string;
  aisle: string | null;
  rack: string | null;
  bay: string | null;
  level: number;
  posX: number;
  posY: number;
  posZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
};

export function gridPosition(aisle: string, rack: string, bay: string, level: number) {
  const aisleIndex = Math.max(0, aisle.toUpperCase().charCodeAt(0) - 65);
  const rackNum = Math.max(1, Number.parseInt(rack, 10) || 1);
  const bayNum = Math.max(1, Number.parseInt(bay, 10) || 1);
  const levelNum = Math.max(1, level || 1);
  const pairOffset = Math.floor((rackNum - 1) / 2);
  const side = (rackNum - 1) % 2;
  return {
    posX: 2 + aisleIndex * 20 + pairOffset * 20 + side * 10,
    posY: 7 + (bayNum - 1) * 4,
    posZ: (levelNum - 1) * 2,
    sizeX: 4,
    sizeY: 3,
    sizeZ: 2,
  };
}

function overlaps(a: PlaceableLocation, b: Placement): boolean {
  if (a.posZ !== b.posZ) return false;
  const ax2 = a.posX + a.sizeX;
  const ay2 = a.posY + a.sizeY;
  const bx2 = b.posX + b.sizeX;
  const by2 = b.posY + b.sizeY;
  return a.posX < bx2 && ax2 > b.posX && a.posY < by2 && ay2 > b.posY;
}

function nudgeClear(existing: PlaceableLocation[], draft: Placement): Placement {
  const next = { ...draft };
  let guard = 0;
  while (existing.some((row) => overlaps(row, next)) && guard < 24) {
    next.posY += 4;
    guard += 1;
  }
  return next;
}

export function suggestPlacement(
  existing: PlaceableLocation[],
  draft: {
    type: string;
    area?: string | null;
    aisle?: string | null;
    rack?: string | null;
    bay?: string | null;
    level?: number | null;
    posX?: number | null;
    posY?: number | null;
    posZ?: number | null;
    sizeX?: number | null;
    sizeY?: number | null;
    sizeZ?: number | null;
  },
  warehouse: WarehouseMapSize,
): Placement {
  const level = Math.max(1, draft.level ?? 1);
  const aisle = draft.aisle?.trim().toUpperCase() || null;
  const rack = draft.rack?.trim() || null;
  const bay = draft.bay?.trim() || null;

  let placement: Placement;

  if (draft.posX != null && draft.posY != null) {
    placement = {
      area: (draft.area?.trim() || areaForType(draft.type, aisle)).trim() || "floor",
      aisle,
      rack,
      bay,
      level,
      posX: draft.posX,
      posY: draft.posY,
      posZ: draft.posZ ?? (level - 1) * 2,
      sizeX: draft.sizeX ?? defaultSize(draft.type).sizeX,
      sizeY: draft.sizeY ?? defaultSize(draft.type).sizeY,
      sizeZ: draft.sizeZ ?? defaultSize(draft.type).sizeZ,
    };
    return placement;
  }

  if (draft.type === "receiving") {
    placement = {
      area: draft.area?.trim() || "Dock",
      aisle,
      rack,
      bay,
      level,
      posX: 2,
      posY: 1,
      posZ: 0,
      ...defaultSize("receiving"),
    };
  } else if (draft.type === "shipping") {
    placement = {
      area: draft.area?.trim() || "Outbound",
      aisle,
      rack,
      bay,
      level,
      posX: Math.max(2, warehouse.mapWidth - 20),
      posY: Math.max(2, warehouse.mapDepth - 6),
      posZ: 0,
      ...defaultSize("shipping"),
    };
  } else if (draft.type === "production") {
    placement = {
      area: draft.area?.trim() || "Shop",
      aisle,
      rack,
      bay,
      level,
      posX: Math.max(2, warehouse.mapWidth - 10),
      posY: 7,
      posZ: 0,
      ...defaultSize("production"),
    };
  } else if (aisle && rack && bay) {
    placement = {
      area: draft.area?.trim() || `Aisle ${aisle}`,
      aisle,
      rack,
      bay,
      level,
      ...gridPosition(aisle, rack, bay, level),
    };
  } else {
    const storageCount = existing.filter((row) => row.type === "storage").length;
    placement = {
      area: draft.area?.trim() || "Storage",
      aisle,
      rack,
      bay,
      level,
      posX: 2 + (storageCount % 4) * 5,
      posY: 7 + Math.floor(storageCount / 4) * 4,
      posZ: (level - 1) * 2,
      ...defaultSize("storage"),
    };
  }

  return nudgeClear(existing, placement);
}

export function defaultSize(type: string): { sizeX: number; sizeY: number; sizeZ: number } {
  if (type === "receiving") return { sizeX: 16, sizeY: 4, sizeZ: 3 };
  if (type === "shipping") return { sizeX: 18, sizeY: 4, sizeZ: 3 };
  if (type === "production") return { sizeX: 8, sizeY: 10, sizeZ: 3 };
  return { sizeX: 4, sizeY: 3, sizeZ: 2 };
}

export function areaForType(type: string, aisle?: string | null): string {
  if (type === "receiving") return "Dock";
  if (type === "shipping") return "Outbound";
  if (type === "production") return "Shop";
  if (aisle) return `Aisle ${aisle.toUpperCase()}`;
  return "Storage";
}

export function addressLabel(input: {
  aisle?: string | null;
  rack?: string | null;
  bay?: string | null;
  level?: number | null;
}): string | null {
  const parts: string[] = [];
  if (input.aisle) parts.push(`Aisle ${input.aisle}`);
  if (input.rack) parts.push(`rack ${input.rack}`);
  if (input.bay) parts.push(`bay ${input.bay}`);
  if (input.level && input.level > 1) parts.push(`level ${input.level}`);
  return parts.length ? parts.join(" / ") : null;
}
