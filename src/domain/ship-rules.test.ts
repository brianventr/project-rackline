import { describe, expect, it } from "vitest";
import {
  describeShipRuleConditions,
  matchShipRule,
  parseShipRuleConditions,
  parseShipRuleInput,
  reorderShipRules,
  shipRuleChannel,
  shipRuleFacts,
  shipRuleMatches,
  type ShipRule,
  type ShipRuleOrder,
} from "./ship-rules";

const order: ShipRuleOrder = {
  warehouseId: "w1",
  source: "shopify",
  shipToAddress: "120 Spring St\nLos Angeles, CA 90012",
  shipToRegion: "CA",
  shipToCountry: "US",
  lines: [
    { sku: "lamp", qty: 2, shipWeightOz: 20 },
    { sku: "SHADE", qty: 1, shipWeightOz: 6 },
  ],
};

function rule(id: string, patch: Partial<ShipRule> = {}): ShipRule {
  return {
    id,
    name: id,
    position: 1,
    enabled: true,
    warehouseId: null,
    conditions: {},
    presetId: "p1",
    carrierService: null,
    carrierConnectionId: null,
    rateStrategy: null,
    hold: false,
    ...patch,
  };
}

describe("ship rule facts", () => {
  it("reads SKUs, counts, weight, destination, and channel off the order", () => {
    const facts = shipRuleFacts(order);
    expect([...facts.skus]).toEqual(["LAMP", "SHADE"]);
    expect(facts).toMatchObject({ items: 2, units: 3, weightOz: 46, country: "US", region: "CA", postal: "90012", channel: "shopify" });
  });

  it("uses a typed weight, and leaves weight unknown when a SKU has none", () => {
    expect(shipRuleFacts({ ...order, weightOz: 30 }).weightOz).toBe(30);
    expect(shipRuleFacts({ ...order, lines: [{ sku: "A", qty: 1 }] }).weightOz).toBeNull();
  });

  it("parses the postal code and country out of the address when the columns are blank", () => {
    const facts = shipRuleFacts({ ...order, shipToRegion: null, shipToCountry: null, shipToAddress: "12 King Street West\nToronto, ON M5H 1A1" });
    expect(facts).toMatchObject({ country: "CA", region: "ON", postal: "M5H1A1" });
  });

  it("folds crowdfunding imports into one channel", () => {
    expect(shipRuleChannel("crowdfunding:kickstarter")).toBe("crowdfunding");
    expect(shipRuleChannel("")).toBe("manual");
    expect(shipRuleChannel("Etsy")).toBe("etsy");
  });
});

describe("ship rule matching", () => {
  const facts = shipRuleFacts(order);

  it("matches any SKU in the list, case-insensitively", () => {
    expect(shipRuleMatches({ skus: ["Lamp", "CORD"] }, facts)).toBe(true);
    expect(shipRuleMatches({ skus: ["CORD"] }, facts)).toBe(false);
  });

  it("treats weight, item, and unit bounds as inclusive", () => {
    expect(shipRuleMatches({ minWeightOz: 46, maxWeightOz: 46 }, facts)).toBe(true);
    expect(shipRuleMatches({ maxWeightOz: 45 }, facts)).toBe(false);
    expect(shipRuleMatches({ minItems: 2, maxUnits: 3 }, facts)).toBe(true);
    expect(shipRuleMatches({ maxItems: 1 }, facts)).toBe(false);
    expect(shipRuleMatches({ minUnits: 4 }, facts)).toBe(false);
  });

  it("never matches a weight condition when the weight is unknown", () => {
    const unknown = shipRuleFacts({ ...order, lines: [{ sku: "A", qty: 1 }] });
    expect(shipRuleMatches({ maxWeightOz: 1000 }, unknown)).toBe(false);
    expect(shipRuleMatches({ skus: ["A"] }, unknown)).toBe(true);
  });

  it("matches country, state, postal prefix, and channel", () => {
    expect(shipRuleMatches({ countries: ["US"], regions: ["CA", "OR"], postalPrefixes: ["900"], channels: ["shopify", "etsy"] }, facts)).toBe(true);
    expect(shipRuleMatches({ countries: ["CA"] }, facts)).toBe(false);
    expect(shipRuleMatches({ regions: ["NY"] }, facts)).toBe(false);
    expect(shipRuleMatches({ postalPrefixes: ["97"] }, facts)).toBe(false);
    expect(shipRuleMatches({ channels: ["etsy"] }, facts)).toBe(false);
  });

  it("matches every order when a rule has no conditions", () => {
    expect(shipRuleMatches({}, facts)).toBe(true);
  });

  it("picks the first enabled match top to bottom, in this building or every building", () => {
    const rules = [
      rule("heavy", { position: 3, conditions: { minWeightOz: 40 } }),
      rule("off", { position: 1, enabled: false }),
      rule("other-building", { position: 2, warehouseId: "w2" }),
      rule("catch-all", { position: 4 }),
    ];
    expect(matchShipRule(rules, order)?.id).toBe("heavy");
    expect(matchShipRule(rules, { ...order, lines: [{ sku: "A", qty: 1, shipWeightOz: 4 }] })?.id).toBe("catch-all");
    expect(matchShipRule(rules, { ...order, warehouseId: "w2" })?.id).toBe("other-building");
    expect(matchShipRule([rule("off", { enabled: false })], order)).toBeNull();
  });
});

