import { asSentence } from "../error-copy";
import { holdLabel } from "../holds";
import type { OperatingMode } from "../operating-mode";
import { BOTH_MODES, exceptionItem, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** Open holds: stock nobody can pick, move, or sell until someone checks it and releases the hold. */
export const HOLD_SOURCE: ExceptionSourceInfo = { id: "hold", label: "Holds", modes: BOTH_MODES };

export const RELEASE_HOLD = { id: "release-hold", label: "Release hold" } as const;

export type HoldRow = {
  id: string;
  number: string;
  reason: string;
  notes: string | null;
  warehouseId: string;
  locationId: string;
  locationCode: string;
  itemId: string | null;
  sku: string | null;
  lotCode: string | null;
  createdAt: number;
};

/** Garage has no hold screens, so its links go to the item or bay the hold covers. */
export function holdProblems(rows: readonly HoldRow[], mode: OperatingMode): ExceptionItem[] {
  const garage = mode === "garage";
  return rows.map((row) => {
    const what = holdLabel(row);
    const notes = row.notes?.trim() ? ` Note: ${asSentence(row.notes)}` : "";
    return exceptionItem({
      source: HOLD_SOURCE.id,
      key: row.id,
      kind: "hold",
      kindLabel: "On hold",
      severity: "warning",
      title: `${what} is on hold: ${row.reason}`,
      detail: `${row.number} keeps ${row.itemId ? "it" : "the whole bay"} from being picked, moved, or sold.${notes} Check the stock, then release the hold or adjust it out.`,
      warehouseId: row.warehouseId,
      itemId: row.itemId,
      locationId: row.locationId,
      createdAt: row.createdAt,
      link: garage ? (row.itemId ? `/stock/items/${row.itemId}` : `/stock/locations/${row.locationId}`) : `/stock/holds/${row.id}`,
      floorLink: garage ? null : `/floor/hold?id=${encodeURIComponent(row.id)}`,
      lane: "floor",
      action: RELEASE_HOLD,
    });
  });
}
