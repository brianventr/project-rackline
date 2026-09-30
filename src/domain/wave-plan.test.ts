import { describe, expect, it } from "vitest";
import {
  ANY_CARRIER,
  carrierPickup,
  cutoffFor,
  cutoffsFromInput,
  parseCarrierCutoffs,
  planWaves,
  type WavePlanOrder,
} from "./wave-plan";

const TZ = "America/New_York";
// Tue 2026-09-29 10:00 in New York (14:00 UTC).
const NOW = Date.UTC(2026, 8, 29, 14, 0);
const at = (hour: number, minute = 0, dayOffset = 0) => Date.UTC(2026, 8, 29 + dayOffset, hour + 4, minute);

function order(partial: Partial<WavePlanOrder> & { id: string }): WavePlanOrder {
  return {
    number: partial.id.toUpperCase(),
    clientId: null,
    carrier: "UPS",
    zoneIds: ["z1"],
    units: 1,
    promise: { code: "leaves_today", promisedAt: at(15), reason: "" },
    ...partial,
  };
}

describe("carrier cutoffs", () => {
  it("parses stored JSON and editor input", () => {
    expect(parseCarrierCutoffs('{"UPS":1020,"bad":"x","USPS":2000}')).toEqual({ UPS: 1020 });
    expect(parseCarrierCutoffs("not json")).toEqual({});
    expect(cutoffsFromInput({ UPS: "17:00", USPS: "", [ANY_CARRIER]: "14:30" })).toEqual({ UPS: 1020, "*": 870 });
    expect(() => cutoffsFromInput({ UPS: "5pm" })).toThrow(/HH:MM/);
  });

  it("falls back from carrier to any-carrier to 3 PM", () => {
    expect(cutoffFor({ UPS: 1020 }, "UPS")).toBe(1020);
    expect(cutoffFor({ "*": 840 }, "FedEx")).toBe(840);
    expect(cutoffFor({}, null)).toBe(900);
  });

  it("uses the carrier's pickup on the promised day, rolling a missed one forward", () => {
    expect(carrierPickup(at(15), 17 * 60, NOW, TZ)).toEqual({ at: at(17), missed: false });
    expect(carrierPickup(at(15), 9 * 60, NOW, TZ)).toEqual({ at: at(9, 0, 1), missed: true });
    expect(carrierPickup(at(15, 0, 1), 17 * 60, NOW, TZ)).toEqual({ at: at(17, 0, 1), missed: false });
    expect(carrierPickup(null, 12 * 60, NOW, TZ)).toEqual({ at: at(12), missed: false });
  });
});

describe("planWaves", () => {
  it("groups by pickup, zone, and client, earliest cutoff first", () => {
    const plan = planWaves({
      now: NOW,
      timeZone: TZ,
      cutoffs: { UPS: 17 * 60, USPS: 11 * 60 },
      orders: [
        order({ id: "a", units: 2 }),
        order({ id: "b", units: 3 }),
        order({ id: "c", carrier: "USPS" }),
        order({ id: "d", zoneIds: ["z2"] }),
        order({ id: "e", clientId: "acme" }),
        order({ id: "f", zoneIds: ["z1", "z2"] }),
      ],
    });
    expect(plan.groups.map((g) => g.orderIds)).toEqual([["c"], ["a", "b"], ["f"], ["e"], ["d"]]);
    expect(plan.groups[0]).toMatchObject({ carrier: "USPS", urgency: "now", minutesLeft: 60, cutoffLabel: "11:00 AM" });
    expect(plan.groups[1]).toMatchObject({ zoneId: "z1", units: 5, urgency: "today" });
    expect(plan.groups.find((g) => g.orderIds[0] === "f")!.zoneId).toBeNull();
    expect(plan.groups.find((g) => g.orderIds[0] === "e")!.clientId).toBe("acme");
  });

  it("keeps short and inbound orders off the plan", () => {
    const plan = planWaves({
      now: NOW,
      timeZone: TZ,
      cutoffs: {},
      orders: [
        order({ id: "a" }),
        order({ id: "b", promise: { code: "short", promisedAt: null, reason: "LAMP is short 2" } }),
        order({ id: "c", promise: { code: "inbound", promisedAt: at(15, 0, 2), reason: "Waiting on PO-1" } }),
      ],
    });
    expect(plan.groups.flatMap((g) => g.orderIds)).toEqual(["a"]);
    expect(plan.waiting.map((w) => w.reason)).toEqual(["LAMP is short 2", "Waiting on PO-1"]);
  });

  it("flags a pickup the promise already missed", () => {
    const plan = planWaves({ now: NOW, timeZone: TZ, cutoffs: { UPS: 9 * 60 }, orders: [order({ id: "a" })] });
    expect(plan.groups[0]).toMatchObject({ urgency: "missed", missedToday: true });
  });
});
