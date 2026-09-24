import { describe, expect, it } from "vitest";
import {
  SETUP_LIMITS,
  SETUP_STEPS,
  SETUP_STEP_IDS,
  defaultRackShape,
  defaultSetupInput,
  existingHierarchy,
  firstIssueStep,
  issuesForStep,
  nextSetupStep,
  normalizeCode,
  planSetup,
  plannedHierarchy,
  previewRackCodes,
  previousSetupStep,
  setupStep,
  stepIncluded,
  suggestAreaCode,
  type ExistingBin,
  type SetupInput,
} from "./setup-wizard";
import { buildHierarchyTree } from "./hierarchy";
import { expandRack, validateDrafts } from "./rack-builder";

const WAREHOUSE = { name: "Garage", timeZone: "UTC", mapWidth: 42, mapDepth: 28, mapHeight: 8 };

function bin(partial: Partial<ExistingBin> & { id: string; code: string; type: string }): ExistingBin {
  return {
    aisle: null,
    rack: null,
    bay: null,
    level: 1,
    posX: 0,
    posY: 0,
    posZ: 0,
    sizeX: 4,
    sizeY: 3,
    sizeZ: 2,
    ...partial,
  };
}

const DOCK = bin({ id: "d", code: "RECV", type: "receiving", posX: 2, posY: 1, sizeX: 16, sizeY: 4, sizeZ: 3 });
const RACK_A01: ExistingBin[] = expandRack({
  aisle: "A",
  rack: "01",
  posX: 2,
  posY: 7,
  rotation: 0,
  bays: 3,
  levels: 2,
  bayWidth: 3,
  bayDepth: 4,
  bayPitch: 4,
  levelHeight: 2,
}).map((draft, index) => ({ ...draft, id: `a${index}` }));

function fresh(garage = true): SetupInput {
  return defaultSetupInput({ warehouse: WAREHOUSE, existing: [], garage });
}

describe("steps", () => {
  it("runs in floor order and ends on review", () => {
    expect(SETUP_STEP_IDS).toEqual(["building", "dock", "racks", "bench", "ship", "review"]);
    expect(nextSetupStep("building")).toBe("dock");
    expect(nextSetupStep("review")).toBeNull();
    expect(previousSetupStep("building")).toBeNull();
    expect(previousSetupStep("review")).toBe("ship");
    expect(setupStep("racks").teaches).toBe("Aisle · rack · bay · level");
    for (const step of SETUP_STEPS) {
      expect(step.question.endsWith("?"), step.id).toBe(true);
      expect(step.title).not.toMatch(/!/);
    }
  });

  it("knows which steps add something", () => {
    const input = fresh();
    expect(SETUP_STEP_IDS.map((id) => stepIncluded(input, id))).toEqual([true, true, true, true, true, true]);
    expect(stepIncluded({ ...input, bench: { ...input.bench, include: false } }, "bench")).toBe(false);
  });
});

describe("defaultSetupInput", () => {
  it("starts an empty bench with everything switched on and friendly codes", () => {
    const input = fresh(true);
    expect(input.building).toEqual({ name: "Garage", timeZone: "UTC" });
    expect(input.dock).toEqual({ include: true, code: "DOCK", name: "Receiving dock" });
    expect(input.racks).toEqual({ include: true, aisle: "A", racks: 1, bays: 4, levels: 2, pickFaces: true });
    expect(input.bench).toEqual({ include: true, code: "BENCH", name: "Assembly bench" });
    expect(input.ship).toEqual({ include: true, code: "SHIP", name: "Shipping bay" });
  });

  it("gives a warehouse bigger shelves", () => {
    expect(defaultRackShape(false)).toEqual({ racks: 2, bays: 4, levels: 3 });
    expect(fresh(false).racks).toMatchObject({ racks: 2, bays: 4, levels: 3, pickFaces: true });
  });

  it("switches off steps whose bin already exists and continues the rack numbering", () => {
    const input = defaultSetupInput({ warehouse: WAREHOUSE, existing: [DOCK, ...RACK_A01], garage: true });
    expect(input.dock.include).toBe(false);
    expect(input.racks.include).toBe(false);
    expect(input.racks.aisle).toBe("A");
    expect(input.bench.include).toBe(true);
    expect(input.ship.include).toBe(true);
    expect(input.dock.code).toBe("DOCK");
  });

  it("falls back to the map builder's code when the friendly one is taken", () => {
    const taken = [bin({ id: "x", code: "DOCK", type: "receiving" })];
    expect(suggestAreaCode(taken, "receiving")).toBe("RECV");
    expect(suggestAreaCode([...taken, bin({ id: "y", code: "RECV", type: "receiving" })], "receiving")).toBe("RECV-2");
    expect(suggestAreaCode([], "shipping")).toBe("SHIP");
    expect(suggestAreaCode([], "production")).toBe("BENCH");
  });

  it("adopts the browser timezone while the building is still on UTC, and only then", () => {
    expect(defaultSetupInput({ warehouse: WAREHOUSE, existing: [], garage: true, browserTimeZone: "America/Chicago" }).building.timeZone).toBe(
      "America/Chicago",
    );
    expect(
      defaultSetupInput({
        warehouse: { ...WAREHOUSE, timeZone: "Europe/Berlin" },
        existing: [],
        garage: true,
        browserTimeZone: "America/Chicago",
      }).building.timeZone,
    ).toBe("Europe/Berlin");
    expect(defaultSetupInput({ warehouse: WAREHOUSE, existing: [], garage: true, browserTimeZone: "Mars/Olympus" }).building.timeZone).toBe(
      "UTC",
    );
  });
});

