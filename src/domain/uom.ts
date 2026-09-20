export class UomConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UomConversionError";
  }
}

export function toStockQty(altQty: number, altPerStock: number | null | undefined): number {
  if (!Number.isInteger(altQty) || altQty <= 0) {
    throw new UomConversionError("Alternate quantity must be a positive integer");
  }
  if (altPerStock == null || !Number.isInteger(altPerStock) || altPerStock <= 0) {
    throw new UomConversionError("Item has no alternate UoM conversion");
  }
  return altQty * altPerStock;
}

export function fromStockQty(stockQty: number, altPerStock: number | null | undefined): number | null {
  if (altPerStock == null || !Number.isInteger(altPerStock) || altPerStock <= 0) return null;
  if (!Number.isInteger(stockQty) || stockQty < 0) return null;
  if (stockQty % altPerStock !== 0) return null;
  return stockQty / altPerStock;
}

export function resolveLineStockQty(input: {
  qty?: number;
  altQty?: number;
  altPerStock?: number | null;
}): number {
  if (input.altQty != null) return toStockQty(input.altQty, input.altPerStock);
  if (input.qty == null) throw new UomConversionError("Quantity is required");
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new UomConversionError("Quantity must be a positive integer");
  }
  return input.qty;
}
