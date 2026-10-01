import { describe, expect, it } from "vitest";
import {
  binUsage,
  capacityAmount,
  capacityBreaches,
  capacityFromForm,
  CapacityInputError,
  capacityOverrideSummary,
  capacityPatch,
  capacityText,
  capacityToForm,
  eachMeasure,
  fillPercent,
  fillsBay,
  fillTone,
  hasCapacity,
  LocationFullError,
  locationFullSentence,
  overCapacity,
  parseCapacityLimit,
  roomFor,
  unmeasuredItems,
  usageText,
  type BinCapacity,
  type EachMeasure,
} from "./capacity";

const none: BinCapacity = { maxQty: null, maxWeightOz: null, maxVolumeCuIn: null };
const sixty: BinCapacity = { ...none, maxQty: 60 };

const measures = new Map<string, EachMeasure>([
  ["bulb", { weightOz: 2, volumeCuIn: 18.75 }],
  ["resin", { weightOz: 400 / 6, volumeCuIn: 1760 / 6 }],
  ["shade", { weightOz: null, volumeCuIn: null }],
]);

describe("eachMeasure", () => {
  it("uses the item's own ship weight and size", () => {
    expect(eachMeasure({ shipWeightOz: 12, shipLengthIn: 4, shipWidthIn: 5, shipHeightIn: 6 })).toEqual({
      weightOz: 12,
      volumeCuIn: 120,
    });
  });

  it("falls back to the smallest pack that has a weight or size, split across its eaches", () => {
    const packs = [
      { qty: 24, weightOz: 52, lengthIn: 12, widthIn: 10, heightIn: 8 },
      { qty: 4, weightOz: 8, lengthIn: 5, widthIn: 5, heightIn: 3 },
    ];
    expect(eachMeasure({}, packs)).toEqual({ weightOz: 2, volumeCuIn: 18.75 });
    expect(eachMeasure({}, [{ ...packs[1]!, weightOz: null }, packs[0]!])).toEqual({ weightOz: 52 / 24, volumeCuIn: 18.75 });
  });

  it("mixes the item's weight with a pack's size", () => {
    expect(eachMeasure({ shipWeightOz: 3 }, [{ qty: 6, weightOz: 400, lengthIn: 16, widthIn: 11, heightIn: 10 }])).toEqual({
      weightOz: 3,
      volumeCuIn: 1760 / 6,
    });
  });

  it("needs all three dimensions for a volume", () => {
    expect(eachMeasure({ shipLengthIn: 4, shipWidthIn: 5 })).toEqual({ weightOz: null, volumeCuIn: null });
    expect(eachMeasure({ shipWeightOz: 0 })).toEqual({ weightOz: null, volumeCuIn: null });
  });
});

describe("binUsage", () => {
  it("sums units, weight, and volume; items with no measure add only units", () => {
    expect(
      binUsage(
        [
          { itemId: "bulb", qty: 10 },
          { itemId: "shade", qty: 3 },
          { itemId: "gone", qty: 0 },
        ],
        measures,
      ),
    ).toEqual({ qty: 13, weightOz: 20, volumeCuIn: 187.5 });
  });

  it("names the items a weight or volume limit cannot see", () => {
    const rows = [
      { itemId: "bulb", qty: 10 },
      { itemId: "shade", qty: 3 },
    ];
    expect(unmeasuredItems(sixty, rows, measures)).toEqual([]);
    expect(unmeasuredItems({ ...none, maxWeightOz: 100 }, rows, measures)).toEqual(["shade"]);
  });
});

describe("overCapacity", () => {
  const before = { qty: 50, weightOz: 100, volumeCuIn: 0 };

  it("refuses growth past a set limit", () => {
    expect(overCapacity(sixty, before, { ...before, qty: 72 })).toEqual({ measure: "qty", limit: 60, before: 50, after: 72 });
    expect(overCapacity({ ...none, maxWeightOz: 160 }, before, { ...before, weightOz: 170 })).toMatchObject({ measure: "weight" });
  });

  it("allows filling exactly to the limit, and ignores unset limits", () => {
    expect(overCapacity(sixty, before, { ...before, qty: 60 })).toBeNull();
    expect(overCapacity(none, before, { ...before, qty: 5000 })).toBeNull();
    expect(overCapacity({ ...none, maxWeightOz: 400 }, { ...before, weightOz: 0 }, { ...before, weightOz: 6 * (400 / 6) })).toBeNull();
  });

  it("lets a bay that is already over give stock up, or stay where it is", () => {
    const over = { qty: 80, weightOz: 0, volumeCuIn: 0 };
    expect(overCapacity(sixty, over, { ...over, qty: 70 })).toBeNull();
    expect(overCapacity(sixty, over, over)).toBeNull();
    expect(overCapacity(sixty, over, { ...over, qty: 81 })).toMatchObject({ after: 81 });
  });
});

