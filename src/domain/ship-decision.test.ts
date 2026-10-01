import { describe, expect, it } from "vitest";
import { holdMessage, planShipment, shipBoxReason, shipReasonSummary, shipServiceReason, type ShipPlanInput } from "./ship-decision";
import type { PackagePreset } from "./ship-defaults";
import type { ShipRule } from "./ship-rules";

const mailer: PackagePreset = { id: "mailer", name: "Mailer", lengthIn: 10, widthIn: 8, heightIn: 2, tareOz: 2, isDefault: true };
const box: PackagePreset = { id: "box", name: "Box", lengthIn: 12, widthIn: 12, heightIn: 8, tareOz: 8, isDefault: false };

const connections = [
  { id: "c-rl", provider: "rackline", nickname: "Rackline", mode: "demo", enabledServicesJson: '["rackline_ground"]', isDefault: true },
  { id: "c-ups", provider: "ups", nickname: "UPS", mode: "demo", enabledServicesJson: '["ups_ground","ups_2day"]', isDefault: false },
  { id: "c-usps", provider: "usps", nickname: "USPS", mode: "demo", enabledServicesJson: '["usps_priority"]', isDefault: false },
];

function rule(id: string, patch: Partial<ShipRule> = {}): ShipRule {
  return {
    id,
    name: id,
    position: 1,
    enabled: true,
    warehouseId: null,
    conditions: {},
    presetId: null,
    carrierService: null,
    carrierConnectionId: null,
    rateStrategy: null,
    hold: false,
    ...patch,
  };
}

function input(patch: Partial<ShipPlanInput> = {}): ShipPlanInput {
  return {
    order: { warehouseId: "w1", source: "shopify", lines: [{ sku: "LAMP", qty: 1, shipWeightOz: 12 }] },
    rules: [],
    presets: [mailer, box],
    connections,
    buildingDefault: { serviceId: "usps_priority", connectionId: "c-usps" },
    ...patch,
  };
}

describe("planShipment", () => {
  it("falls back to the default box and the building's default service", () => {
    const plan = planShipment(input());
    expect(plan.rule).toBeNull();
    expect(plan.hold).toBe(false);
    expect(plan.box).toEqual({ preset: mailer, source: "default", note: "No ship size on LAMP", tooBig: false });
    expect(plan.service).toEqual({ kind: "service", serviceId: "usps_priority", connectionId: "c-usps", source: "default" });
    expect(shipBoxReason(plan)).toBe("Default box");
    expect(shipServiceReason(plan)).toBe("Default service");
  });

  it("uses the matched rule's box and service", () => {
    const plan = planShipment(input({ rules: [rule("Small parcels", { presetId: "box", carrierService: "ups_ground" })] }));
    expect(plan.rule).toEqual({ id: "Small parcels", name: "Small parcels" });
    expect(plan.box.preset?.id).toBe("box");
    expect(plan.service).toEqual({ kind: "service", serviceId: "ups_ground", connectionId: "c-ups", source: "rule" });
    expect(shipBoxReason(plan)).toBe("Rule: Small parcels");
    expect(shipServiceReason(plan)).toBe("Rule: Small parcels");
  });

  it("lets what the bench picked win over the rule", () => {
    const plan = planShipment(
      input({
        rules: [rule("Small parcels", { presetId: "box", carrierService: "ups_ground" })],
        picked: { presetId: "mailer", carrierService: "ups_2day" },
      }),
    );
    expect(plan.box).toMatchObject({ preset: mailer, source: "picked" });
    expect(plan.service).toEqual({ kind: "service", serviceId: "ups_2day", connectionId: "c-ups", source: "picked" });
  });

  it("keeps a service already on the order ahead of the building default, but behind a rule", () => {
    const order = { ...input().order, carrierService: "ups_2day", carrierConnectionId: "c-ups" };
    expect(planShipment(input({ order })).service).toMatchObject({ serviceId: "ups_2day", source: "order" });
    expect(planShipment(input({ order, rules: [rule("r", { carrierService: "ups_ground" })] })).service).toMatchObject({
      serviceId: "ups_ground",
      source: "rule",
    });
    const stale = { ...order, carrierService: "fedex_ground", carrierConnectionId: null };
    expect(planShipment(input({ order: stale })).service).toMatchObject({ serviceId: "usps_priority", source: "default" });
  });

  it("hands a rule's rate choice or the building's to rate shopping", () => {
    expect(planShipment(input({ rules: [rule("r", { rateStrategy: "cheapest" })] })).service).toEqual({
      kind: "strategy",
      strategy: "cheapest",
      source: "rule",
    });
    expect(planShipment(input({ buildingStrategy: "fastest" })).service).toEqual({ kind: "strategy", strategy: "fastest", source: "building" });
    expect(planShipment(input({ buildingStrategy: "fastest", rules: [rule("r", { rateStrategy: "default" })] })).service).toMatchObject({
      serviceId: "usps_priority",
      source: "rule",
    });
  });

  it("holds the order but still shows what it would ship with", () => {
    const plan = planShipment(input({ rules: [rule("Big orders", { hold: true, presetId: "box" })] }));
    expect(plan.hold).toBe(true);
    expect(plan.box.preset?.id).toBe("box");
    expect(holdMessage(plan)).toMatch(/Big orders/);
  });

  it("flags a rule whose service is no longer offered instead of swapping services", () => {
    const plan = planShipment(input({ rules: [rule("DHL", { carrierService: "dhl_express" })] }));
    expect(plan.service).toEqual({ kind: "none" });
    expect(plan.problem).toMatch(/DHL/);
  });

  it("falls through to the default box when the rule's box is gone", () => {
    const plan = planShipment(input({ rules: [rule("r", { presetId: "gone", hold: true })] }));
    expect(plan.box).toMatchObject({ preset: mailer, source: "default" });
  });

  it("picks the first non-Rackline service when the building has no default", () => {
    expect(planShipment(input({ buildingDefault: null })).service).toMatchObject({ serviceId: "ups_ground", connectionId: "c-ups" });
    expect(planShipment(input({ buildingDefault: null, connections: [] })).service).toMatchObject({ serviceId: "rackline_ground" });
  });
});