describe("planSetup on an empty bench", () => {
  const input = fresh(true);
  const plan = planSetup(input, { existing: [], warehouse: WAREHOUSE });

  it("has no issues and describes itself", () => {
    expect(plan.issues).toEqual([]);
    expect(plan.description).toBe("1 dock · 1 rack with 8 bins (4 pick faces, 4 bulk bays) · 1 bench · 1 outbound bay");
  });

  it("mints bins in floor order with the storage codes the map uses", () => {
    expect(plan.bins.map((row) => row.source)).toEqual(["dock", ...Array(8).fill("rack"), "bench", "ship"]);
    expect(plan.bins.filter((row) => row.source === "rack").map((row) => row.code)).toEqual([
      "A-01-01",
      "A-01-01-2",
      "A-01-02",
      "A-01-02-2",
      "A-01-03",
      "A-01-03-2",
      "A-01-04",
      "A-01-04-2",
    ]);
    expect(plan.bins[0]).toMatchObject({ code: "DOCK", type: "receiving", area: "Dock", slotRole: "none" });
    expect(plan.bins.at(-1)).toMatchObject({ code: "SHIP", type: "shipping", area: "Outbound" });
  });

  it("marks level 1 as pick faces and upper levels as bulk", () => {
    const roles = Object.fromEntries(plan.bins.filter((row) => row.source === "rack").map((row) => [row.code, row.slotRole]));
    expect(roles["A-01-01"]).toBe("pick");
    expect(roles["A-01-01-2"]).toBe("bulk");
  });

  it("lays out API calls in order: areas and racks first, then slot roles, no warehouse patch when nothing changed", () => {
    const kinds = plan.requests.map((request) => request.kind);
    expect(kinds.slice(0, 4)).toEqual(["area", "rack", "area", "area"]);
    expect(kinds.filter((kind) => kind === "slotRole")).toHaveLength(8);
    expect(kinds).not.toContain("warehouse");
    const rack = plan.requests.find((request) => request.kind === "rack")!;
    expect(rack.kind === "rack" && rack.body).toMatchObject({ aisle: "A", rack: "01", bays: 4, levels: 2, rotation: 0 });
    expect(rack.kind === "rack" && rack.codes).toHaveLength(8);
    const dock = plan.requests[0]!;
    expect(dock.kind === "area" && dock.body).toMatchObject({ type: "receiving", code: "DOCK", name: "Receiving dock", posX: 2, posY: 1 });
  });

  it("places everything inside the map without overlaps, as the server will check", () => {
    expect(validateDrafts(plan.bins, [], WAREHOUSE)).toBeNull();
  });

  it("feeds the tree the same picture", () => {
    const tree = buildHierarchyTree("Garage", plannedHierarchy(plan.bins));
    expect(tree.count).toBe(11);
    expect(tree.children.map((area) => area.label)).toEqual(["Dock", "Aisle A", "Shop", "Outbound"]);
    expect(tree.children[1]!.children[0]!.children.map((bay) => bay.code)).toEqual(["A-01-01", "A-01-02", "A-01-03", "A-01-04"]);
  });
});

