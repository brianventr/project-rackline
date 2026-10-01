import { BOTH_MODES, exceptionItem, listText, plural, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/**
 * A short ship closes the order with what left and opens a `-BO` backorder for the rest. Rackline
 * keeps no record of a short pick itself, so the open backorder is the problem: a customer still owed.
 */
export const BACKORDER_SOURCE: ExceptionSourceInfo = { id: "backorder", label: "Short ships", modes: BOTH_MODES };

export type BackorderRow = {
  id: string;
  number: string;
  parentId: string | null;
  parentNumber: string | null;
  customerName: string;
  warehouseId: string;
  createdAt: number;
  units: number;
  skus: string[];
};

export function backorderProblems(rows: readonly BackorderRow[]): ExceptionItem[] {
  return rows.map((row) => {
    const owed = row.units > 0 ? plural(row.units, "unit") : "the rest";
    const what = row.skus.length ? ` (${listText(row.skus)})` : "";
    const parent = row.parentNumber ? `Order ${row.parentNumber}` : "The order";
    return exceptionItem({
      source: BACKORDER_SOURCE.id,
      key: row.id,
      kind: "short_ship",
      kindLabel: "Short ship",
      severity: "warning",
      title: `${row.customerName} is still owed ${owed} on ${row.number}`,
      detail: `${parent} shipped short, so ${row.number} holds what is left${what}. Ship it once the stock is in, or cancel it and tell the customer.`,
      warehouseId: row.warehouseId,
      orderId: row.id,
      createdAt: row.createdAt,
      link: `/outbound/orders/${row.id}`,
    });
  });
}
