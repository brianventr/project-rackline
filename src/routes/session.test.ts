import { describe, expect, it } from "vitest";
import { safeNextPath } from "./session";

describe("safeNextPath", () => {
  it("keeps in-app paths and drops off-site targets", () => {
    expect(safeNextPath("/today")).toBe("/today");
    expect(safeNextPath("/floor/pick")).toBe("/floor/pick");
    expect(safeNextPath("https://evil.example")).toBe("/today");
    expect(safeNextPath("//evil.example")).toBe("/today");
    expect(safeNextPath("today")).toBe("/today");
  });
});
