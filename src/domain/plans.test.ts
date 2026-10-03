import { describe, expect, it } from "vitest";
import { GARAGE_FREE_ORDERS, PLAN_NOTE, PLANS } from "./plans";

describe("plans", () => {
  it("prices Garage free, Shop under a phone WMS, and Manufacturer at that WMS", () => {
    expect(PLANS.map((plan) => [plan.id, plan.price])).toEqual([
      ["garage", 0],
      ["shop", 79],
      ["manufacturer", 179],
    ]);
    expect(PLANS.find((plan) => plan.mostPopular)?.id).toBe("shop");
    expect(GARAGE_FREE_ORDERS).toBe(50);
    expect(PLANS[0]?.cap).toContain("50");
    expect(PLAN_NOTE).toMatch(/does not charge/);
  });
});