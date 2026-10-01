import type { CarrierConnectionLike } from "../carriers";
import { holdMessage, planShipment } from "../ship-decision";
import type { ShipRule } from "../ship-rules";
import { exceptionItem, GARAGE_ONLY, listText, plural, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** Rules only stop one-click ship, which is Garage's; Manufacturer ships through the floor. */
export const SHIP_RULE_SOURCE: ExceptionSourceInfo = { id: "ship-rule", label: "Shipping rules", modes: GARAGE_ONLY };

export const SHIP_ANYWAY = { id: "ship-anyway", label: "Ship anyway" } as const;

export type ShipRuleOrderRow = {
  id: string;
  number: string;
  customerName: string;
  warehouseId: string;
  source: string;
  shipToAddress: string | null;
  shipToRegion: string | null;
  shipToCountry: string | null;
  packageWeightOz: number | null;
  carrierService: string | null;
  carrierConnectionId: string | null;
  createdAt: number;
  /** Quick-ship skips the rule's service check for an order that already has a label. */
  hasLabel: boolean;
  lines: { sku: string; qty: number; shipWeightOz: number | null }[];
};

/**
 * Orders a rule holds for review, one problem each, and rules whose service no carrier account
 * offers, one problem per rule with the orders it blocks. A held order whose rule is also broken
 * counts under the rule: shipping it anyway would stop on the service.
 */
export function shipRuleProblems(input: {
  orders: readonly ShipRuleOrderRow[];
  rules: ShipRule[];
  connections: CarrierConnectionLike[];
}): ExceptionItem[] {
  const items: ExceptionItem[] = [];
  const broken = new Map<string, { name: string; problem: string; orders: ShipRuleOrderRow[] }>();
  for (const order of input.orders) {
    const plan = planShipment({
      order: { ...order, weightOz: order.packageWeightOz },
      rules: input.rules,
      presets: [],
      connections: input.connections,
      buildingDefault: null,
    });
    if (!plan.rule) continue;
    if (plan.problem && !order.hasLabel) {
      const group = broken.get(plan.rule.id) ?? { name: plan.rule.name, problem: plan.problem, orders: [] };
      group.orders.push(order);
      broken.set(plan.rule.id, group);
      continue;
    }
    if (!plan.hold) continue;
    items.push(
      exceptionItem({
        source: SHIP_RULE_SOURCE.id,
        key: order.id,
        kind: "rule_hold",
        kindLabel: "Held by rule",
        severity: "blocking",
        title: `Order ${order.number} is held by rule “${plan.rule.name}”`,
        detail: `${holdMessage(plan)} Ship anyway here once it checks out.`,
        warehouseId: order.warehouseId,
        orderId: order.id,
        createdAt: order.createdAt,
        link: `/outbound/orders/${order.id}`,
        action: SHIP_ANYWAY,
      }),
    );
  }
  for (const [ruleId, group] of broken) {
    const orders = [...group.orders].sort((a, b) => a.createdAt - b.createdAt);
    items.push(
      exceptionItem({
        source: SHIP_RULE_SOURCE.id,
        key: `rule.${ruleId}`,
        kind: "rule_service",
        kindLabel: "Rule can't ship",
        severity: "blocking",
        title: `Rule “${group.name}” is stopping ${plural(orders.length, "order")}`,
        detail: `${group.problem} Waiting: ${listText(orders.map((order) => order.number))}.`,
        warehouseId: orders[0]!.warehouseId,
        orderId: orders.length === 1 ? orders[0]!.id : null,
        createdAt: orders[0]!.createdAt,
        link: "/setup/shipping-rules",
        ownerOnly: true,
      }),
    );
  }
  return items;
}
