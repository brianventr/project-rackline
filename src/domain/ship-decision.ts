import { enabledServicesFromConnections, resolveLabelPurchase, type CarrierConnectionLike } from "./carriers";
import { pickPreset, type PackagePreset } from "./ship-defaults";
import { matchShipRule, RATE_STRATEGY_LABELS, type RateStrategy, type ShipRule, type ShipRuleOrder } from "./ship-rules";

export type ShipBoxSource = "picked" | "rule" | "auto" | "default";
export type ShipServiceSource = "picked" | "rule" | "order" | "default";
export type AutoRateStrategy = Exclude<RateStrategy, "default">;

export type ShipBoxChoice = {
  preset: PackagePreset | null;
  source: ShipBoxSource | null;
  /** Why the box was not picked automatically, when picking could have helped. */
  note: string | null;
};

export type ShipServicePlan =
  | { kind: "service"; serviceId: string; connectionId: string | null; source: ShipServiceSource }
  | { kind: "strategy"; strategy: AutoRateStrategy; source: "rule" | "building" }
  | { kind: "none" };

export type ShipPlan = {
  rule: { id: string; name: string } | null;
  hold: boolean;
  box: ShipBoxChoice;
  service: ShipServicePlan;
  /** The matched rule ships with a service no carrier account offers; the order waits until the rule is fixed. */
  problem: string | null;
};

export type ShipPlanInput = {
  order: ShipRuleOrder & { carrierService?: string | null; carrierConnectionId?: string | null };
  rules: ShipRule[];
  presets: PackagePreset[];
  connections: CarrierConnectionLike[];
  /** `buildingDefaultService` for the order's building. */
  buildingDefault: { serviceId: string; connectionId: string | null } | null;
  buildingStrategy?: RateStrategy;
  /** Picked at the bench for this ship; wins over rules and defaults. */
  picked?: { presetId?: string | null; carrierService?: string | null; carrierConnectionId?: string | null };
};

/**
 * Box and service for one order. Box: picked at the bench, then the matched rule's box, then the default box.
 * Service: picked at the bench, then the matched rule's service or rate choice, then a service already on the
 * order, then the building's rate choice (its default service unless set to cheapest, fastest, or on time).
 */
export function planShipment(input: ShipPlanInput): ShipPlan {
  const rule = matchShipRule(input.rules, input.order);
  const service = planService(input, rule);
  return {
    rule: rule ? { id: rule.id, name: rule.name } : null,
    hold: Boolean(rule?.hold),
    box: planBox(input, rule),
    service: service.plan,
    problem: service.problem,
  };
}

function planBox(input: ShipPlanInput, rule: ShipRule | null): ShipBoxChoice {
  const picked = input.picked?.presetId?.trim();
  if (picked) {
    const preset = input.presets.find((row) => row.id === picked) ?? null;
    return { preset, source: preset ? "picked" : null, note: null };
  }
  const ruled = rule?.presetId ? input.presets.find((row) => row.id === rule.presetId) : null;
  if (ruled) return { preset: ruled, source: "rule", note: null };
  const fallback = pickPreset(input.presets);
  return { preset: fallback, source: fallback ? "default" : null, note: null };
}

