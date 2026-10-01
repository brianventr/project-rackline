import { and, eq, notExists, notInArray } from "drizzle-orm";
import { SHIP_ANYWAY, SHIP_RULE_SOURCE, shipRuleProblems, type ShipRuleOrderRow } from "../../domain/exceptions/ship-rule";
import { canQuickShip } from "../../domain/quick-ship";
import { rulesForBuilding } from "../../domain/ship-rules";
import * as schema from "../schema";
import { loadShipRules } from "../ship-rules";
import type { ExceptionSource } from "./source";

const CLOSED = ["shipped", "cancelled"];

export const shipRuleSource: ExceptionSource = {
  ...SHIP_RULE_SOURCE,
  async load({ db, organizationId, warehouseId }) {
    const rules = await loadShipRules(db, organizationId);
    if (!rulesForBuilding(rules, warehouseId).some((rule) => rule.enabled && (rule.hold || rule.carrierService))) return [];

    const o = schema.orders;
    const quickShippable = and(
      eq(o.organizationId, organizationId),
      eq(o.warehouseId, warehouseId),
      notInArray(o.status, CLOSED),
      notExists(db.select({ id: schema.orderPackages.id }).from(schema.orderPackages).where(eq(schema.orderPackages.orderId, o.id))),
    );
    const [orders, lines, connections] = await Promise.all([
      db
        .select({
          id: o.id,
          number: o.number,
          status: o.status,
          customerName: o.customerName,
          warehouseId: o.warehouseId,
          source: o.source,
          shipToAddress: o.shipToAddress,
          shipToRegion: o.shipToRegion,
          shipToCountry: o.shipToCountry,
          packageWeightOz: o.packageWeightOz,
          carrierService: o.carrierService,
          carrierConnectionId: o.carrierConnectionId,
          trackingNumber: o.trackingNumber,
          labelStatus: o.labelStatus,
          createdAt: o.createdAt,
        })
        .from(o)
        .where(quickShippable),
      db
        .select({
          orderId: schema.orderLines.orderId,
          sku: schema.items.sku,
          qty: schema.orderLines.qty,
          shipWeightOz: schema.items.shipWeightOz,
        })
        .from(schema.orderLines)
        .innerJoin(o, eq(o.id, schema.orderLines.orderId))
        .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
        .where(quickShippable),
      db
        .select({
          id: schema.carrierConnections.id,
          provider: schema.carrierConnections.provider,
          nickname: schema.carrierConnections.nickname,
          mode: schema.carrierConnections.mode,
          status: schema.carrierConnections.status,
          enabledServicesJson: schema.carrierConnections.enabledServicesJson,
          isDefault: schema.carrierConnections.isDefault,
        })
        .from(schema.carrierConnections)
        .where(eq(schema.carrierConnections.organizationId, organizationId)),
    ]);

    const linesByOrder = new Map<string, ShipRuleOrderRow["lines"]>();
    for (const line of lines) {
      const list = linesByOrder.get(line.orderId) ?? [];
      list.push({ sku: line.sku, qty: line.qty, shipWeightOz: line.shipWeightOz });
      linesByOrder.set(line.orderId, list);
    }
    return shipRuleProblems({
      orders: orders
        .filter((order) => canQuickShip(order.status))
        .map((order) => ({
          ...order,
          hasLabel: Boolean(order.trackingNumber) && order.labelStatus === "purchased",
          lines: linesByOrder.get(order.id) ?? [],
        })),
      rules,
      connections,
    });
  },
  action(item, actionId) {
    if (actionId !== SHIP_ANYWAY.id || item.kind !== "rule_hold" || !item.orderId) return null;
    return { path: `/orders/${item.orderId}/quick-ship`, body: { releaseHold: true } };
  },
};
