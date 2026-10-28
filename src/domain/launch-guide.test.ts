import { describe, expect, it } from "vitest";
import { ONBOARDING_STEP_IDS } from "./onboarding";
import {
  FULFILLMENT_LAUNCH_CHECKS,
  SETUP_REQUIREMENTS,
  WALKTHROUGHS,
  estimateLaunchCapacity,
  requirementTier,
  type LaunchProfile,
} from "./launch-guide";

describe("launch setup guidance", () => {
  it("keeps basic stock work usable without a store, extra staff, production, or warehouse power tools", () => {
    const basic = SETUP_REQUIREMENTS.filter((row) => requirementTier(row, "core") === "essential").map((row) => row.id);
    expect(basic).toEqual(expect.arrayContaining(["building", "locations", "labels", "catalog", "stock", "practice"]));
    for (const conditional of ["team", "store", "postage", "serials", "returns", "recipes"]) {
      expect(basic).not.toContain(conditional);
    }
    expect(basic).not.toContain("waves");
  });

  it("promotes the prerequisites for a chosen business without changing generic or advanced requirements", () => {
    const tier = (id: string, profile: LaunchProfile) => requirementTier(SETUP_REQUIREMENTS.find((row) => row.id === id)!, profile);
    expect(tier("recipes", "manufacturing")).toBe("essential");
    expect(tier("recipes", "fulfillment")).toBe("conditional");
    for (const id of ["team", "store", "postage", "serials", "returns", "clients", "launch-plan"]) {
      expect(tier(id, "fulfillment")).toBe("essential");
    }
    for (const profile of ["core", "manufacturing", "fulfillment"] as const) {
      expect(tier("building", profile)).toBe("essential");
      expect(tier("waves", profile)).toBe("advanced");
    }
  });

  it("resolves every requirement to a complete walkthrough and an existing progress signal", () => {
    expect(new Set(SETUP_REQUIREMENTS.map((row) => row.id)).size).toBe(SETUP_REQUIREMENTS.length);
    expect(new Set(WALKTHROUGHS.map((row) => row.id)).size).toBe(WALKTHROUGHS.length);
    for (const item of SETUP_REQUIREMENTS) {
      expect(WALKTHROUGHS.find((walkthrough) => walkthrough.id === item.walkthroughId)?.steps.length).toBeGreaterThan(0);
      if (item.signal) expect(ONBOARDING_STEP_IDS).toContain(item.signal);
      expect(item.when.trim()).not.toBe("");
      expect(item.why.trim()).not.toBe("");
    }
  });

  it("uses local navigation links so guides cannot send a user to an external action", () => {
    const paths = [
      ...SETUP_REQUIREMENTS.map((row) => row.path),
      ...WALKTHROUGHS.flatMap((row) => row.steps.map((step) => step.path)),
      ...FULFILLMENT_LAUNCH_CHECKS.map((row) => row.path),
    ].filter((path): path is string => Boolean(path));
    for (const path of paths) {
      expect(path).toMatch(/^\/(?!\/)/);
      expect(path).not.toContain("/api/");
    }
  });
});

