import { describe, expect, it } from "vitest";
import { PLAN_NOTE, PLANS } from "./plans";

describe("plans", () => {
  it("prices Garage at $150 with no trial, Shop with the entry WMS cluster, and Manufacturer under a 3PL WMS", () => {
    expect(PLANS.map((plan) => [plan.id, plan.price])).toEqual([
      ["garage", 150],
      ["shop", 349],
      ["manufacturer", 799],
    ]);
    expect(PLANS.find((plan) => plan.mostPopular)?.id).toBe("shop");
    expect(PLANS[0]?.cap).toBeNull();
    expect(PLANS[0]?.cta).toBe("Open Garage");
    expect(PLAN_NOTE).not.toMatch(/trial/);
    expect(PLAN_NOTE).toMatch(/\$150/);
    expect(PLAN_NOTE).toMatch(/does not charge/);
  });
});