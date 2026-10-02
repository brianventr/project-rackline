import { BOTH_MODES, exceptionItem, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";
import { poolLabel, type RestockPool } from "../restock";

export const RESTOCK_SOURCE: ExceptionSourceInfo = { id: "restock", label: "Restock", modes: BOTH_MODES };

export type RestockExceptionRow = {
  itemId: string;
  sku: string;
  warehouseId: string;
  pool: RestockPool;
  suggestedQty: number;
  makeDays: number;
  transitDays: number;
  gap: "make" | "transit";
  vendorName: string | null;
  orderByAt: number | null;
};

export function restockProblems(rows: readonly RestockExceptionRow[]): ExceptionItem[] {
  return rows.map((row) => {
    const who = poolLabel(row.pool);
    const wait = row.gap === "make" ? `${row.makeDays} days to make it` : `${row.transitDays} days on the way`;
    const vendor = row.vendorName ? ` Draft it from ${row.vendorName}.` : " No vendor is on file, so set one before drafting a PO.";
    return exceptionItem({
      source: RESTOCK_SOURCE.id,
      key: `restock:${row.warehouseId}:${row.itemId}:${row.pool.kind === "house" ? "house" : row.pool.clientId}`,
      kind: "restock",
      kindLabel: "Restock",
      severity: "warning",
      title: `Order ${row.sku} for ${who}`,
      detail: `${row.sku} for ${who} should be ordered now. Suggest ${row.suggestedQty}. ${wait}.${vendor}`,
      warehouseId: row.warehouseId,
      itemId: row.itemId,
      createdAt: row.orderByAt,
      link: "/analytics/restock",
      lane: "office",
      ownerOnly: true,
    });
  });
}
