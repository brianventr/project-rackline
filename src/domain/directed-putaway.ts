export type PutawayBay = {
  locationId: string;
  locationCode: string;
  locationName: string;
  barcode: string;
  type: string;
  slotRole: string;
  aisle: string | null;
  warehouseId?: string;
  qty: number;
};

export type PutawayContent = {
  itemId: string;
  sku: string;
  itemName: string;
  qty: number;
};

export type PutawayJob = {
  itemId: string;
  sku: string;
  itemName: string;
  qty: number;
  fromLocationId: string;
  fromCode: string;
  fromBarcode: string;
  suggested: PutawayBay | null;
};

export function shouldSuggestPutaway(fromType: string): boolean {
  return fromType === "receiving" || fromType === "shipping" || fromType === "production";
}

export function pickAisle(bays: PutawayBay[]): string | null {
  const pickFaces = bays
    .filter((row) => row.slotRole === "pick" && row.qty > 0)
    .slice()
    .sort((a, b) => b.qty - a.qty || a.locationCode.localeCompare(b.locationCode));
  return pickFaces[0]?.aisle ?? null;
}

export function putawayScore(bay: PutawayBay, aisle: string | null): number {
  let score = 0;
  if (bay.type === "storage") score += 200;
  if (bay.slotRole === "bulk") score += 120;
  else if (bay.slotRole === "pick") score += 20;
  if (bay.qty > 0) score += 80;
  if (aisle && bay.aisle === aisle) score += 50;
  if (bay.type === "production") score -= 40;
  return score;
}

function eligible(bay: PutawayBay, fromLocationId: string): boolean {
  if (bay.locationId === fromLocationId) return false;
  if (bay.type === "receiving" || bay.type === "shipping") return false;
  return true;
}

export function suggestPutawayBay(bays: PutawayBay[], fromLocationId: string): PutawayBay | null {
  const aisle = pickAisle(bays);
  const ranked = bays
    .filter((bay) => eligible(bay, fromLocationId))
    .slice()
    .sort(
      (a, b) => putawayScore(b, aisle) - putawayScore(a, aisle) || a.locationCode.localeCompare(b.locationCode),
    );
  return ranked[0] ?? null;
}

export function baysForItem(
  locations: Omit<PutawayBay, "qty">[],
  onHand: { locationId: string; itemId: string; qty: number }[],
  itemId: string,
): PutawayBay[] {
  const qtyByLocation = new Map<string, number>();
  for (const row of onHand) {
    if (row.itemId !== itemId) continue;
    qtyByLocation.set(row.locationId, (qtyByLocation.get(row.locationId) ?? 0) + row.qty);
  }
  return locations.map((location) => ({
    ...location,
    qty: qtyByLocation.get(location.locationId) ?? 0,
  }));
}

export function suggestPutawayJobs(
  from: { id: string; code: string; barcode: string; type: string },
  contents: PutawayContent[],
  baysByItem: Map<string, PutawayBay[]>,
): PutawayJob[] {
  if (!shouldSuggestPutaway(from.type)) return [];
  return contents
    .filter((row) => row.qty > 0)
    .map((row) => ({
      itemId: row.itemId,
      sku: row.sku,
      itemName: row.itemName,
      qty: row.qty,
      fromLocationId: from.id,
      fromCode: from.code,
      fromBarcode: from.barcode,
      suggested: suggestPutawayBay(baysByItem.get(row.itemId) ?? [], from.id),
    }));
}