function planService(input: ShipPlanInput, rule: ShipRule | null): { plan: ShipServicePlan; problem: string | null } {
  const services = enabledServicesFromConnections(input.connections);
  const { order, buildingDefault } = input;
  const picked = input.picked?.carrierService?.trim();
  if (picked) {
    const connectionId =
      input.picked?.carrierConnectionId?.trim() ||
      (picked === order.carrierService ? order.carrierConnectionId : null) ||
      (picked === buildingDefault?.serviceId ? buildingDefault.connectionId : null) ||
      services.find((row) => row.id === picked)?.connectionId ||
      null;
    return { plan: { kind: "service", serviceId: picked, connectionId, source: "picked" }, problem: null };
  }

  if (rule?.carrierService) {
    const purchase = resolveLabelPurchase({
      connections: input.connections,
      serviceId: rule.carrierService,
      connectionId: rule.carrierConnectionId,
    });
    if (!purchase.ok) {
      return {
        plan: { kind: "none" },
        problem: `Rule “${rule.name}” ships with a service no connected carrier account offers. Edit the rule or turn the service back on.`,
      };
    }
    return { plan: { kind: "service", serviceId: purchase.service.id, connectionId: purchase.connectionId, source: "rule" }, problem: null };
  }
  if (rule?.rateStrategy === "default") return { plan: defaultService(services, buildingDefault, "rule"), problem: null };
  if (rule?.rateStrategy) return { plan: { kind: "strategy", strategy: rule.rateStrategy, source: "rule" }, problem: null };

  if (order.carrierService?.trim()) {
    const purchase = resolveLabelPurchase({
      connections: input.connections,
      serviceId: order.carrierService,
      connectionId: order.carrierConnectionId,
    });
    if (purchase.ok) {
      return { plan: { kind: "service", serviceId: purchase.service.id, connectionId: purchase.connectionId, source: "order" }, problem: null };
    }
  }

  const strategy = input.buildingStrategy ?? "default";
  if (strategy !== "default") return { plan: { kind: "strategy", strategy, source: "building" }, problem: null };
  return { plan: defaultService(services, buildingDefault, "default"), problem: null };
}

function defaultService(
  services: ReturnType<typeof enabledServicesFromConnections>,
  buildingDefault: ShipPlanInput["buildingDefault"],
  source: ShipServiceSource,
): ShipServicePlan {
  if (buildingDefault) return { kind: "service", serviceId: buildingDefault.serviceId, connectionId: buildingDefault.connectionId, source };
  const first = services.find((row) => row.provider !== "rackline") ?? services[0];
  return first ? { kind: "service", serviceId: first.id, connectionId: first.connectionId, source } : { kind: "none" };
}

export function holdMessage(plan: Pick<ShipPlan, "rule">): string {
  return `Held for review by rule “${plan.rule?.name ?? "Hold"}”. Open the order to check it, then ship it.`;
}

/** Short words for the queue: why this box. */
export function shipBoxReason(plan: Pick<ShipPlan, "box" | "rule">): string | null {
  switch (plan.box.source) {
    case "picked":
      return "Picked";
    case "rule":
      return `Rule: ${plan.rule?.name ?? ""}`.trim();
    case "auto":
      return "Auto";
    case "default":
      return "Default box";
    default:
      return null;
  }
}

/** Short words for the queue: why this service. `strategyReason` comes from `chooseRate`. */
export function shipServiceReason(plan: Pick<ShipPlan, "service" | "rule">, strategyReason?: string | null): string | null {
  const service = plan.service;
  if (service.kind === "none") return null;
  const ruleWords = service.source === "rule" && plan.rule ? `Rule: ${plan.rule.name}` : null;
  if (service.kind === "strategy") {
    return [ruleWords, strategyReason || RATE_STRATEGY_LABELS[service.strategy]].filter(Boolean).join(" · ");
  }
  switch (service.source) {
    case "picked":
      return "Picked";
    case "rule":
      return ruleWords;
    case "order":
      return "Order's service";
    default:
      return "Default service";
  }
}

/** What quick-ship writes to `orders.ship_reason`: `Mailer (Rule: Small parcels) · UPS Ground (Cheapest)`. */
export function shipReasonSummary(input: {
  boxName: string | null;
  boxReason: string | null;
  serviceName: string | null;
  serviceReason: string | null;
}): string | null {
  const part = (name: string | null, reason: string | null) => (name ? (reason ? `${name} (${reason})` : name) : null);
  const text = [part(input.boxName, input.boxReason), part(input.serviceName, input.serviceReason)].filter(Boolean).join(" · ");
  return text || null;
}
