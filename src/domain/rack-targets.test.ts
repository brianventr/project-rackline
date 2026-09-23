import { describe, expect, it } from "vitest";
import {
  binAddress,
  finalizeTargets,
  formatTargetItems,
  onHandTargets,
  pickTargets,
  rackFace,
  receiveTargets,
  type TargetLocation,
} from "./rack-targets";

function bin(id: string, aisle: string, rack: string, bay: string, level: number, extra: Partial<TargetLocation> = {}): TargetLocation {
  const code = `${aisle}-${rack}-${bay}${level > 1 ? `-${level}` : ""}`;
  return { id, code, type: "storage", slotRole: "bulk", aisle, rack, bay, level, contents: [], ...extra };
}

const recv: TargetLocation = {
  id: "recv",
  code: "RECV",
  name: "Receiving dock",
  type: "receiving",
  slotRole: "none",
  area: "Dock",
  aisle: null,
  rack: null,
  bay: null,
  level: 1,
  contents: [{ itemId: "resin", sku: "RESIN", qty: 3 }],
};

const a0101 = bin("a0101", "A", "01", "01", 1, { slotRole: "pick", contents: [{ itemId: "cord", sku: "CORD", qty: 25 }] });
const a0102 = bin("a0102", "A", "01", "02", 1);
const a0101l2 = bin("a0101l2", "A", "01", "01", 2, { contents: [{ itemId: "cord", sku: "CORD", qty: 40 }] });
const a0202 = bin("a0202", "A", "02", "02", 1);
const locations = [recv, a0101, a0101l2, a0102, a0202];

describe("receiveTargets", () => {
  it("lands on the dock and points each SKU at its directed putaway bay", () => {
    const plan = receiveTargets({
      dockId: "recv",
      lines: [{ itemId: "cord", sku: "CORD", qty: 15 }],
      locations,
    });
    expect(plan.targets).toEqual([
      { locationId: "recv", role: "from", verb: "Receive into", items: [{ sku: "CORD", qty: 15 }] },
      { locationId: "a0101l2", role: "to", verb: "Put away to", items: [{ sku: "CORD", qty: 15 }] },
    ]);
    expect(plan.unlocated).toEqual([]);
  });

  it("falls back to the first receiving bay when the document names none", () => {
    const plan = receiveTargets({ dockId: null, lines: [{ itemId: "cord", sku: "CORD", qty: 1 }], locations });
    expect(plan.targets[0]?.locationId).toBe("recv");
  });

  it("treats receiving straight into storage as the destination", () => {
    const plan = receiveTargets({ dockId: "a0102", lines: [{ itemId: "cord", sku: "CORD", qty: 4 }], locations });
    expect(plan.targets).toEqual([{ locationId: "a0102", role: "to", verb: "Receive into", items: [{ sku: "CORD", qty: 4 }] }]);
  });

  it("skips fully received lines and reports SKUs with nowhere to go", () => {
    const plan = receiveTargets({
      dockId: "recv",
      lines: [
        { itemId: "cord", sku: "CORD", qty: 0 },
        { itemId: "lamp", sku: "LAMP", qty: 2 },
      ],
      locations: [recv],
    });
    expect(plan.targets).toEqual([{ locationId: "recv", role: "from", verb: "Receive into", items: [{ sku: "LAMP", qty: 2 }] }]);
    expect(plan.unlocated).toEqual([{ sku: "LAMP", qty: 2 }]);
  });

  it("reports every line when the building has no dock", () => {
    const plan = receiveTargets({ dockId: null, lines: [{ itemId: "cord", sku: "CORD", qty: 2 }], locations: [a0101] });
    expect(plan).toEqual({ targets: [], unlocated: [{ sku: "CORD", qty: 2 }] });
  });
});

describe("pickTargets", () => {
  it("takes allocations before the suggested pick face", () => {
    const plan = pickTargets(
      [
        {
          lineId: "l1",
          sku: "CORD",
          remaining: 5,
          suggestedLocation: { locationId: "a0101", locationCode: "A-01-01" },
          allocations: [{ locationId: "a0101l2", locationCode: "A-01-01-2", qty: 5 }],
        },
        { lineId: "l2", sku: "SHADE", remaining: 2, suggestedLocation: null },
      ],
      locations,
    );
    expect(plan.targets).toEqual([{ locationId: "a0101l2", role: "from", verb: "Pick from", items: [{ sku: "CORD", qty: 5 }] }]);
    expect(plan.unlocated).toEqual([{ sku: "SHADE", qty: 2 }]);
  });
});

