import type { AutomationPolicy } from "../automation";
import { replenishmentReminderDue } from "../automation";
import { BOTH_MODES, exceptionItem, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";
import type { OperatingMode } from "../operating-mode";
import type { LowStockRow } from "../reorder";
import type { StarvedPickFace } from "../replenishment";

export const AUTOMATION_SOURCE: ExceptionSourceInfo = { id: "automation", label: "Automation", modes: BOTH_MODES };

export type OpenReplenishmentReminder = {
  id: string;
  number: string;
  sku: string;
  createdAt: number;
  warehouseId: string;
  itemId: string;
};

function placeLink(mode: OperatingMode, itemId: string, replenishmentId?: string): { link: string; floorLink: string | null; lane: "office" | "floor" } {
  if (mode === "garage") return { link: `/stock/items/${itemId}`, floorLink: null, lane: "office" };
  return {
    link: replenishmentId ? `/stock/replenish/${replenishmentId}` : "/stock/replenish",
    floorLink: "/floor/replenish",
    lane: "floor",
  };
}

export function starvedExceptions(rows: readonly StarvedPickFace[], mode: OperatingMode): ExceptionItem[] {
  return rows.map((row) => {
    const place = placeLink(mode, row.itemId);
    return exceptionItem({
      source: AUTOMATION_SOURCE.id,
      key: `starved:${row.warehouseId}:${row.itemId}:${row.toLocationId}`,
      kind: "starved-pick",
      kindLabel: "Starved pick face",
      severity: "warning",
      title: `${row.sku} at ${row.toCode} needs bulk`,
      detail: `${row.sku} at ${row.toCode} has ${row.pickQty} and the pick minimum is ${row.pickMin}. Nothing in bulk can cover it.`,
      warehouseId: row.warehouseId,
      itemId: row.itemId,
      locationId: row.toLocationId,
      link: place.link,
      floorLink: place.floorLink,
      lane: place.lane,
    });
  });
}

export function overdueReplenishExceptions(
  rows: readonly OpenReplenishmentReminder[],
  mode: OperatingMode,
  now: number,
  hours: number | null,
): ExceptionItem[] {
  if (hours == null) return [];
  return rows
    .filter((row) => replenishmentReminderDue(row.createdAt, now, hours))
    .map((row) => {
      const place = placeLink(mode, row.itemId, row.id);
      return exceptionItem({
        source: AUTOMATION_SOURCE.id,
        key: `replenish-open:${row.id}`,
        kind: "replenish-reminder",
        kindLabel: "Replenishment reminder",
        severity: "warning",
        title: `${row.number} is still open`,
        detail: `${row.sku} on ${row.number} has been open for more than ${hours} ${hours === 1 ? "hour" : "hours"}.`,
        warehouseId: row.warehouseId,
        itemId: row.itemId,
        createdAt: row.createdAt,
        link: place.link,
        floorLink: place.floorLink,
        lane: place.lane,
      });
    });
}

export function reorderExceptions(rows: readonly LowStockRow[], warehouseId: string): ExceptionItem[] {
  return rows.map((row) =>
    exceptionItem({
      source: AUTOMATION_SOURCE.id,
      key: `reorder:${warehouseId}:${row.itemId}`,
      kind: "reorder",
      kindLabel: "Reorder",
      severity: "warning",
      title: `Reorder ${row.sku}`,
      detail: `${row.sku} has ${row.onHand} on hand and the reorder point is ${row.reorderPoint}. It is also on Today.`,
      warehouseId,
      itemId: row.itemId,
      link: "/today",
      lane: "office",
      ownerOnly: true,
    }),
  );
}

export function automationProblems(input: {
  policy: AutomationPolicy;
  mode: OperatingMode;
  now: number;
  warehouseId: string;
  starved: readonly StarvedPickFace[];
  openReplenishments: readonly OpenReplenishmentReminder[];
  lowStock: readonly LowStockRow[];
}): ExceptionItem[] {
  const starved = input.policy.bulkGap === "exception" ? starvedExceptions(input.starved, input.mode) : [];
  const reminders = overdueReplenishExceptions(
    input.openReplenishments,
    input.mode,
    input.now,
    input.policy.remindOpenAfterHours,
  );
  const reorder = input.policy.reorderAlert === "exception" ? reorderExceptions(input.lowStock, input.warehouseId) : [];
  return [...starved, ...reminders, ...reorder];
}
