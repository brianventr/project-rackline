import { describe, expect, it } from "vitest";
import { GARAGE_TRIAL_DAYS, PLAN_NOTE, PLANS } from "./plans";

describe("plans", () => {
  it("prices Garage after a 30-day trial, Shop with the entry WMS cluster, and Manufacturer under a 3PL WMS", () => {
    expect(PLANS.map((plan) => [plan.id, plan.price])).toEqual([
      ["garage", 150],
      ["shop", 349],
      ["manufacturer", 799],
    ]);
    expect(PLANS.find((plan) => plan.mostPopular)?.id).toBe("shop");
    expect(GARAGE_TRIAL_DAYS).toBe(30);
    expect(PLANS[0]?.cap).toBe("30-day free trial");
    expect(PLANS[0]?.price).toBeGreaterThan(0);
    expect(PLAN_NOTE).toMatch(/30-day/);
    expect(PLAN_NOTE).toMatch(/\$150/);
    expect(PLAN_NOTE).toMatch(/does not charge/);
  });
});