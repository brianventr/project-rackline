import { describe, expect, it } from "vitest";
import { normalizeBomSteps } from "./bom-steps";

const components = ["base", "shade", "cord", "bulb"];

describe("normalizeBomSteps", () => {
  it("accepts an empty list", () => {
    expect(normalizeBomSteps([], components)).toEqual([]);
    expect(normalizeBomSteps(null, components)).toEqual([]);
  });

  it("densifies seq from 1 and keeps title or body", () => {
    expect(
      normalizeBomSteps(
        [
          { seq: 20, title: "Cord", body: "Thread the cord." },
          { seq: 5, title: "Base" },
        ],
        components,
      ),
    ).toEqual([
      { id: null, seq: 1, title: "Base", body: "", imageUrl: null, componentItemId: null, workCenterId: null },
      { id: null, seq: 2, title: "Cord", body: "Thread the cord.", imageUrl: null, componentItemId: null, workCenterId: null },
    ]);
  });

  it("rejects a step with neither title nor body", () => {
    expect(() => normalizeBomSteps([{ imageUrl: "/demo-sku/LAMP.svg" }], components)).toThrow(
      "Each step needs a title or body",
    );
  });

  it("requires the optional component to be on the recipe", () => {
    expect(() =>
      normalizeBomSteps([{ title: "Glue", componentItemId: "resin" }], components),
    ).toThrow("Step component must be on the recipe");
    expect(
      normalizeBomSteps([{ title: "Seat base", componentItemId: "base" }], components)[0]?.componentItemId,
    ).toBe("base");
  });

  it("keeps a work center that belongs to the organization", () => {
    expect(
      normalizeBomSteps([{ title: "Weld", workCenterId: "bench" }], components, ["bench"])[0]?.workCenterId,
    ).toBe("bench");
    expect(() => normalizeBomSteps([{ title: "Weld", workCenterId: "missing" }], components, ["bench"])).toThrow(
      "Work center is not in this organization",
    );
  });
});