describe("planSetup around what exists", () => {
  it("numbers new racks after the existing ones and steers clear of them on the map", () => {
    const existing = [DOCK, ...RACK_A01];
    const input = { ...fresh(false), dock: { include: false, code: "DOCK", name: "" } };
    input.racks = { include: true, aisle: "A", racks: 2, bays: 4, levels: 3, pickFaces: true };
    const plan = planSetup(input, { existing, warehouse: { ...WAREHOUSE, name: "Main" } });
    expect(plan.issues).toEqual([]);
    const racks = plan.requests.filter((request) => request.kind === "rack");
    expect(racks.map((request) => request.kind === "rack" && request.body.rack)).toEqual(["02", "03"]);
    expect(validateDrafts(plan.bins, existing, WAREHOUSE)).toBeNull();
    // The building keeps its name; the input default named it "Garage" from a different fixture.
    expect(plan.requests.filter((request) => request.kind === "warehouse")).toHaveLength(1);
  });

  it("patches only what changed on the building", () => {
    const input = fresh(true);
    input.building = { name: "  Garage ", timeZone: "UTC" };
    expect(planSetup(input, { existing: [], warehouse: WAREHOUSE }).requests.find((r) => r.kind === "warehouse")).toBeUndefined();
    input.building = { name: "North shop", timeZone: "America/Denver" };
    const patch = planSetup(input, { existing: [], warehouse: WAREHOUSE }).requests.find((r) => r.kind === "warehouse");
    expect(patch).toEqual({ kind: "warehouse", body: { name: "North shop", timeZone: "America/Denver" } });
  });

  it("does nothing when every step is switched off", () => {
    const input = fresh(true);
    input.dock = { ...input.dock, include: false };
    input.racks = { ...input.racks, include: false };
    input.bench = { ...input.bench, include: false };
    input.ship = { ...input.ship, include: false };
    const plan = planSetup(input, { existing: [], warehouse: WAREHOUSE });
    expect(plan.bins).toEqual([]);
    expect(plan.requests).toEqual([]);
    expect(plan.issues).toEqual([]);
    expect(plan.description).toBe("");
  });

  it("leaves slot roles alone on a single-level shelf", () => {
    const input = fresh(true);
    input.racks = { ...input.racks, levels: 1, pickFaces: true };
    const plan = planSetup(input, { existing: [], warehouse: WAREHOUSE });
    expect(plan.bins.filter((row) => row.source === "rack").every((row) => row.slotRole === "none")).toBe(true);
    expect(plan.requests.some((request) => request.kind === "slotRole")).toBe(false);
  });

  it("squeezes level height when the building is low", () => {
    const input = fresh(false);
    input.racks = { ...input.racks, levels: 6 };
    const plan = planSetup(input, { existing: [], warehouse: { ...WAREHOUSE, mapHeight: 6 } });
    expect(plan.issues).toEqual([]);
    const rack = plan.requests.find((request) => request.kind === "rack")!;
    expect(rack.kind === "rack" && rack.body.levelHeight).toBe(1);
  });
});