describe("ship rule input", () => {
  it("cleans up lists, codes, and ranges", () => {
    const input = parseShipRuleInput({
      name: " Small parcels ",
      conditions: {
        skus: "lamp, shade\nlamp",
        maxWeightOz: "16",
        countries: ["United States", "ca"],
        regions: ["California", "ny"],
        postalPrefixes: ["m5h 1", "97"],
        channels: ["Shopify"],
      },
      presetId: "p1",
    });
    expect(input).toMatchObject({
      name: "Small parcels",
      enabled: true,
      warehouseId: null,
      presetId: "p1",
      carrierService: null,
      rateStrategy: null,
      hold: false,
      conditions: {
        skus: ["LAMP", "SHADE"],
        maxWeightOz: 16,
        countries: ["US", "CA"],
        regions: ["CA", "NY"],
        postalPrefixes: ["M5H1", "97"],
        channels: ["shopify"],
      },
    });
  });

  it("refuses rules that are unnamed, do nothing, or name a service and a rate choice", () => {
    expect(() => parseShipRuleInput({ name: " ", presetId: "p1" })).toThrow(/name/);
    expect(() => parseShipRuleInput({ name: "Nothing" })).toThrow(/something to do/);
    expect(() => parseShipRuleInput({ name: "Both", carrierService: "ups_ground", rateStrategy: "cheapest" })).toThrow(/not both/);
    expect(() => parseShipRuleInput({ name: "Odd", rateStrategy: "slowest" })).toThrow(/rate choice/);
    expect(() => parseShipRuleInput({ name: "Range", hold: true, conditions: { minUnits: 5, maxUnits: 2 } })).toThrow(/more than/);
    expect(() => parseShipRuleInput({ name: "Neg", hold: true, conditions: { minWeightOz: -1 } })).toThrow(/whole number/);
    expect(() => parseShipRuleInput({ name: "Where", hold: true, conditions: { countries: ["Atlantis"] } })).toThrow(/country/);
    expect(() => parseShipRuleInput({ name: "Chan", hold: true, conditions: { channels: ["ebay"] } })).toThrow(/channel/);
  });

  it("keeps a connection only alongside a service, and hold on its own is enough", () => {
    expect(parseShipRuleInput({ name: "Review", hold: true, carrierConnectionId: "c1" })).toMatchObject({
      hold: true,
      carrierConnectionId: null,
    });
    expect(parseShipRuleInput({ name: "UPS", carrierService: "ups_ground", carrierConnectionId: "c1" }).carrierConnectionId).toBe("c1");
  });

  it("reads stored conditions and drops malformed JSON", () => {
    expect(parseShipRuleConditions('{"skus":["a"],"maxUnits":2}')).toEqual({ skus: ["A"], maxUnits: 2 });
    expect(parseShipRuleConditions("not json")).toEqual({});
    expect(parseShipRuleConditions('{"minUnits":-3}')).toEqual({});
  });
});

describe("ship rule order and words", () => {
  it("renumbers the listed rules first, then the rest in their old order", () => {
    const rules = [
      { id: "a", position: 1 },
      { id: "b", position: 2 },
      { id: "c", position: 3 },
    ];
    expect(reorderShipRules(rules, ["c", "a"])).toEqual([
      { id: "c", position: 1 },
      { id: "a", position: 2 },
      { id: "b", position: 3 },
    ]);
    expect(reorderShipRules(rules, ["zzz"])).toEqual(rules);
  });

  it("describes conditions in plain words", () => {
    expect(describeShipRuleConditions({})).toEqual(["Every order"]);
    expect(
      describeShipRuleConditions({
        skus: ["LAMP", "SHADE", "CORD"],
        maxWeightOz: 16,
        minUnits: 2,
        countries: ["US"],
        postalPrefixes: ["97"],
        channels: ["etsy", "shopify"],
      }),
    ).toEqual(["SKU LAMP, SHADE, or CORD", "Weight up to 1 lb", "2 or more units", "To US", "Postal code starts 97", "From Etsy or Shopify"]);
    expect(describeShipRuleConditions({ minWeightOz: 20, maxWeightOz: 80, minItems: 1, maxItems: 1 })).toEqual([
      "Weight 1 lb 4 oz to 5 lb",
      "1 SKU",
    ]);
  });
});
