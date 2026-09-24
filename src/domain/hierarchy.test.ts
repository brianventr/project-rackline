import { describe, expect, it } from "vitest";
import {
  HIERARCHY_GROUPS,
  HIERARCHY_LEVELS,
  binCodeParts,
  binKindLabel,
  buildHierarchyTree,
  describeHierarchy,
  formatBinAddress,
  hierarchyLevel,
  hierarchyLevelsIn,
  hierarchyPathFor,
  parseBinCode,
  slotRoleLabel,
  summarizeHierarchy,
  type HierarchyLocation,
  type HierarchyNode,
} from "./hierarchy";
import { glossaryEntry } from "./glossary";
import { garageAllowsPath } from "./operating-mode";

describe("hierarchy levels", () => {
  it("reads top to bottom: where, then what, then how", () => {
    expect(HIERARCHY_LEVELS.map((level) => level.id)).toEqual([
      "organization",
      "warehouse",
      "area",
      "aisle",
      "rack",
      "bay",
      "level",
      "bin",
      "sku",
      "on-hand",
      "overlay",
      "document",
      "movement",
      "job",
    ]);
    const groupOrder = HIERARCHY_GROUPS.map((group) => group.id);
    const seen = HIERARCHY_LEVELS.map((level) => groupOrder.indexOf(level.group));
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("puts every level in a known group and every group has levels", () => {
    const groups = new Set(HIERARCHY_GROUPS.map((group) => group.id));
    for (const level of HIERARCHY_LEVELS) expect(groups.has(level.group)).toBe(true);
    for (const group of HIERARCHY_GROUPS) expect(hierarchyLevelsIn(group.id).length).toBeGreaterThan(0);
  });

  it("writes plain copy with no exclamation marks and a real example", () => {
    for (const level of HIERARCHY_LEVELS) {
      for (const text of [level.title, level.short, level.long]) {
        expect(text, level.id).not.toMatch(/!/);
        expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
      }
      expect(level.example.trim().length, level.id).toBeGreaterThan(0);
    }
  });

  it("only names glossary terms that exist", () => {
    for (const level of HIERARCHY_LEVELS) {
      if (level.term) expect(glossaryEntry(level.term), `${level.id} → ${level.term}`).toBeDefined();
    }
  });

  it("finds a level by id", () => {
    expect(hierarchyLevel("bin").example).toBe("A-01-02-2");
  });

  it("gates pages by role and Garage Mode", () => {
    const owner = { role: "owner", garage: false };
    const operator = { role: "operator", garage: false };
    const garageOwner = { role: "owner", garage: true };
    expect(hierarchyPathFor(hierarchyLevel("warehouse"), owner)).toBe("/setup/warehouse");
    expect(hierarchyPathFor(hierarchyLevel("warehouse"), operator)).toBeNull();
    expect(hierarchyPathFor(hierarchyLevel("bin"), operator)).toBe("/stock/locations");
    for (const level of HIERARCHY_LEVELS) {
      const path = hierarchyPathFor(level, garageOwner);
      if (path) expect(garageAllowsPath(path), level.id).toBe(true);
    }
  });
});

describe("parseBinCode", () => {
  it("reads aisle, rack, bay, and level", () => {
    expect(parseBinCode("A-01-02-2")).toEqual({ aisle: "A", rack: "01", bay: "02", level: 2 });
  });

  it("treats a missing level as level 1 and normalises padding and case", () => {
    expect(parseBinCode("a-1-2")).toEqual({ aisle: "A", rack: "01", bay: "02", level: 1 });
    expect(parseBinCode(" B-03-11 ")).toEqual({ aisle: "B", rack: "03", bay: "11", level: 1 });
  });

  it("returns null for docks, benches, outbound bays, and junk", () => {
    for (const code of ["DOCK", "SHIP", "SHIP-2", "RECV", "", "A-", "A-01", "A-01-02-0", "1-01-02", "A-01-02-2-3"]) {
      expect(parseBinCode(code), code).toBeNull();
    }
  });

  it("splits a code into labelled parts, marking an implied level 1", () => {
    expect(binCodeParts({ aisle: "A", rack: "01", bay: "02", level: 2 })).toEqual([
      { id: "aisle", label: "Aisle", value: "A", implied: false },
      { id: "rack", label: "Rack", value: "01", implied: false },
      { id: "bay", label: "Bay", value: "02", implied: false },
      { id: "level", label: "Level", value: "2", implied: false },
    ]);
    expect(binCodeParts({ aisle: "A", rack: "01", bay: "02", level: 1 })[3]).toEqual({
      id: "level",
      label: "Level",
      value: "1",
      implied: true,
    });
  });

  it("formats the address the way the map does", () => {
    expect(formatBinAddress({ aisle: "A", rack: "01", bay: "02", level: 2 })).toBe("Aisle A / rack 01 / bay 02 / level 2");
    expect(formatBinAddress({ aisle: "A", rack: "01", bay: "02", level: 1 })).toBe("Aisle A / rack 01 / bay 02");
  });
});

const FLOOR: HierarchyLocation[] = [
  { id: "s", code: "SHIP", name: "Shipping bay", type: "shipping", area: "Outbound", level: 1 },
  { id: "a0102", code: "A-01-02", type: "storage", area: "Aisle A", aisle: "A", rack: "01", bay: "02", level: 1, slotRole: "pick" },
  { id: "a0101", code: "A-01-01", type: "storage", area: "Aisle A", aisle: "A", rack: "01", bay: "01", level: 1, slotRole: "pick" },
  { id: "a0101l2", code: "A-01-01-2", type: "storage", area: "Aisle A", aisle: "A", rack: "01", bay: "01", level: 2, slotRole: "bulk" },
  { id: "a0201", code: "A-02-01", type: "storage", area: "Aisle A", aisle: "A", rack: "02", bay: "01", level: 1 },
  { id: "d", code: "DOCK", name: "Receiving dock", type: "receiving", area: "Dock", level: 1 },
  { id: "p", code: "BENCH", name: "Assembly bench", type: "production", area: "Shop", level: 1 },
  { id: "loose", code: "OVERFLOW", name: "Overflow shelf", type: "storage", area: "Storage", level: 1 },
];

function labels(node: HierarchyNode): string[] {
  return node.children.map((child) => child.label);
}

describe("buildHierarchyTree", () => {
  const tree = buildHierarchyTree("Main warehouse", FLOOR);

  it("roots at the warehouse with every bin counted once", () => {
    expect(tree.kind).toBe("warehouse");
    expect(tree.label).toBe("Main warehouse");
    expect(tree.count).toBe(FLOOR.length);
  });

  it("orders areas as stock flows: dock, aisles, loose storage, bench, outbound", () => {
    expect(labels(tree)).toEqual(["Dock", "Aisle A", "Storage", "Shop", "Outbound"]);
    expect(tree.children.map((area) => area.note)).toEqual(["Dock", "Storage", "Storage", "Bench", "Outbound"]);
  });

  it("nests aisle → rack → bay → level and sorts numerically", () => {
    const aisle = tree.children[1]!;
    expect(aisle.count).toBe(4);
    expect(labels(aisle)).toEqual(["Rack 01", "Rack 02"]);
    const rack = aisle.children[0]!;
    expect(rack.code).toBe("A-01");
    expect(labels(rack)).toEqual(["Bay 01", "Bay 02"]);
    const bay = rack.children[0]!;
    expect(bay.code).toBe("A-01-01");
    expect(bay.count).toBe(2);
    expect(bay.children.map((bin) => [bin.label, bin.code, bin.note])).toEqual([
      ["Level 1", "A-01-01", "Pick face"],
      ["Level 2", "A-01-01-2", "Bulk"],
    ]);
  });

  it("puts docks, benches, outbound bays, and loose storage straight under their area", () => {
    const dock = tree.children[0]!;
    expect(dock.children).toHaveLength(1);
    expect(dock.children[0]).toMatchObject({ kind: "bin", label: "Receiving dock", code: "DOCK", note: "Dock" });
    const storage = tree.children[2]!;
    expect(storage.children[0]).toMatchObject({ kind: "bin", label: "Overflow shelf", code: "OVERFLOW" });
    expect(storage.children[0]!.note).toBeUndefined();
  });

  it("derives an area name when none is stored, and works without ids (planned bins)", () => {
    const planned = buildHierarchyTree("Bench", [
      { code: "RECV", type: "receiving", level: 1 },
      { code: "B-01-01", type: "storage", aisle: "B", rack: "01", bay: "01", level: 1 },
    ]);
    expect(labels(planned)).toEqual(["Dock", "Aisle B"]);
    expect(planned.children[1]!.children[0]!.children[0]!.children[0]!.key).toBe("bin:B-01-01");
  });

  it("handles an empty floor", () => {
    const empty = buildHierarchyTree("Empty", []);
    expect(empty.count).toBe(0);
    expect(empty.children).toEqual([]);
  });
});

describe("summarizeHierarchy", () => {
  it("counts areas, racks, bays, bins, and roles", () => {
    expect(summarizeHierarchy(FLOOR)).toEqual({
      bins: 8,
      areas: 5,
      racks: 2,
      bays: 3,
      pickFaces: 2,
      bulk: 1,
      docks: 1,
      benches: 1,
      outbound: 1,
    });
  });

  it("describes the plan in one line, and says nothing for nothing", () => {
    expect(describeHierarchy(summarizeHierarchy(FLOOR))).toBe(
      "1 dock · 2 racks with 5 bins (2 pick faces, 1 bulk bay) · 1 bench · 1 outbound bay",
    );
    expect(describeHierarchy(summarizeHierarchy([]))).toBe("");
    expect(
      describeHierarchy(
        summarizeHierarchy([{ code: "A-01-01", type: "storage", aisle: "A", rack: "01", bay: "01", level: 1 }]),
      ),
    ).toBe("1 rack with 1 bin");
  });
});

describe("labels", () => {
  it("uses plain words for bin types and slot roles", () => {
    expect(["receiving", "storage", "production", "shipping"].map(binKindLabel)).toEqual(["Dock", "Storage", "Bench", "Outbound"]);
    expect(binKindLabel("mezzanine")).toBe("Mezzanine");
    expect(slotRoleLabel("pick")).toBe("Pick face");
    expect(slotRoleLabel("bulk")).toBe("Bulk");
    expect(slotRoleLabel("none")).toBeNull();
    expect(slotRoleLabel(undefined)).toBeNull();
  });
});