describe("fillPercent and roomFor", () => {
  it("reports the tightest set limit as a whole percent", () => {
    const capacity = { maxQty: 100, maxWeightOz: 1000, maxVolumeCuIn: null };
    expect(fillPercent(capacity, { qty: 40, weightOz: 900, volumeCuIn: 99999 })).toBe(90);
    expect(fillPercent(capacity, { qty: 100, weightOz: 0, volumeCuIn: 0 })).toBe(100);
    expect(fillPercent(capacity, { qty: 99.6, weightOz: 0, volumeCuIn: 0 })).toBe(99);
    expect(fillPercent(none, { qty: 40, weightOz: 0, volumeCuIn: 0 })).toBeNull();
  });

  it("counts the eaches that still fit", () => {
    const capacity = { maxQty: 60, maxWeightOz: 1600, maxVolumeCuIn: null };
    const usage = { qty: 20, weightOz: 1000, volumeCuIn: 0 };
    expect(roomFor(capacity, usage, { weightOz: 2, volumeCuIn: 10 })).toBe(40);
    expect(roomFor(capacity, usage, { weightOz: 400 / 6, volumeCuIn: 10 })).toBe(9);
    expect(roomFor(capacity, { ...usage, qty: 70 }, { weightOz: 2, volumeCuIn: 10 })).toBe(0);
    expect(roomFor({ ...none, maxWeightOz: 1600 }, usage, { weightOz: null, volumeCuIn: null })).toBe(Infinity);
    expect(roomFor(none, usage, { weightOz: 2, volumeCuIn: 1 })).toBe(Infinity);
  });

  it("tones a bay nearly full from 85% and full from 100%", () => {
    expect([0, 84, 85, 99, 100, 140].map(fillTone)).toEqual(["ok", "ok", "near", "near", "full", "full"]);
  });
});

describe("fillsBay", () => {
  it("checks receives and moves into a bay, not counts, builds, unpicks, or dekits", () => {
    expect(fillsBay({ type: "receive", refType: "receipt", toLocationId: "a" })).toBe(true);
    expect(fillsBay({ type: "move", refType: "transfer", toLocationId: "a" })).toBe(true);
    expect(fillsBay({ type: "receive", refType: "kit", toLocationId: "a" })).toBe(false);
    expect(fillsBay({ type: "adjust", refType: "adjustment", toLocationId: "a" })).toBe(false);
    expect(fillsBay({ type: "wo_produce", refType: "work_order", toLocationId: "a" })).toBe(false);
    expect(fillsBay({ type: "unpick", refType: "order", toLocationId: "a" })).toBe(false);
    expect(fillsBay({ type: "pick", refType: "order", toLocationId: null })).toBe(false);
  });
});

describe("capacityBreaches", () => {
  const bay = { id: "a0102", code: "A-01-02", ...sixty };
  const stock = [
    { locationId: "a0102", itemId: "bulb", qty: 40 },
    { locationId: "a0102", itemId: "shade", qty: 10 },
    { locationId: "b0101", itemId: "bulb", qty: 500 },
  ];

  it("compares every SKU in the bay before and after the plan", () => {
    expect(
      capacityBreaches({ locations: [bay], stock, planned: [{ locationId: "a0102", itemId: "bulb", qty: 62 }], measures }),
    ).toEqual([{ locationId: "a0102", locationCode: "A-01-02", breach: { measure: "qty", limit: 60, before: 50, after: 72 } }]);
  });

  it("nets a swap inside the bay, and a new SKU arriving counts", () => {
    const planned = [
      { locationId: "a0102", itemId: "bulb", qty: 30 },
      { locationId: "a0102", itemId: "resin", qty: 20 },
    ];
    expect(capacityBreaches({ locations: [bay], stock, planned, measures })).toEqual([]);
    expect(
      capacityBreaches({ locations: [bay], stock, planned: [...planned, { locationId: "a0102", itemId: "cord", qty: 1 }], measures }),
    ).toHaveLength(1);
  });

  it("skips bays with no limits", () => {
    const planned = [{ locationId: "a0102", itemId: "bulb", qty: 1000 }];
    expect(capacityBreaches({ locations: [{ ...bay, ...none }], stock, planned, measures })).toEqual([]);
  });
});

