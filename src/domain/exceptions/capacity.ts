import { capacityAmount, EMPTY_USAGE, overCapacity, type BinCapacity, type BinUsage, type CapacityMeasure } from "../capacity";
import { exceptionItem, MANUFACTURER_ONLY, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** Bays holding more than their limit: an owner overrode it, the limit came down, or a count found more. */
export const CAPACITY_SOURCE: ExceptionSourceInfo = { id: "capacity", label: "Bay capacity", modes: MANUFACTURER_ONLY };

const HOLDS: Record<CapacityMeasure, string> = { qty: "holds", weight: "weighs", volume: "fills" };

export type CapacityRow = {
  locationId: string;
  code: string;
  barcode: string;
  warehouseId: string;
  capacity: BinCapacity;
  usage: BinUsage;
  /** The latest owner override that filled the bay, when there is one. */
  overriddenAt: number | null;
};

export function capacityProblems(rows: readonly CapacityRow[]): ExceptionItem[] {
  return rows.flatMap((row) => {
    const breach = overCapacity(row.capacity, EMPTY_USAGE, row.usage);
    if (!breach) return [];
    const held = capacityAmount(breach.measure, breach.after);
    const limit = capacityAmount(breach.measure, breach.limit);
    const why = row.overriddenAt != null ? " An owner overrode the limit to fill it." : "";
    return [
      exceptionItem({
        source: CAPACITY_SOURCE.id,
        key: row.locationId,
        kind: "over_capacity",
        kindLabel: "Over capacity",
        severity: "info",
        title: `${row.code} is over its limit`,
        detail: `It ${HOLDS[breach.measure]} ${held}, over its limit of ${limit}.${why} Move some stock to another bay, or raise the limit if the bay really fits more.`,
        warehouseId: row.warehouseId,
        locationId: row.locationId,
        createdAt: row.overriddenAt,
        link: `/stock/locations/${row.locationId}`,
        floorLink: `/floor/putaway?from=${encodeURIComponent(row.barcode)}`,
        lane: "floor",
      }),
    ];
  });
}
