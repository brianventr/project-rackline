import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_IDS,
  SAMPLE_SUFFIX,
  buildSampleCatalog,
  evaluateOnboarding,
  isSampleName,
  nextOnboardingStep,
  onboardingCountLabel,
  onboardingProgress,
  onboardingStepMeta,
  stockSignal,
  type OnboardingStepId,
} from "./onboarding";
import { garageAllowsPath } from "./operating-mode";

const ZERO: Record<OnboardingStepId, number> = {
  sku: 0,
  bays: 0,
  stock: 0,
  shipped: 0,
  shopify: 0,
  carrier: 0,
  teammate: 0,
};

describe("onboarding steps", () => {
  it("lists the required steps first, then the optional owner-only extras", () => {
    expect(ONBOARDING_STEP_IDS).toEqual(["sku", "bays", "stock", "shipped", "shopify", "carrier", "teammate"]);
    expect(ONBOARDING_STEPS.filter((step) => !step.optional).map((step) => step.id)).toEqual([
      "sku",
      "bays",
      "stock",
      "shipped",
    ]);
    for (const step of ONBOARDING_STEPS) {
      expect(step.ownerOnly).toBe(step.optional);
    }
  });

  it("points every step at a page Garage Mode can open", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(garageAllowsPath(step.path), step.path).toBe(true);
    }
  });

  it("writes plain copy with no exclamation marks", () => {
    for (const step of ONBOARDING_STEPS) {
      for (const text of [step.title, step.body, step.cta]) {
        expect(text).not.toMatch(/!/);
        expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
      }
    }
  });

  it("finds a step's meta by id", () => {
    expect(onboardingStepMeta("carrier").title).toBe("Connect a carrier");
  });
});

describe("evaluateOnboarding", () => {
  it("marks nothing done for a brand-new org", () => {
    const steps = evaluateOnboarding(ZERO);
    expect(steps.map((step) => step.id)).toEqual(ONBOARDING_STEP_IDS);
    expect(steps.every((step) => !step.done)).toBe(true);
  });

  it("needs one of each thing, but a second member for a teammate", () => {
    const steps = evaluateOnboarding({ ...ZERO, sku: 4, bays: 5, stock: 1, shipped: 2, shopify: 1, carrier: 1, teammate: 1 });
    const done = Object.fromEntries(steps.map((step) => [step.id, step.done]));
    expect(done).toEqual({
      sku: true,
      bays: true,
      stock: true,
      shipped: true,
      shopify: true,
      carrier: true,
      teammate: false,
    });
    expect(evaluateOnboarding({ ...ZERO, teammate: 2 }).find((step) => step.id === "teammate")?.done).toBe(true);
  });

  it("keeps the counts and reads junk as zero", () => {
    const steps = evaluateOnboarding({
      ...ZERO,
      sku: 3,
      bays: -2,
      stock: Number.NaN,
      shipped: 1.8,
      shopify: undefined as unknown as number,
    });
    expect(steps.find((step) => step.id === "sku")).toEqual({ id: "sku", done: true, count: 3 });
    expect(steps.find((step) => step.id === "bays")).toEqual({ id: "bays", done: false, count: 0 });
    expect(steps.find((step) => step.id === "stock")).toEqual({ id: "stock", done: false, count: 0 });
    expect(steps.find((step) => step.id === "shipped")).toEqual({ id: "shipped", done: true, count: 1 });
    expect(steps.find((step) => step.id === "shopify")).toEqual({ id: "shopify", done: false, count: 0 });
  });
});

describe("onboardingProgress", () => {
  const withMeta = (counts: Partial<Record<OnboardingStepId, number>>) =>
    evaluateOnboarding({ ...ZERO, ...counts }).map((step) => ({
      ...step,
      optional: onboardingStepMeta(step.id).optional,
    }));

  it("counts required steps only", () => {
    expect(onboardingProgress(withMeta({}))).toEqual({ done: 0, total: 4, complete: false });
    expect(onboardingProgress(withMeta({ sku: 1, bays: 1, shopify: 1 }))).toEqual({ done: 2, total: 4, complete: false });
  });

  it("completes once every required step is done, whatever the optional ones say", () => {
    expect(onboardingProgress(withMeta({ sku: 1, bays: 1, stock: 1, shipped: 1 }))).toEqual({
      done: 4,
      total: 4,
      complete: true,
    });
  });

  it("treats steps without an optional flag as required", () => {
    expect(onboardingProgress([{ done: true }, { done: false }])).toEqual({ done: 1, total: 2, complete: false });
  });

  it("does not call an empty list complete", () => {
    expect(onboardingProgress([])).toEqual({ done: 0, total: 0, complete: false });
    expect(onboardingProgress([{ done: false, optional: true }]).complete).toBe(false);
  });
});

