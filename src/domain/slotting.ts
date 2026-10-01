/**
 * Slotting puts the fastest movers on pick faces.
 * Rank is recent pick and ship units, the same movement ABC classifies.
 * A proposal is a transfer from the bulk bay that holds the SKU onto an empty
 * pick face, or onto a pick face whose current SKU is slower. It does not move stock.
 */

export type SlottingSku = {
  itemId: string;
  units: number;
};

export type SlottingBay = {
  locationId: string;
  slotRole: string;
  maxQty: number | null;
};

export type SlottingStock = {
  locationId: string;
  itemId: string;
  qty: number;
};

export type SlottingMove = {
  itemId: string;
  fromLocationId: string;
  toLocationId: string;
  qty: number;
  units: number;
};

function qtyAt(stock: readonly SlottingStock[], locationId: string, itemId: string): number {
  let total = 0;
  for (const row of stock) {
    if (row.locationId === locationId && row.itemId === itemId && row.qty > 0) total += row.qty;
  }
  return total;
}

/** Fastest positive units on the face, or null when the face is empty. */
function faceUnits(
  stock: readonly SlottingStock[],
  locationId: string,
  unitsOf: ReadonlyMap<string, number>,
): number | null {
  let speed: number | null = null;
  for (const row of stock) {
    if (row.locationId !== locationId || row.qty <= 0) continue;
    const units = unitsOf.get(row.itemId) ?? 0;
    speed = speed == null ? units : Math.max(speed, units);
  }
  return speed;
}

/**
 * One move per SKU, fastest first. Skips a SKU already on any pick face.
 * Never displaces a faster SKU (equal units stay). Empty pick faces are used
 * before a face that holds a slower SKU. Qty is available bulk, capped by maxQty when set.
 */
export function proposeSlotting(input: {
  skus: readonly SlottingSku[];
  bays: readonly SlottingBay[];
  stock: readonly SlottingStock[];
}): SlottingMove[] {
  const unitsOf = new Map<string, number>();
  for (const sku of input.skus) unitsOf.set(sku.itemId, Math.max(0, sku.units));
  const ranked = [...unitsOf.entries()]
    .filter(([, units]) => units > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const picks = input.bays.filter((bay) => bay.slotRole === "pick");
  const bulks = input.bays.filter((bay) => bay.slotRole === "bulk");
  const onPick = new Set<string>();
  for (const bay of picks) {
    for (const row of input.stock) {
      if (row.locationId === bay.locationId && row.qty > 0) onPick.add(row.itemId);
    }
  }

  const taken = new Set<string>();
  const moves: SlottingMove[] = [];
  for (const [itemId, units] of ranked) {
    if (onPick.has(itemId)) continue;
    const source = bulks
      .map((bay) => ({ locationId: bay.locationId, qty: qtyAt(input.stock, bay.locationId, itemId) }))
      .filter((bay) => bay.qty > 0)
      .sort((a, b) => b.qty - a.qty || a.locationId.localeCompare(b.locationId))[0];
    if (!source) continue;

    const open = picks.filter((bay) => !taken.has(bay.locationId));
    const empty = open
      .filter((bay) => faceUnits(input.stock, bay.locationId, unitsOf) == null)
      .sort((a, b) => a.locationId.localeCompare(b.locationId));
    const slower = open
      .filter((bay) => {
        const speed = faceUnits(input.stock, bay.locationId, unitsOf);
        return speed != null && speed < units;
      })
      .sort((a, b) => {
        const left = faceUnits(input.stock, a.locationId, unitsOf) ?? 0;
        const right = faceUnits(input.stock, b.locationId, unitsOf) ?? 0;
        return left - right || a.locationId.localeCompare(b.locationId);
      });
    const dest = empty[0] ?? slower[0];
    if (!dest || dest.locationId === source.locationId) continue;

    const available = Math.floor(source.qty);
    const capped = dest.maxQty == null ? available : Math.min(available, Math.floor(dest.maxQty));
    if (capped <= 0) continue;
    taken.add(dest.locationId);
    moves.push({
      itemId,
      fromLocationId: source.locationId,
      toLocationId: dest.locationId,
      qty: capped,
      units,
    });
  }
  return moves;
}
