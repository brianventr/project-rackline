export class OverCompleteError extends Error {
  constructor(
    public sku: string,
    public remaining: number,
    public qty: number,
  ) {
    super(`Cannot complete ${qty} of ${sku}: only ${remaining} remaining`);
    this.name = "OverCompleteError";
  }
}

export function remainingToComplete(qty: number, qtyCompleted: number): number {
  return qty - qtyCompleted;
}

export function isFullyCompleted(qty: number, qtyCompleted: number): boolean {
  return qty > 0 && qtyCompleted >= qty;
}

export function applyPartialComplete(
  header: { sku?: string; qty: number; qtyCompleted: number },
  thisQty: number,
): { qtyCompleted: number; postedQty: number } {
  if (!Number.isInteger(thisQty) || thisQty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }
  const remaining = remainingToComplete(header.qty, header.qtyCompleted);
  if (thisQty > remaining) {
    throw new OverCompleteError(header.sku ?? "item", remaining, thisQty);
  }
  return { qtyCompleted: header.qtyCompleted + thisQty, postedQty: thisQty };
}
