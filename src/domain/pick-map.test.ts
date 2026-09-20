import { describe, expect, it } from "vitest";
import { buildPickMapStops, pickMapLocationIds, pickMapMarkers } from "./pick-map";

const a0101 = {
  id: "a0101",
  code: "A-01-01",
  aisle: "A",
  rack: "01",
  bay: "01",
  level: 1,
};
const a0101l2 = {
  id: "a0101l2",
  code: "A-01-01-2",
  aisle: "A",
  rack: "01",
  bay: "01",
  level: 2,
};
const a0102 = {
  id: "a0102",
  code: "A-01-02",
  aisle: "A",
  rack: "01",
  bay: "02",
  level: 1,
};
const b0101 = {
  id: "b0101",
  code: "B-01-01",
  aisle: "B",
  rack: "01",
  bay: "01",
  level: 1,
};

describe("buildPickMapStops", () => {
  it("skips picked lines", () => {
    const plan = buildPickMapStops(
      [
        { lineId: "l1", sku: "LAMP", remaining: 0, suggestedLocation: { locationId: "b0101", locationCode: "B-01-01" } },
        { lineId: "l2", sku: "SHADE", remaining: 2, suggestedLocation: { locationId: "a0102", locationCode: "A-01-02" } },
      ],
      [a0102, b0101],
    );
    expect(plan.stops.map((stop) => stop.locationCode)).toEqual(["A-01-02"]);
    expect(plan.stops[0]?.skus).toEqual([{ lineId: "l2", sku: "SHADE", qty: 2 }]);
  });

  it("uses suggested bays when there are no allocations", () => {
    const plan = buildPickMapStops(
      [{ lineId: "l1", sku: "LAMP", remaining: 3, suggestedLocation: { locationId: "b0101", locationCode: "B-01-01" } }],
      [b0101],
    );
    expect(plan.stops).toHaveLength(1);
    expect(plan.stops[0]).toMatchObject({ step: 1, locationId: "b0101", label: "LAMP", qty: 3 });
  });

  it("splits a line across allocated bays and ignores the suggestion", () => {
    const plan = buildPickMapStops(
      [
        {
          lineId: "l1",
          sku: "LAMP",
          remaining: 5,
          suggestedLocation: { locationId: "b0101", locationCode: "B-01-01" },
          allocations: [
            { locationId: "a0102", locationCode: "A-01-02", qty: 3 },
            { locationId: "b0101", locationCode: "B-01-01", qty: 2 },
            { locationId: "skip", locationCode: "SKIP", qty: 0 },
          ],
        },
      ],
      [a0102, b0101],
    );
    expect(plan.stops.map((stop) => `${stop.locationCode}:${stop.qty}`)).toEqual(["A-01-02:3", "B-01-01:2"]);
    expect(plan.stops.every((stop) => stop.label === "LAMP")).toBe(true);
  });

  it("groups several SKUs onto one stop", () => {
    const plan = buildPickMapStops(
      [
        { lineId: "l1", sku: "LAMP", remaining: 1, suggestedLocation: { locationId: "a0102", locationCode: "A-01-02" } },
        { lineId: "l2", sku: "SHADE", remaining: 4, suggestedLocation: { locationId: "a0102", locationCode: "A-01-02" } },
      ],
      [a0102],
    );
    expect(plan.stops).toHaveLength(1);
    expect(plan.stops[0]?.label).toBe("LAMP, SHADE");
    expect(plan.stops[0]?.qty).toBe(5);
    expect(pickMapLocationIds(plan.stops)).toEqual(["a0102"]);
    expect(pickMapMarkers(plan.stops)).toEqual([{ locationId: "a0102", step: 1, label: "LAMP, SHADE" }]);
  });

  it("walks aisle, rack, bay, then level", () => {
    const plan = buildPickMapStops(
      [
        { lineId: "l1", sku: "LAMP", remaining: 1, suggestedLocation: { locationId: "b0101", locationCode: "B-01-01" } },
        { lineId: "l2", sku: "SHADE", remaining: 1, suggestedLocation: { locationId: "a0101l2", locationCode: "A-01-01-2" } },
        { lineId: "l3", sku: "BASE", remaining: 1, suggestedLocation: { locationId: "a0102", locationCode: "A-01-02" } },
        { lineId: "l4", sku: "BULB", remaining: 1, suggestedLocation: { locationId: "a0101", locationCode: "A-01-01" } },
      ],
      [a0101, a0101l2, a0102, b0101],
    );
    expect(plan.stops.map((stop) => stop.locationCode)).toEqual(["A-01-01", "A-01-01-2", "A-01-02", "B-01-01"]);
    expect(plan.stops.map((stop) => stop.step)).toEqual([1, 2, 3, 4]);
  });

  it("keeps remaining lines without a bay off the map", () => {
    const plan = buildPickMapStops(
      [
        { lineId: "l1", sku: "LAMP", remaining: 2 },
        { lineId: "l2", sku: "SHADE", remaining: 1, suggestedLocation: { locationId: "a0102", locationCode: "A-01-02" } },
      ],
      [a0102],
    );
    expect(plan.stops.map((stop) => stop.locationCode)).toEqual(["A-01-02"]);
    expect(plan.unlocated).toEqual([{ lineId: "l1", sku: "LAMP", remaining: 2 }]);
  });
});
