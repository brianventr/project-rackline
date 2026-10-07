import { BOTH_MODES, exceptionItem, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";
import type { KnownOrder, MissingSkuSignal, PaidSignal, PartialRisk } from "../order-integrity";

export const ORDER_INTEGRITY_SOURCE: ExceptionSourceInfo = { id: "order-integrity", label: "Orders", modes: BOTH_MODES };

export const RETRY_INGEST = { id: "retry-ingest", label: "Try the order again" } as const;

export function paidWaitProblems(rows: readonly PaidSignal[], warehouseId: string): ExceptionItem[] {
  return rows.map((row) =>
    exceptionItem({
      source: ORDER_INTEGRITY_SOURCE.id,
      key: `paid:${row.shopifyOrderId}`,
      kind: "paid_missing",
      kindLabel: "Paid order missing",
      severity: "warning",
      title: `${row.shopifyOrderName || row.shopifyOrderId} was paid and is not in Rackline`,
      detail: "Shopify marked this order paid more than two hours ago. Add any missing SKUs, then try the order again.",
      warehouseId,
      createdAt: row.receivedAt,
      link: "/setup/shopify",
      action: RETRY_INGEST,
    }),
  );
}

export function cancelOpenProblems(rows: readonly KnownOrder[]): ExceptionItem[] {
  return rows.map((row) =>
    exceptionItem({
      source: ORDER_INTEGRITY_SOURCE.id,
      key: `cancel:${row.id}`,
      kind: "cancel_open",
      kindLabel: "Cancel still open",
      severity: "blocking",
      title: `Shopify cancelled ${row.number}, and it is still ${row.status} here`,
      detail: "The cancel reached Rackline after the order was already moving. Void the label if it has not shipped, then cancel the order.",
      warehouseId: row.warehouseId,
      orderId: row.id,
      createdAt: null,
      link: `/outbound/orders/${row.id}`,
      lane: "office",
    }),
  );
}

export function missingSkuProblems(rows: readonly MissingSkuSignal[], warehouseId: string): ExceptionItem[] {
  const bySku = new Map<string, MissingSkuSignal>();
  for (const row of rows) {
    const sku = row.sku.trim().toUpperCase();
    if (!bySku.has(sku)) bySku.set(sku, row);
  }
  return [...bySku.values()].map((row) =>
    exceptionItem({
      source: ORDER_INTEGRITY_SOURCE.id,
      key: `sku:${row.sku.trim().toUpperCase()}`,
      kind: "missing_sku",
      kindLabel: "SKU not in catalog",
      severity: "warning",
      title: `${row.sku} is on a Shopify order and not in the catalog`,
      detail: `${row.shopifyOrderName || row.shopifyOrderId} cannot come in until ${row.sku} exists. Add the SKU, then try the order again.`,
      warehouseId,
      createdAt: row.receivedAt,
      link: "/stock/items",
    }),
  );
}

export function partialRiskProblems(rows: readonly PartialRisk[]): ExceptionItem[] {
  return rows.map((row) => {
    const detail = row.short.map((line) => `${line.sku} needs ${line.need} and the shelf has ${line.have}`).join(". ");
    return exceptionItem({
      source: ORDER_INTEGRITY_SOURCE.id,
      key: `partial:${row.orderId}`,
      kind: "partial_risk",
      kindLabel: "Partial shipment risk",
      severity: "warning",
      title: `${row.number} may ship short`,
      detail: `${detail}. A short ship can mark the whole Shopify order fulfilled. Wait for stock or short-ship on purpose.`,
      warehouseId: row.warehouseId,
      orderId: row.orderId,
      createdAt: row.createdAt,
      link: `/outbound/orders/${row.orderId}`,
    });
  });
}