describe("nextOnboardingStep", () => {
  it("nudges the first required step that is not done", () => {
    expect(
      nextOnboardingStep([
        { id: "sku", done: true },
        { id: "bays", done: false },
        { id: "stock", done: false },
        { id: "shopify", done: false, optional: true },
      ]),
    ).toBe("bays");
  });

  it("falls back to optional steps that were not skipped, then to nothing", () => {
    expect(
      nextOnboardingStep([
        { id: "sku", done: true },
        { id: "shopify", done: false, optional: true, skipped: true },
        { id: "carrier", done: false, optional: true },
      ]),
    ).toBe("carrier");
    expect(nextOnboardingStep([{ id: "sku", done: true }, { id: "teammate", done: false, optional: true, skipped: true }])).toBe(
      null,
    );
  });
});

describe("stockSignal", () => {
  it("is positive when stock is on a shelf or something was received for real", () => {
    expect(stockSignal(0, 0)).toBe(0);
    expect(stockSignal(3, 0)).toBe(3);
    expect(stockSignal(0, 2)).toBe(2);
    expect(stockSignal(5, 9)).toBe(5);
    expect(stockSignal(-1, Number.NaN)).toBe(0);
  });
});

describe("onboardingCountLabel", () => {
  it("says what a done step counted", () => {
    expect(onboardingCountLabel("sku", 1)).toBe("1 SKU");
    expect(onboardingCountLabel("sku", 4)).toBe("4 SKUs");
    expect(onboardingCountLabel("bays", 5)).toBe("5 bays");
    expect(onboardingCountLabel("stock", 7)).toBe("Stock received");
    // Received and since shipped: nothing on a shelf, so the note must not claim there is.
    expect(onboardingCountLabel("stock", stockSignal(0, 1))).toBe("Stock received");
    expect(onboardingCountLabel("shipped", 1)).toBe("1 order shipped");
    expect(onboardingCountLabel("shipped", 3)).toBe("3 orders shipped");
    expect(onboardingCountLabel("shopify", 1)).toBe("Connected");
    expect(onboardingCountLabel("carrier", 2)).toBe("Connected");
    expect(onboardingCountLabel("teammate", 3)).toBe("3 people");
  });

  it("says nothing when there is nothing to count", () => {
    expect(onboardingCountLabel("sku", 0)).toBeNull();
    expect(onboardingCountLabel("teammate", 1)).toBeNull();
    expect(onboardingCountLabel("carrier", 0)).toBeNull();
  });
});

describe("buildSampleCatalog", () => {
  const catalog = buildSampleCatalog();

  it("builds a dock, three storage bays with a pick face, and a shipping bay", () => {
    expect(catalog.locations.map((row) => [row.code, row.type, row.slotRole])).toEqual([
      ["DOCK", "receiving", "none"],
      ["A-01-01", "storage", "pick"],
      ["A-01-02", "storage", "bulk"],
      ["A-01-03", "storage", "none"],
      ["SHIP", "shipping", "none"],
    ]);
    for (const row of catalog.locations.filter((loc) => loc.type === "storage")) {
      expect(row.code).toBe(`${row.aisle}-${row.rack}-${row.bay}`);
    }
  });

  it("builds four SKUs with one finished good", () => {
    expect(catalog.items.map((row) => [row.sku, row.type])).toEqual([
      ["CANDLE", "finished"],
      ["JAR", "raw"],
      ["WICK", "raw"],
      ["WAX", "raw"],
    ]);
  });

  it("labels every name as sample", () => {
    for (const row of [...catalog.locations, ...catalog.items]) {
      expect(row.name.endsWith(` ${SAMPLE_SUFFIX}`), row.name).toBe(true);
      expect(isSampleName(row.name)).toBe(true);
    }
    expect(isSampleName("Glass jar")).toBe(false);
  });

  it("keeps codes and SKUs unique and upper case, as the catalog routes store them", () => {
    const codes = catalog.locations.map((row) => row.code);
    const skus = catalog.items.map((row) => row.sku);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(skus).size).toBe(skus.length);
    for (const value of [...codes, ...skus]) expect(value).toBe(value.toUpperCase());
  });

  it("builds the finished good from every other SKU, with numbered steps", () => {
    const keys = new Set(catalog.items.map((row) => row.key));
    const parent = catalog.items.find((row) => row.key === catalog.bom.parentKey);
    expect(parent?.type).toBe("finished");
    expect(catalog.bom.lines.map((line) => line.itemKey).sort()).toEqual(
      catalog.items.filter((row) => row.key !== catalog.bom.parentKey).map((row) => row.key).sort(),
    );
    for (const line of catalog.bom.lines) {
      expect(keys.has(line.itemKey)).toBe(true);
      expect(line.itemKey).not.toBe(catalog.bom.parentKey);
      expect(Number.isInteger(line.qty) && line.qty > 0).toBe(true);
    }
    expect(catalog.bom.steps.map((step) => step.seq)).toEqual([1, 2, 3]);
    const componentKeys = new Set(catalog.bom.lines.map((line) => line.itemKey));
    for (const step of catalog.bom.steps) {
      if (step.componentKey) expect(componentKeys.has(step.componentKey)).toBe(true);
    }
  });

  it("returns a fresh copy each time", () => {
    const again = buildSampleCatalog();
    again.items[0]!.name = "changed";
    expect(buildSampleCatalog().items[0]!.name).toBe(`Soy candle ${SAMPLE_SUFFIX}`);
  });
});
