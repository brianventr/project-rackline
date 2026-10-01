import { countHasVariance, countVariance, formatCountVariance } from "../blind-count";
import { DAY_MS, exceptionItem, listText, MANUFACTURER_ONLY, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/**
 * Posted counts that found a different quantity. Posting already set stock to what was counted (there
 * is no approval step), so the problem is the unexplained difference, until a later count of the bay.
 */
export const COUNT_SOURCE: ExceptionSourceInfo = { id: "count", label: "Count variances", modes: MANUFACTURER_ONLY };

export const COUNT_WINDOW_MS = 30 * DAY_MS;

export type CountRow = {
  id: string;
  number: string;
  warehouseId: string;
  locationId: string;
  locationCode: string;
  postedAt: number;
  lines: { sku: string; systemQty: number; countedQty: number }[];
};

export function countProblems(rows: readonly CountRow[]): ExceptionItem[] {
  return rows.flatMap((row) => {
    const off = row.lines
      .filter((line) => countHasVariance(line.countedQty, line.systemQty))
      .sort((a, b) => Math.abs(countVariance(b.countedQty, b.systemQty)) - Math.abs(countVariance(a.countedQty, a.systemQty)) || a.sku.localeCompare(b.sku));
    if (off.length === 0) return [];
    const parts = off.map((line) => `${line.sku} ${formatCountVariance(countVariance(line.countedQty, line.systemQty))}`);
    return [
      exceptionItem({
        source: COUNT_SOURCE.id,
        key: row.id,
        kind: "count_variance",
        kindLabel: "Count variance",
        severity: "info",
        title: `Count ${row.number} changed stock at ${row.locationCode}`,
        detail: `${listText(parts, 4)}. Stock already reads what was counted. Look for misplaced or damaged units, recount if it looks wrong, then resolve with what you found.`,
        warehouseId: row.warehouseId,
        locationId: row.locationId,
        createdAt: row.postedAt,
        link: `/stock/counts/${row.id}`,
        floorLink: `/floor/count?location=${encodeURIComponent(row.locationId)}`,
        lane: "floor",
      }),
    ];
  });
}