describe("launch workload planning", () => {
  it("uses explicitly supplied operating days and leaves staffing unknown without a measured rate", () => {
    expect(estimateLaunchCapacity({ minimumOrders: 1500, maximumOrders: 2500, operatingDays: 10, ordersPerPersonPerDay: null }))
      .toEqual({ dailyMinimum: 150, dailyMaximum: 250, peopleMinimum: null, peopleMaximum: null });
    expect(estimateLaunchCapacity({ minimumOrders: 1500, maximumOrders: 2500, operatingDays: 14, ordersPerPersonPerDay: null }))
      .toEqual({ dailyMinimum: 108, dailyMaximum: 179, peopleMinimum: null, peopleMaximum: null });
  });

  it("calculates people from unrounded work per day rather than rounding the workload twice", () => {
    expect(estimateLaunchCapacity({ minimumOrders: 10, maximumOrders: 21, operatingDays: 3, ordersPerPersonPerDay: 3.5 }))
      .toEqual({ dailyMinimum: 4, dailyMaximum: 7, peopleMinimum: 1, peopleMaximum: 2 });
  });

  it("refuses unusable counts, day assumptions, and unmeasured or invalid rate numbers", () => {
    const valid = { minimumOrders: 1500, maximumOrders: 2500, operatingDays: 10, ordersPerPersonPerDay: null };
    for (const minimumOrders of [0, -1, 0.5, 1.25, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => estimateLaunchCapacity({ ...valid, minimumOrders })).toThrow(/positive minimum/i);
    }
    for (const maximumOrders of [0, -1, 0.5, 1.25, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => estimateLaunchCapacity({ ...valid, maximumOrders })).toThrow(/positive maximum/i);
    }
    expect(() => estimateLaunchCapacity({ ...valid, minimumOrders: 2501 })).toThrow(/at least the minimum/i);
    for (const operatingDays of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => estimateLaunchCapacity({ ...valid, operatingDays })).toThrow(/whole operating day/i);
    }
    for (const ordersPerPersonPerDay of [0, -1, NaN, Infinity]) {
      expect(() => estimateLaunchCapacity({ ...valid, ordersPerPersonPerDay })).toThrow(/positive measured/i);
    }
  });
});

describe("fulfillment readiness boundaries", () => {
  const check = (id: string) => FULFILLMENT_LAUNCH_CHECKS.find((row) => row.id === id)!;

  it("covers the requested receiving, order, visibility, serial, staffing, returns, carrier, and commercial obligations", () => {
    expect(new Set(FULFILLMENT_LAUNCH_CHECKS.map((row) => row.id)).size).toBe(FULFILLMENT_LAUNCH_CHECKS.length);
    expect(FULFILLMENT_LAUNCH_CHECKS.map((row) => row.id)).toEqual(expect.arrayContaining([
      "container", "shopify", "visibility", "serial", "staffing", "returns", "fedex", "rates", "insurance",
    ]));
    for (const row of FULFILLMENT_LAUNCH_CHECKS) {
      expect(row.requirement.trim()).not.toBe("");
      expect(row.verify.trim()).not.toBe("");
      expect(row.limitation?.trim()).not.toBe("");
    }
  });

  it("does not advertise strict serial completeness or client-isolated API access that does not exist", () => {
    expect(check("serial").support).toBe("partial");
    expect(check("serial").limitation).toMatch(/empty serial list is not fully blocked/i);
    expect(check("visibility").support).toBe("partial");
    expect(check("visibility").limitation).toMatch(/organization-scoped/i);
    expect(check("visibility").limitation).toMatch(/on-hand rather than sellable/i);
    expect(check("returns").limitation).toMatch(/optional today/i);
  });

  it("directs serial verification to the actual single-match UI and identifies the full-manifest gap", () => {
    const guide = WALKTHROUGHS.find((row) => row.id === "serial-multibox")!;
    const lookup = guide.steps.find((step) => step.actionLabel === "Open return lookup")!;
    expect(lookup.path).toBe("/outbound/returns");
    expect(lookup.body).toMatch(/Find a return/);
    expect(lookup.body).toMatch(/only the first match/i);
    expect(lookup.body).toMatch(/complete serial-by-order manifest.*still need a report or integration/i);
    expect(check("serial").path).toBe("/outbound/returns");
    expect(check("serial").limitation).toMatch(/UI has no full serial-by-order manifest/i);
  });

  it("keeps staffing, insurance, and rate agreements outside automatic software readiness", () => {
    for (const id of ["staffing", "insurance", "rates"]) {
      expect(check(id).support).toBe("external");
      expect(check(id).scope).not.toBe("software");
    }
    expect(check("container").support).toBe("partial");
    expect(check("container").limitation).toMatch(/does not prove/i);
    expect(check("fedex").limitation).toMatch(/no-markup/i);
  });

  it("makes a paid label purchase explicit and distinguishes demo output from postage", () => {
    const serialGuide = WALKTHROUGHS.find((row) => row.id === "serial-multibox")!;
    const body = serialGuide.steps.map((step) => step.body).join(" ");
    expect(body).toMatch(/Demo output is not paid postage/i);
    expect(body).toMatch(/never purchases automatically/i);
    expect(check("fedex").verify).toMatch(/separate deliberate action/i);
  });
});
