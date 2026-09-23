import { describe, expect, it } from "vitest";
import type { TargetLocation } from "@/domain/rack-targets";
import { locateDetailPath, planTargets } from "./locate";

const recv: TargetLocation = { id: "recv", code: "RECV", type: "receiving", aisle: null, rack: null, bay: null, level: 1 };
const a0101: TargetLocation = {
  id: "a0101",
  code: "A-01-01",
  type: "storage",
  slotRole: "bulk",
  aisle: "A",
  rack: "01",
  bay: "01",
  level: 1,
  contents: [{ itemId: "shade", sku: "SHADE", qty: 10 }],
};
const a0202: TargetLocation = { id: "a0202", code: "A-02-02", type: "storage", aisle: "A", rack: "02", bay: "02", level: 1 };
const locations = [recv, a0101, a0202];

describe("locateDetailPath", () => {
  it("reads the document only when the lines matter", () => {
    expect(locateDetailPath({ kind: "receive", path: "/api/receipts/r1", dockId: null })).toBe("/api/receipts/r1");
    expect(locateDetailPath({ kind: "bays", path: "/api/transfers/t1", bays: [] })).toBe("/api/transfers/t1");
    expect(locateDetailPath({ kind: "bays", path: "/api/transfers/t1", items: [], bays: [] })).toBeNull();
    expect(locateDetailPath({ kind: "onHand", itemId: "shade", sku: "SHADE" })).toBeNull();
    expect(locateDetailPath(null)).toBeNull();
  });
});

describe("planTargets", () => {
  it("sends a receipt's open lines from the dock to their putaway bay", () => {
    const plan = planTargets(
      { kind: "receive", path: "/api/receipts/r1", dockId: "recv" },
      {
        lines: [
          { itemId: "shade", sku: "SHADE", qty: 6, remaining: 6 },
          { itemId: "shade", sku: "SHADE", qty: 2, remaining: 0 },
        ],
      },
      locations,
    );
    expect(plan.targets.map((row) => [row.locationId, row.verb, row.primary, row.items])).toEqual([
      ["recv", "Receive into", false, [{ sku: "SHADE", qty: 6 }]],
      ["a0101", "Put away to", true, [{ sku: "SHADE", qty: 6 }]],
    ]);
  });

  it("labels named bays with the document's remaining lines", () => {
    const plan = planTargets(
      {
        kind: "bays",
        path: "/api/transfers/t1",
        bays: [
          { locationId: "a0101", role: "from", verb: "Take from" },
          { locationId: "a0202", role: "to", verb: "Put away to" },
          { locationId: null, role: "to", verb: "Put away to" },
        ],
      },
      { lines: [{ itemId: "shade", sku: "SHADE", qty: 8, remaining: 3 }] },
      locations,
    );
    expect(plan.targets.map((row) => [row.locationId, row.primary, row.items])).toEqual([
      ["a0101", false, [{ sku: "SHADE", qty: 3 }]],
      ["a0202", true, [{ sku: "SHADE", qty: 3 }]],
    ]);
  });

  it("points an order at the bays its remaining lines pick from", () => {
    const plan = planTargets(
      { kind: "pick", path: "/api/orders/o1" },
      {
        lines: [
          {
            id: "l1",
            itemId: "shade",
            sku: "SHADE",
            qty: 4,
            qtyPicked: 1,
            suggestedLocation: { locationId: "a0101", locationCode: "A-01-01", locationName: "", barcode: "", qty: 10 },
          },
        ],
      },
      locations,
    );
    expect(plan.targets).toEqual([
      { locationId: "a0101", role: "from", verb: "Pick from", items: [{ sku: "SHADE", qty: 3 }], primary: true },
    ]);
  });
});
