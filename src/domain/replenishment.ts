export type SlotLocation = {
  id: string;
  code: string;
  warehouseId: string;
  slotRole: string;
  aisle: string | null;
  rack: string | null;
};

export type ReplenishOnHand = {
  locationId: string;
  itemId: string;
  qty: number;
};

export type ReplenishItem = {
  id: string;
  sku: string;
  name: string;
  pickMin: number;
};

export type ReplenishSuggestion = {
  itemId: string;
  sku: string;
  itemName: string;
  pickMin: number;
  pickQty: number;
  fromLocationId: string;
  fromCode: string;
  toLocationId: string;
  toCode: string;
  qty: number;
  warehouseId: string;
};

function qtyAt(onHand: ReplenishOnHand[], locationId: string, itemId: string): number {
  let total = 0;
  for (const row of onHand) {
    if (row.locationId === locationId && row.itemId === itemId) total += row.qty;
  }
  return total;
}

function richestBulkPick(
  pickLocs: SlotLocation[],
  bulkLocs: SlotLocation[],
  onHand: ReplenishOnHand[],
  itemId: string,
): SlotLocation[] {
  const rankedBulk = bulkLocs
    .map((bulk) => ({ bulk, qty: qtyAt(onHand, bulk.id, itemId) }))
    .filter((row) => row.qty > 0)
    .sort((a, b) => b.qty - a.qty);
  const source = rankedBulk[0]?.bulk;
  if (!source) return [];
  const rankedPick = [...pickLocs].sort(
    (a, b) => bulkScore(b, source, 0) - bulkScore(a, source, 0),
  );
  return rankedPick[0] ? [rankedPick[0]] : [];
}

function bulkScore(pick: SlotLocation, bulk: SlotLocation, qty: number): number {
  let score = qty * 10;
  if (pick.aisle && bulk.aisle && pick.aisle === bulk.aisle) score += 100;
  if (pick.rack && bulk.rack && pick.rack === bulk.rack) score += 40;
  return score;
}

export function suggestReplenishments(input: {
  locations: SlotLocation[];
  onHand: ReplenishOnHand[];
  items: ReplenishItem[];
}): ReplenishSuggestion[] {
  const suggestions: ReplenishSuggestion[] = [];
  const warehouses = [...new Set(input.locations.map((row) => row.warehouseId))];

  for (const item of input.items) {
    if (!Number.isInteger(item.pickMin) || item.pickMin <= 0) continue;
    for (const warehouseId of warehouses) {
      const pickLocs = input.locations.filter(
        (row) => row.warehouseId === warehouseId && row.slotRole === "pick",
      );
      const bulkLocs = input.locations.filter(
        (row) => row.warehouseId === warehouseId && row.slotRole === "bulk",
      );
      if (pickLocs.length === 0 || bulkLocs.length === 0) continue;

      const occupiedPick = pickLocs.filter((pick) => qtyAt(input.onHand, pick.id, item.id) > 0);
      const targets =
        occupiedPick.length > 0
          ? occupiedPick
          : richestBulkPick(pickLocs, bulkLocs, input.onHand, item.id);

      for (const pick of targets) {
        const pickQty = qtyAt(input.onHand, pick.id, item.id);
        if (pickQty >= item.pickMin) continue;
        const needed = item.pickMin - pickQty;
        const ranked = bulkLocs
          .map((bulk) => ({ bulk, qty: qtyAt(input.onHand, bulk.id, item.id) }))
          .filter((row) => row.qty > 0 && row.bulk.id !== pick.id)
          .sort((a, b) => bulkScore(pick, b.bulk, b.qty) - bulkScore(pick, a.bulk, a.qty));
        const source = ranked[0];
        if (!source) continue;
        const qty = Math.min(needed, source.qty);
        if (qty <= 0) continue;
        suggestions.push({
          itemId: item.id,
          sku: item.sku,
          itemName: item.name,
          pickMin: item.pickMin,
          pickQty,
          fromLocationId: source.bulk.id,
          fromCode: source.bulk.code,
          toLocationId: pick.id,
          toCode: pick.code,
          qty,
          warehouseId,
        });
      }
    }
  }

  return suggestions.sort((a, b) => a.sku.localeCompare(b.sku) || a.toCode.localeCompare(b.toCode));
}
