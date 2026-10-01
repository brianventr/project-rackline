import { describe, expect, it } from "vitest";
import { DAY_MS } from "./runway";
import {
  decideRestock,
  defaultTransitDays,
  freightEta,
  learnedTransitDays,
  restockGap,
  restockLead,
  TRANSIT_LEARN_SAMPLES,
} from "./restock";

const day = DAY_MS;

describe("restockLead", () => {
  it("keeps the existing lead when the vendor has no lane", () => {
    expect(
      restockLead({
        laneSet: false,
        makeDays: 40,
        transitMode: "ocean",
        transitDays: 35,
        learnedTransitDays: 40,
        learnedSamples: 5,
        legacyLeadDays: 7,
      }),
    ).toEqual({ makeDays: 7, transitDays: 0, leadDays: 7, learned: false });
  });

  it("adds make days and ocean days past the 60-day runway cap", () => {
    const lead = restockLead({
      laneSet: true,
      makeDays: 40,
      transitMode: "ocean",
      transitDays: null,
      learnedTransitDays: null,
      learnedSamples: 0,
      legacyLeadDays: 7,
    });
    expect(lead.transitDays).toBe(defaultTransitDays("ocean"));
    expect(lead.leadDays).toBe(75);
    expect(lead.learned).toBe(false);
  });

  it("uses the learned transit median once enough containers have arrived", () => {
    const lead = restockLead({
      laneSet: true,
      makeDays: 20,
      transitMode: "ocean",
      transitDays: 35,
      learnedTransitDays: 48,
      learnedSamples: TRANSIT_LEARN_SAMPLES,
      legacyLeadDays: 7,
    });
    expect(lead.learned).toBe(true);
    expect(lead.transitDays).toBe(48);
    expect(lead.leadDays).toBe(68);
  });

  it("caps a very long lane at 180 days", () => {
    expect(
      restockLead({
        laneSet: true,
        makeDays: 200,
        transitMode: "ocean",
        transitDays: 50,
        learnedTransitDays: null,
        learnedSamples: 0,
        legacyLeadDays: 7,
      }).leadDays,
    ).toBe(180);
  });
});

describe("learnedTransitDays", () => {
  it("returns the median of positive samples", () => {
    expect(learnedTransitDays([30, 10, 50, 0, -1])).toEqual({ days: 30, count: 3 });
    expect(learnedTransitDays([])).toEqual({ days: null, count: 0 });
  });
});

describe("freightEta", () => {
  const base = { makeDays: 30, transitDays: 35, fallbackAt: 1_000 };

  it("prefers an entered expected date, then ETA", () => {
    expect(freightEta({ ...base, expectedAt: 50, eta: 40, departedAt: 10 }).source).toBe("entered");
    expect(freightEta({ ...base, expectedAt: 50, eta: 40 }).at).toBe(50);
    expect(freightEta({ ...base, eta: 40 }).at).toBe(40);
  });

  it("counts transit from departure, and make plus transit from the order", () => {
    expect(freightEta({ ...base, departedAt: 10 * day }).at).toBe(10 * day + 35 * day);
    expect(freightEta({ ...base, orderedAt: 2 * day }).at).toBe(2 * day + 65 * day);
    expect(freightEta(base)).toEqual({ at: 1_000, source: "scheduled" });
  });
});

describe("decideRestock", () => {
  const asOf = Date.UTC(2026, 0, 1);

  it("is due when cover runs out before the lead time, and not when a PO already covers it", () => {
    const due = decideRestock({
      asOf,
      rate: 10,
      sellable: 100,
      inbound: [],
      leadDays: 75,
      covered: false,
    });
    expect(due.due).toBe(true);
    expect(due.suggestedQty).toBeGreaterThan(0);
    expect(due.orderByAt).not.toBeNull();
    expect(due.orderByAt!).toBeLessThanOrEqual(asOf);

    expect(
      decideRestock({ asOf, rate: 10, sellable: 100, inbound: [], leadDays: 75, covered: true }).due,
    ).toBe(false);
  });

  it("is not due when on-hand covers the lead time and the buffer", () => {
    const decision = decideRestock({
      asOf,
      rate: 1,
      sellable: 200,
      inbound: [],
      leadDays: 40,
      bufferDays: 14,
      covered: false,
    });
    expect(decision.due).toBe(false);
    expect(decision.suggestedQty).toBe(0);
  });

  it("counts inbound that arrives before the stockout", () => {
    const bare = decideRestock({ asOf, rate: 10, sellable: 50, inbound: [], leadDays: 30, covered: false });
    const covered = decideRestock({
      asOf,
      rate: 10,
      sellable: 50,
      inbound: [{ at: asOf + 2 * day, qty: 5_000 }],
      leadDays: 30,
      covered: false,
    });
    expect(bare.due).toBe(true);
    expect(covered.suggestedQty).toBe(0);
    expect(covered.due).toBe(false);
  });
});

describe("restockGap", () => {
  it("names the longer part of the wait", () => {
    expect(restockGap(40, 35)).toBe("make");
    expect(restockGap(10, 35)).toBe("transit");
  });
});