describe("planSetup issues", () => {
  const ctx = { existing: [DOCK, ...RACK_A01], warehouse: WAREHOUSE };

  it("wants a name and a real timezone", () => {
    const input = fresh(true);
    input.building = { name: "  ", timeZone: "Mars/Olympus" };
    const plan = planSetup(input, ctx);
    expect(issuesForStep(plan, "building").map((issue) => issue.field)).toEqual(["name", "timeZone"]);
    expect(plan.requests).toEqual([]);
    expect(firstIssueStep(plan)).toBe("building");
  });

  it("refuses blank, spaced, and duplicate codes", () => {
    const input = fresh(true);
    input.dock = { include: true, code: "", name: "" };
    input.bench = { include: true, code: "my bench", name: "" };
    input.ship = { include: true, code: "recv", name: "" };
    const plan = planSetup(input, ctx);
    expect(issuesForStep(plan, "dock")[0]!.message).toMatch(/Enter a code/);
    expect(issuesForStep(plan, "bench")[0]!.message).toMatch(/no spaces/);
    expect(issuesForStep(plan, "ship")[0]!.message).toBe("RECV already exists. Pick another code.");
  });

  it("catches two new areas sharing a code", () => {
    const input = fresh(true);
    input.bench = { include: true, code: "OUT", name: "" };
    input.ship = { include: true, code: "out", name: "" };
    const plan = planSetup(input, { existing: [], warehouse: WAREHOUSE });
    expect(issuesForStep(plan, "ship")[0]!.message).toBe("OUT already exists. Pick another code.");
    expect(issuesForStep(plan, "bench")).toEqual([]);
  });

  it("checks the rack numbers and aisle letters", () => {
    const input = fresh(true);
    input.racks = { include: true, aisle: "A1", racks: 1, bays: 4, levels: 2, pickFaces: true };
    expect(issuesForStep(planSetup(input, ctx), "racks")[0]!.field).toBe("aisle");
    input.racks = { include: true, aisle: "A", racks: "", bays: "2.5", levels: 99, pickFaces: true };
    const issues = issuesForStep(planSetup(input, ctx), "racks");
    expect(issues.map((issue) => issue.field)).toEqual(["racks", "bays", "levels"]);
    expect(issues[0]!.message).toBe("Racks must be a whole number.");
    expect(issues[2]!.message).toBe(`Levels must be between ${SETUP_LIMITS.levels.min} and ${SETUP_LIMITS.levels.max}.`);
  });

  it("says when the map has no room, and which step to fix", () => {
    const input = fresh(false);
    input.racks = { include: true, aisle: "A", racks: 8, bays: 12, levels: 3, pickFaces: true };
    const plan = planSetup(input, { existing: [], warehouse: { ...WAREHOUSE, mapWidth: 20, mapDepth: 20 } });
    expect(issuesForStep(plan, "racks").some((issue) => issue.message.includes("no room"))).toBe(true);
    expect(plan.requests).toEqual([]);
    expect(firstIssueStep(plan)).toBe("racks");
  });

  it("does not let a hand-made bay code collide with a new rack", () => {
    const stray = bin({ id: "stray", code: "B-01-02", type: "storage", aisle: "B", rack: "01", bay: "02", posX: 30, posY: 20 });
    const input = fresh(true);
    input.racks = { include: true, aisle: "B", racks: 1, bays: 4, levels: 1, pickFaces: false };
    const plan = planSetup(input, { existing: [stray], warehouse: WAREHOUSE });
    // The stray bay is recognised as rack B-01, so the new rack becomes B-02 and nothing collides.
    expect(plan.issues).toEqual([]);
    expect(plan.requests.find((request) => request.kind === "rack")!.kind === "rack" && plan.bins.some((row) => row.code === "B-02-01")).toBe(true);
  });
});

describe("helpers", () => {
  it("normalises codes like the server", () => {
    expect(normalizeCode("  dock-2 ")).toBe("DOCK-2");
  });

  it("previews the codes a rack step would mint, capped at the limits", () => {
    expect(previewRackCodes({ include: true, aisle: "a", racks: 1, bays: 2, levels: 2, pickFaces: true }, [])).toEqual([
      "A-01-01",
      "A-01-01-2",
      "A-01-02",
      "A-01-02-2",
    ]);
    expect(previewRackCodes({ include: true, aisle: "A", racks: 1, bays: 1, levels: 1, pickFaces: false }, RACK_A01)[0]).toBe("A-02-01");
    expect(previewRackCodes({ include: true, aisle: "", racks: 1, bays: 1, levels: 1, pickFaces: false }, [])).toEqual([]);
    expect(previewRackCodes({ include: true, aisle: "A", racks: "x", bays: 1, levels: 1, pickFaces: false }, [])).toEqual([]);
    expect(previewRackCodes({ include: true, aisle: "A", racks: 1, bays: 100, levels: 1, pickFaces: false }, [])).toHaveLength(
      SETUP_LIMITS.bays.max,
    );
  });

  it("reads existing bins for the tree, units included", () => {
    const rows = existingHierarchy([{ ...DOCK, name: "Receiving dock", unitsOnHand: 12, slotRole: "none" }]);
    expect(rows[0]).toMatchObject({ id: "d", code: "RECV", type: "receiving", units: 12, name: "Receiving dock" });
  });
});
