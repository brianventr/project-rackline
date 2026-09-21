import { describe, expect, it } from "vitest";
import { releaseDocumentKind, usualBays } from "./build-request";

describe("releaseDocumentKind", () => {
  it("releases a finished recipe as a kit and WIP as a work order", () => {
    expect(releaseDocumentKind("finished")).toBe("kit");
    expect(releaseDocumentKind("wip")).toBe("work_order");
    expect(() => releaseDocumentKind("raw")).toThrow(/finished or WIP/);
  });
});

describe("usualBays", () => {
  it("consumes from storage and puts kits on the pick face", () => {
    const bays = usualBays([
      { id: "dock", type: "receiving" },
      { id: "store", type: "storage", slotRole: "bulk" },
      { id: "face", type: "storage", slotRole: "pick" },
      { id: "bench", type: "production" },
    ]);
    expect(bays).toEqual({ sourceId: "store", kitOutputId: "face", workOrderOutputId: "bench" });
  });
});
