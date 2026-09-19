export type HoldKey = {
  locationId: string;
  itemId: string | null;
  lotCode: string | null;
};

export type OpenHold = HoldKey & {
  id: string;
  number: string;
  reason: string;
  locationCode: string;
  sku: string | null;
};

export const HOLD_REASONS = ["QC", "Damaged", "Count variance", "Recall"] as const;

export const HOLD_RESTRICTED_TYPES = ["pick", "move", "kit_consume", "wo_consume"] as const;

export class HeldStockError extends Error {
  constructor(
    public sku: string,
    public locationCode: string,
    public holdNumber: string,
    public reason: string,
  ) {
    super(`${sku} at ${locationCode} is on hold (${holdNumber}: ${reason})`);
    this.name = "HeldStockError";
  }
}

export function isOpenHold(status: string): boolean {
  return status === "open";
}

export function holdScope(hold: HoldKey): "bay" | "sku" | "lot" {
  if (!hold.itemId) return "bay";
  if (!hold.lotCode) return "sku";
  return "lot";
}

export function isHoldRestrictedType(type: string): boolean {
  return (HOLD_RESTRICTED_TYPES as readonly string[]).includes(type);
}

export function sameHoldScope(a: HoldKey, b: HoldKey): boolean {
  return a.locationId === b.locationId && a.itemId === b.itemId && a.lotCode === b.lotCode;
}

export function blocksLocationItem(hold: HoldKey, locationId: string, itemId: string): boolean {
  if (hold.locationId !== locationId) return false;
  if (!hold.itemId) return true;
  return hold.itemId === itemId && !hold.lotCode;
}

export function blocksLot(hold: HoldKey, locationId: string, itemId: string, lotCode: string): boolean {
  if (hold.locationId !== locationId) return false;
  if (!hold.itemId) return true;
  if (hold.itemId !== itemId) return false;
  if (!hold.lotCode) return true;
  return hold.lotCode === lotCode;
}

export function coveringHold(holds: OpenHold[], locationId: string, itemId: string | null, lotCode: string | null): OpenHold | null {
  return (
    holds.find((hold) => {
      if (hold.locationId !== locationId) return false;
      if (!hold.itemId) return true;
      if (!itemId) return false;
      if (hold.itemId !== itemId) return false;
      if (!hold.lotCode) return true;
      return Boolean(lotCode) && hold.lotCode === lotCode;
    }) ?? null
  );
}

export function matchingHoldForMove(
  holds: OpenHold[],
  locationId: string,
  itemId: string,
  lotCode?: string | null,
): OpenHold | null {
  return (
    holds.find((hold) => {
      if (lotCode) return blocksLot(hold, locationId, itemId, lotCode);
      return blocksLocationItem(hold, locationId, itemId);
    }) ?? null
  );
}

export function availableQty(
  onHand: number,
  holds: HoldKey[],
  locationId: string,
  itemId: string,
  heldLotQty = 0,
): number {
  if (holds.some((hold) => blocksLocationItem(hold, locationId, itemId))) return 0;
  return Math.max(0, onHand - heldLotQty);
}

export function heldLotQtyAt(
  lotQtys: { locationId: string; itemId: string; lotCode: string; qty: number }[],
  holds: HoldKey[],
  locationId: string,
  itemId: string,
): number {
  const lots = new Set(
    holds
      .filter((hold) => hold.locationId === locationId && hold.itemId === itemId && hold.lotCode)
      .map((hold) => hold.lotCode as string),
  );
  if (lots.size === 0) return 0;
  let qty = 0;
  for (const row of lotQtys) {
    if (row.locationId === locationId && row.itemId === itemId && lots.has(row.lotCode)) {
      qty += Math.max(0, row.qty);
    }
  }
  return qty;
}

export function applyHoldsToOnHand<T extends { locationId: string; itemId: string; qty: number }>(
  onHand: T[],
  holds: HoldKey[],
  lotQtys: { locationId: string; itemId: string; lotCode: string; qty: number }[] = [],
): T[] {
  return onHand.map((row) => ({
    ...row,
    qty: availableQty(row.qty, holds, row.locationId, row.itemId, heldLotQtyAt(lotQtys, holds, row.locationId, row.itemId)),
  }));
}

export function unheldLots<T extends { lotCode: string }>(
  lots: T[],
  holds: HoldKey[],
  locationId: string,
  itemId: string,
): T[] {
  return lots.filter((row) => !holds.some((hold) => blocksLot(hold, locationId, itemId, row.lotCode)));
}

export function holdLabel(hold: { locationCode?: string | null; sku?: string | null; lotCode?: string | null }): string {
  const locationCode = hold.locationCode || "bay";
  if (hold.lotCode && hold.sku) return `${hold.sku} ${hold.lotCode} @ ${locationCode}`;
  if (hold.sku) return `${hold.sku} @ ${locationCode}`;
  return locationCode;
}
