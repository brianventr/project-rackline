import { asSentence } from "../error-copy";
import { BOTH_MODES, DAY_MS, exceptionItem, parseJsonObject, plural, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** Label buys and voids the carrier refused, from `carrier_outbound_events`. */
export const CARRIER_SOURCE: ExceptionSourceInfo = { id: "carrier", label: "Carrier labels", modes: BOTH_MODES };

/** Failures older than this drop off; the carrier event log keeps no other end. */
export const CARRIER_WINDOW_MS = 30 * DAY_MS;

export type CarrierEventRow = {
  id: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  warehouseId: string;
  kind: string;
  status: string;
  requestJson: string;
  responseJson: string | null;
  createdAt: number;
};

type Run = { first: CarrierEventRow; latest: CarrierEventRow; tries: number };

function eventError(row: CarrierEventRow): string | null {
  const error = parseJsonObject(row.responseJson)?.error;
  return typeof error === "string" && error.trim() ? asSentence(error) : null;
}

function eventRequest(row: CarrierEventRow): { packageId: string | null; replaced: boolean } {
  const request = parseJsonObject(row.requestJson);
  const packageId = typeof request?.packageId === "string" && request.packageId ? request.packageId : null;
  return { packageId, replaced: request?.relabel === true };
}

/**
 * Open problems from buy and void events, oldest first. A failed buy lasts until a later buy works
 * or the order ships or is cancelled. A failed void lasts until a later void of the same label works
 * or the order ships on it. A label replaced by a relabel or short ship that could not be voided has
 * no later void to clear it: it lasts until someone voids it at the carrier and resolves it here.
 */
export function carrierProblems(events: readonly CarrierEventRow[]): ExceptionItem[] {
  const sorted = [...events].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const runs = new Map<string, Run>();
  const replaced: CarrierEventRow[] = [];
  for (const row of sorted) {
    if (row.kind !== "buy" && row.kind !== "void") continue;
    const request = eventRequest(row);
    if (row.kind === "void" && request.replaced) {
      if (row.status === "failed") replaced.push(row);
      continue;
    }
    const key = row.kind === "buy" ? `buy.${row.orderId}` : `void.${row.orderId}.${request.packageId ?? "order"}`;
    if (row.status === "ok") {
      runs.delete(key);
      continue;
    }
    if (row.status !== "failed") continue;
    const run = runs.get(key);
    runs.set(key, run ? { first: run.first, latest: row, tries: run.tries + 1 } : { first: row, latest: row, tries: 1 });
  }

  const items: ExceptionItem[] = [];
  for (const [key, run] of runs) {
    const order = run.latest;
    if (order.orderStatus === "shipped") continue;
    if (key.startsWith("buy.")) {
      if (order.orderStatus === "cancelled") continue;
      items.push(buyItem(key, run));
    } else {
      items.push(voidItem(key, run));
    }
  }
  for (const row of replaced) items.push(replacedItem(row));
  return items;
}

function tries(run: Run): string {
  return run.tries > 1 ? ` It failed ${plural(run.tries, "time")}.` : "";
}

function base(row: CarrierEventRow) {
  return {
    source: CARRIER_SOURCE.id,
    warehouseId: row.warehouseId,
    orderId: row.orderId,
    link: `/outbound/orders/${row.orderId}`,
  };
}

function buyItem(key: string, run: Run): ExceptionItem {
  const row = run.latest;
  return exceptionItem({
    ...base(row),
    key,
    kind: "label_buy_failed",
    kindLabel: "Label buy failed",
    severity: "warning",
    title: `The carrier would not sell a label for order ${row.orderNumber}`,
    detail: `${eventError(row) ?? "The carrier refused the label."}${tries(run)} Fix what it says on the order, then buy the label again.`,
    createdAt: run.first.createdAt,
  });
}

function voidItem(key: string, run: Run): ExceptionItem {
  const row = run.latest;
  return exceptionItem({
    ...base(row),
    key,
    kind: "label_void_failed",
    kindLabel: "Label void failed",
    severity: "warning",
    title: `A label on order ${row.orderNumber} did not void`,
    detail: `${eventError(row) ?? "The carrier refused the void."}${tries(run)} Void it again from the order, or in your carrier account, so the postage comes back.`,
    createdAt: run.first.createdAt,
  });
}

function replacedItem(row: CarrierEventRow): ExceptionItem {
  return exceptionItem({
    ...base(row),
    key: `replaced.${row.id}`,
    kind: "old_label_not_voided",
    kindLabel: "Old label not voided",
    severity: "warning",
    title: `An old label on order ${row.orderNumber} was not voided`,
    detail: `${eventError(row) ?? "The carrier refused the void."} The order has its new label; void the old one in your carrier account so the postage comes back, then resolve this.`,
    createdAt: row.createdAt,
  });
}
