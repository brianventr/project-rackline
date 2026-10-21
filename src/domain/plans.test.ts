import { describe, expect, it } from "vitest";
import { GARAGE_FREE_ORDERS, PLAN_NOTE, PLANS } from "./plans";

describe("plans", () => {
  it("prices Garage free, Shop with the entry WMS cluster, and Manufacturer under a 3PL WMS", () => {
    expect(PLANS.map((plan) => [plan.id, plan.price])).toEqual([
      ["garage", 0],
      ["shop", 349],
      ["manufacturer", 799],
    ]);
    expect(PLANS.find((plan) => plan.mostPopular)?.id).toBe("shop");
    expect(GARAGE_FREE_ORDERS).toBe(50);
    expect(PLANS[0]?.cap).toContain("50");
    expect(PLAN_NOTE).toMatch(/does not charge/);
  });
});