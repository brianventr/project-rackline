import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  ORDER_INTEGRITY_SOURCE,
  RETRY_INGEST,
  cancelOpenProblems,
  missingSkuProblems,
  paidWaitProblems,
  partialRiskProblems,
} from "../../domain/exceptions/order-integrity";
import { cancelStillOpen, missingSkus, paidNotIngested, partialShipRisk } from "../../domain/order-integrity";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

export const orderIntegritySource: ExceptionSource = {
  ...ORDER_INTEGRITY_SOURCE,
  loadLimit: null,
  async load({ db, organizationId, warehouseId, now }) {
    const signals = await db
      .select({
        shopifyOrderId: schema.shopifyOrderSignals.shopifyOrderId,
        shopifyOrderName: schema.shopifyOrderSignals.shopifyOrderName,
        kind: schema.shopifyOrderSignals.kind,
        sku: schema.shopifyOrderSignals.sku,
        receivedAt: schema.shopifyOrderSignals.receivedAt,
      })
      .from(schema.shopifyOrderSignals)
      .where(eq(schema.shopifyOrderSignals.organizationId, organizationId));
    const shopifyOrders = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        status: schema.orders.status,
        warehouseId: schema.orders.warehouseId,
        shopifyOrderId: schema.orders.shopifyOrderId,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .where(and(eq(schema.orders.organizationId, organizationId), sql`${schema.orders.shopifyOrderId} is not null`));
    const known = shopifyOrders.flatMap((order) =>
      order.shopifyOrderId
        ? [{ id: order.id, number: order.number, status: order.status, warehouseId: order.warehouseId, shopifyOrderId: order.shopifyOrderId }]
        : [],
    );
    const paid = paidNotIngested(
      signals.filter((row) => row.kind === "paid"),
      known,
      now,
    );
    const openCancels = cancelStillOpen(
      signals.filter((row) => row.kind === "cancel"),
      known,
    ).filter((order) => order.warehouseId === warehouseId);
    const items = await db
      .select({ sku: schema.items.sku })
      .from(schema.items)
      .where(eq(schema.items.organizationId, organizationId));
    const gaps = missingSkus(
      signals.flatMap((row) => (row.kind === "missing_sku" && row.sku ? [{ ...row, sku: row.sku }] : [])),
      items.map((row) => row.sku),
    );

    const openOrders = await db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        warehouseId: schema.orders.warehouseId,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          eq(schema.orders.warehouseId, warehouseId),
          eq(schema.orders.source, "shopify"),
          notInArray(schema.orders.status, ["shipped", "cancelled"]),
        ),
      );
    const lineRows = openOrders.length
      ? await db
          .select({
            orderId: schema.orderLines.orderId,
            sku: schema.items.sku,
            qty: schema.orderLines.qty,
          })
          .from(schema.orderLines)
          .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
          .where(
            inArray(
              schema.orderLines.orderId,
              openOrders.map((order) => order.id),
            ),
          )
      : [];
    const linesByOrder = new Map<string, { sku: string; qty: number }[]>();
    for (const line of lineRows) {
      const list = linesByOrder.get(line.orderId) ?? [];
      list.push({ sku: line.sku, qty: line.qty });
      linesByOrder.set(line.orderId, list);
    }
    const balances = await db
      .select({
        sku: schema.items.sku,
        qty: sql<number>`coalesce(sum(${schema.inventoryBalances.qty}), 0)`,
      })
      .from(schema.inventoryBalances)
      .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
      .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
      .where(and(eq(schema.inventoryBalances.organizationId, organizationId), eq(schema.locations.warehouseId, warehouseId)))
      .groupBy(schema.items.sku);
    const risks = partialShipRisk(
      openOrders.map((order) => ({ ...order, lines: linesByOrder.get(order.id) ?? [] })),
      balances.map((row) => ({ sku: row.sku, qty: Number(row.qty) || 0 })),
    );

    return [
      ...paidWaitProblems(paid, warehouseId),
      ...cancelOpenProblems(openCancels),
      ...missingSkuProblems(gaps, warehouseId),
      ...partialRiskProblems(risks),
    ];
  },
  action(item, actionId) {
    if (actionId !== RETRY_INGEST.id) return null;
    const shopifyOrderId = item.key.startsWith("paid:") ? item.key.slice("paid:".length) : "";
    if (!shopifyOrderId) return null;
    return { path: `/shopify/signals/${encodeURIComponent(shopifyOrderId)}/ingest` };
  },
};
