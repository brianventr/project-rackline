import { OverMoveError } from "./partial-transfer";

export function remainingToReplenish(qty: number, qtyMoved: number): number {
  return qty - qtyMoved;
}

export function isFullyReplenished(qty: number, qtyMoved: number): boolean {
  return qty > 0 && qtyMoved >= qty;
}

export function applyPartialReplenish(
  header: { sku?: string; qty: number; qtyMoved: number },
  thisQty: number,
): { qtyMoved: number; postedQty: number } {
  if (!Number.isInteger(thisQty) || thisQty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  const remaining = remainingToReplenish(header.qty, header.qtyMoved);
  if (thisQty > remaining) {
    throw new OverMoveError(header.sku ?? "item", remaining, thisQty);
  }
  return { qtyMoved: header.qtyMoved + thisQty, postedQty: thisQty };
}