describe("onHandTargets", () => {
  it("lists every bay holding the SKU", () => {
    expect(onHandTargets("cord", "CORD", locations).targets.map((row) => [row.locationId, row.items[0]?.qty])).toEqual([
      ["a0101", 25],
      ["a0101l2", 40],
    ]);
  });

  it("marks a SKU with no stock as unlocated", () => {
    expect(onHandTargets("lamp", "LAMP", locations)).toEqual({ targets: [], unlocated: [{ sku: "LAMP", qty: 0 }] });
  });
});

describe("finalizeTargets", () => {
  it("puts the crosshair on the destination and keeps the origin secondary", () => {
    const targets = finalizeTargets(
      [
        { locationId: "a0202", role: "to", verb: "Put away to", items: [{ sku: "CORD", qty: 2 }] },
        { locationId: "a0101", role: "from", verb: "Take from", items: [{ sku: "CORD", qty: 2 }] },
      ],
      locations,
    );
    expect(targets.map((row) => [row.locationId, row.role, row.primary])).toEqual([
      ["a0101", "from", false],
      ["a0202", "to", true],
    ]);
  });

  it("targets the origin when the work has no destination", () => {
    const targets = finalizeTargets([{ locationId: "a0101", role: "from", verb: "Pick from", items: [] }], locations);
    expect(targets[0]?.primary).toBe(true);
  });

  it("merges repeat bays, sums SKUs, and drops bays off this map", () => {
    const targets = finalizeTargets(
      [
        { locationId: "a0102", role: "to", verb: "Put away to", items: [{ sku: "CORD", qty: 2 }] },
        { locationId: "a0102", role: "to", verb: "Put away to", items: [{ sku: "CORD", qty: 3 }, { sku: "LAMP", qty: 1 }] },
        { locationId: "elsewhere", role: "to", verb: "Put away to", items: [{ sku: "CORD", qty: 1 }] },
      ],
      locations,
    );
    expect(targets).toEqual([
      {
        locationId: "a0102",
        role: "to",
        verb: "Put away to",
        items: [
          { sku: "CORD", qty: 5 },
          { sku: "LAMP", qty: 1 },
        ],
        primary: true,
      },
    ]);
  });

  it("orders several destinations by address", () => {
    const targets = finalizeTargets(
      [
        { locationId: "a0202", role: "to", verb: "Put away to", items: [] },
        { locationId: "a0101l2", role: "to", verb: "Put away to", items: [] },
        { locationId: "a0101", role: "to", verb: "Put away to", items: [] },
      ],
      locations,
    );
    expect(targets.map((row) => row.locationId)).toEqual(["a0101", "a0101l2", "a0202"]);
  });
});

describe("binAddress", () => {
  it("spells out a rack bin", () => {
    expect(binAddress(a0101l2)).toBe("Aisle A · Rack 01 · Bay 01 · Level 2");
  });

  it("names an area by its name", () => {
    expect(binAddress(recv)).toBe("Receiving dock");
  });
});

describe("rackFace", () => {
  it("returns the bay × level grid for the bin's rack only", () => {
    const face = rackFace(locations, "a0101l2");
    expect(face).toMatchObject({ aisle: "A", rack: "01", bays: ["01", "02"], levels: [1, 2] });
    expect(face?.cells.map((cell) => [cell.code, cell.units])).toEqual([
      ["A-01-01", 25],
      ["A-01-01-2", 40],
      ["A-01-02", 0],
    ]);
  });

  it("sorts bays numerically", () => {
    const face = rackFace([bin("b10", "B", "01", "10", 1), bin("b2", "B", "01", "2", 1)], "b10");
    expect(face?.bays).toEqual(["02", "10"]);
  });

  it("has no face for a dock", () => {
    expect(rackFace(locations, "recv")).toBeNull();
  });
});

describe("formatTargetItems", () => {
  it("joins SKUs with their qty", () => {
    expect(formatTargetItems([{ sku: "CORD", qty: 2 }, { sku: "LAMP", qty: 0 }])).toBe("CORD × 2, LAMP");
  });
});