describe("automatic box", () => {
  const sized = (sides: [number, number, number], weightOz = 12): ShipPlanInput["order"] => ({
    warehouseId: "w1",
    source: "shopify",
    lines: [{ sku: "LAMP", qty: 1, shipWeightOz: weightOz, shipLengthIn: sides[0], shipWidthIn: sides[1], shipHeightIn: sides[2] }],
  });

  it("packs in the smallest box the items fit when no rule or pick names one", () => {
    const flat = planShipment(input({ order: sized([9, 7, 1]) }));
    expect(flat.box).toEqual({ preset: mailer, source: "auto", note: null, tooBig: false });
    expect(shipBoxReason(flat)).toBe("Auto");
    expect(planShipment(input({ order: sized([11, 11, 6]) })).box).toMatchObject({ preset: box, source: "auto" });
  });

  it("keeps a rule's box and a picked box ahead of the automatic one", () => {
    expect(planShipment(input({ order: sized([9, 7, 1]), rules: [rule("r", { presetId: "box" })] })).box).toMatchObject({
      preset: box,
      source: "rule",
    });
    expect(planShipment(input({ order: sized([11, 11, 6]), picked: { presetId: "mailer" } })).box).toMatchObject({
      preset: mailer,
      source: "picked",
    });
  });

  it("falls back to the default box, flagged, when nothing fits", () => {
    expect(planShipment(input({ order: sized([30, 20, 4]) })).box).toEqual({
      preset: mailer,
      source: "default",
      note: "Too big for every box",
      tooBig: true,
    });
    expect(planShipment(input({ order: sized([30, 20, 4]), presets: [mailer] })).box).toMatchObject({ note: "Too big for Mailer", tooBig: true });
  });

  it("names SKUs with no ship size only when there is a box to choose", () => {
    expect(planShipment(input({ presets: [mailer] })).box).toEqual({ preset: mailer, source: "default", note: null, tooBig: false });
    const lines = ["A", "B", "C"].map((sku) => ({ sku, qty: 1 }));
    expect(planShipment(input({ order: { ...input().order, lines } })).box.note).toBe("No ship size on A, B and 1 more");
  });

  it("checks a typed or scale weight against a box's max weight", () => {
    const capped = { ...mailer, maxWeightOz: 16 };
    expect(planShipment(input({ order: sized([9, 7, 1]), presets: [capped, box] })).box.preset?.id).toBe("mailer");
    expect(planShipment(input({ order: { ...sized([9, 7, 1]), weightOz: 20 }, presets: [capped, box] })).box.preset?.id).toBe("box");
  });
});

describe("ship reasons", () => {
  it("prefixes a rule's rate choice with the rule", () => {
    const plan = planShipment(input({ rules: [rule("Intl", { rateStrategy: "cheapest" })] }));
    expect(shipServiceReason(plan)).toBe("Rule: Intl · Cheapest");
    expect(shipServiceReason(plan, "On time by Oct 5")).toBe("Rule: Intl · On time by Oct 5");
  });

  it("summarizes the box and service for the order", () => {
    expect(shipReasonSummary({ boxName: "Mailer", boxReason: "Auto", serviceName: "UPS Ground", serviceReason: "Cheapest" })).toBe(
      "Mailer (Auto) · UPS Ground (Cheapest)",
    );
    expect(shipReasonSummary({ boxName: null, boxReason: null, serviceName: "UPS Ground", serviceReason: null })).toBe("UPS Ground");
    expect(shipReasonSummary({ boxName: null, boxReason: null, serviceName: null, serviceReason: null })).toBeNull();
  });
});