describe("copy", () => {
  it("says what the bay would hold and its limit", () => {
    expect(locationFullSentence("A-01-02", { measure: "qty", limit: 60, after: 72 })).toBe(
      "A-01-02 would hold 72 units, over its limit of 60 units.",
    );
    expect(locationFullSentence("A-01-02", { measure: "weight", limit: 4000, after: 4800 })).toBe(
      "A-01-02 would weigh 300 lb, over its limit of 250 lb.",
    );
    expect(locationFullSentence("A-01-02", { measure: "volume", limit: 17280, after: 21600 })).toBe(
      "A-01-02 would fill 12.5 cu ft, over its limit of 10 cu ft.",
    );
    expect(capacityAmount("qty", 1)).toBe("1 unit");
  });

  it("puts the fix in the error text", () => {
    const err = new LocationFullError("A-01-02", { measure: "qty", limit: 60, before: 50, after: 72 });
    expect(err.message).toBe(
      "A-01-02 would hold 72 units, over its limit of 60 units. Put the rest in another bay, or an owner can override.",
    );
    expect(err.message).not.toMatch(/!/);
  });

  it("summarizes an override for the audit log", () => {
    expect(capacityOverrideSummary("A-01-02", { measure: "qty", limit: 60, before: 50, after: 72 })).toBe(
      "A-01-02 filled past its limit by an owner: 72 units, limit 60 units",
    );
  });

  it("lists set limits and usage", () => {
    const capacity = { maxQty: 60, maxWeightOz: 4000, maxVolumeCuIn: null };
    expect(capacityText(capacity)).toBe("60 units · 250 lb");
    expect(capacityText(none)).toBeNull();
    expect(usageText(capacity, { qty: 40, weightOz: 1920, volumeCuIn: 5 })).toBe("40 of 60 units · 120 of 250 lb");
    expect(hasCapacity(capacity)).toBe(true);
    expect(hasCapacity(none)).toBe(false);
    expect(hasCapacity(null)).toBe(false);
  });
});

describe("input", () => {
  it("parses API limits in stored units; 0, blank, and null clear", () => {
    expect(parseCapacityLimit(undefined, "Max units")).toBeUndefined();
    expect(parseCapacityLimit(null, "Max units")).toBeNull();
    expect(parseCapacityLimit("", "Max units")).toBeNull();
    expect(parseCapacityLimit(0, "Max units")).toBeNull();
    expect(parseCapacityLimit("60", "Max units")).toBe(60);
    expect(() => parseCapacityLimit(2.5, "Max units")).toThrow("Max units must be a whole number, 0 or more");
    expect(() => parseCapacityLimit(-1, "Max units")).toThrow(CapacityInputError);
    expect(() => parseCapacityLimit(5_000_000_000, "Max units")).toThrow("Max units is too large");
  });

  it("returns only the limits the body names", () => {
    expect(capacityPatch({ maxQty: 60, name: "x" })).toEqual({ maxQty: 60 });
    expect(capacityPatch({ maxWeightOz: null, maxVolumeCuIn: 1728 })).toEqual({ maxWeightOz: null, maxVolumeCuIn: 1728 });
    expect(capacityPatch({})).toEqual({});
  });

  it("converts the editor's lb and cu ft to stored oz and cubic inches, and back", () => {
    expect(capacityFromForm({ maxQty: "60", maxWeightLb: "250", maxVolumeCuFt: "2.5" })).toEqual({
      maxQty: 60,
      maxWeightOz: 4000,
      maxVolumeCuIn: 4320,
    });
    expect(capacityFromForm({ maxQty: "", maxWeightLb: "0", maxVolumeCuFt: " " })).toEqual(none);
    expect(() => capacityFromForm({ maxQty: "1.5", maxWeightLb: "", maxVolumeCuFt: "" })).toThrow(
      "Max units must be a whole number, 0 or more",
    );
    expect(() => capacityFromForm({ maxQty: "", maxWeightLb: "heavy", maxVolumeCuFt: "" })).toThrow(
      "Max weight must be a number, 0 or more",
    );
    for (const stored of [{ maxQty: 7, maxWeightOz: 100, maxVolumeCuIn: 1000 }, { maxQty: null, maxWeightOz: 1, maxVolumeCuIn: 1 }]) {
      expect(capacityFromForm(capacityToForm(stored))).toEqual(stored);
    }
  });
});
