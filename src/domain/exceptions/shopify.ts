import { asSentence } from "../error-copy";
import { BOTH_MODES, exceptionItem, parseJsonObject, plural, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

export const SHOPIFY_SOURCE: ExceptionSourceInfo = { id: "shopify", label: "Shopify", modes: BOTH_MODES };

export const RETRY_SHOPIFY = { id: "retry-shopify", label: "Retry fulfillment" } as const;
export const PUSH_SHOPIFY_STOCK = { id: "push-shopify-stock", label: "Push stock again" } as const;

export const STOCK_PUSH_KEY = "stock-push";
/** Newest stock pushes read to find the run of failures at the top. */
export const STOCK_PUSH_EVENTS = 20;

export type ShopifyFulfillRow = {
  id: string;
  number: string;
  shopifyOrderName: string | null;
  customerName: string;
  warehouseId: string;
  shopifySyncError: string | null;
  shippedAt: number | null;
  createdAt: number;
};

export function shopifyFulfillmentProblems(rows: readonly ShopifyFulfillRow[]): ExceptionItem[] {
  return rows.map((row) => {
    const name = row.shopifyOrderName && row.shopifyOrderName !== row.number ? ` (${row.shopifyOrderName} in Shopify)` : "";
    const why = row.shopifySyncError ? `${asSentence(row.shopifySyncError)} ` : "";
    return exceptionItem({
      source: SHOPIFY_SOURCE.id,
      key: `order.${row.id}`,
      kind: "fulfillment_failed",
      kindLabel: "Shopify fulfillment failed",
      severity: "warning",
      title: `Shopify was not told order ${row.number} shipped`,
      detail: `${why}Order ${row.number}${name} still reads unfulfilled in Shopify, so ${row.customerName} has no tracking. Retry, or fulfill it in Shopify.`,
      warehouseId: row.warehouseId,
      orderId: row.id,
      createdAt: row.shippedAt ?? row.createdAt,
      link: `/outbound/orders/${row.id}`,
      action: RETRY_SHOPIFY,
    });
  });
}

export type ShopifyPushEvent = { status: string; responseJson: string | null; createdAt: number };

/**
 * The run of failed stock pushes at the top of `events` (newest first) is one problem, dated from
 * its first failure. Pushes cover some SKUs or all of them, so any later good push clears it; the
 * action pushes every SKU.
 */
export function shopifyStockPushProblem(events: readonly ShopifyPushEvent[]): ExceptionItem | null {
  const run: ShopifyPushEvent[] = [];
  for (const event of events) {
    if (event.status !== "failed") break;
    run.push(event);
  }
  const latest = run[0];
  const first = run[run.length - 1];
  if (!latest || !first) return null;
  const tries = run.length > 1 ? `The last ${plural(run.length, "push", "pushes")} failed. ` : "";
  return exceptionItem({
    source: SHOPIFY_SOURCE.id,
    key: STOCK_PUSH_KEY,
    kind: "stock_push_failed",
    kindLabel: "Stock push failed",
    severity: "warning",
    title: "Shopify is not getting sellable stock",
    detail: `${pushError(latest.responseJson)} ${tries}Shopify may sell stock you do not have. Fix it in Shopify settings, then push again.`,
    createdAt: first.createdAt,
    link: "/setup/shopify",
    ownerOnly: true,
    action: PUSH_SHOPIFY_STOCK,
  });
}

function pushError(responseJson: string | null): string {
  const body = parseJsonObject(responseJson);
  const errors = body?.errors;
  const first = Array.isArray(errors) ? (errors[0] as { message?: unknown } | undefined)?.message : errors;
  const text = [body?.error, body?.message, first].find((value): value is string => typeof value === "string" && value.trim() !== "");
  return text ? asSentence(text) : "Shopify refused the last stock push.";
}
