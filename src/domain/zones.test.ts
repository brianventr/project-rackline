import { describe, expect, it } from "vitest";
import { locationsInZone, zoneCode } from "./zones";

describe("zones", () => {
  it("filters locations by zone", () => {
    const rows = [
      { id: "1", zoneId: "z-a" },
      { id: "2", zoneId: "z-b" },
      { id: "3", zoneId: null },
    ];
    expect(locationsInZone(rows, "z-a").map((r) => r.id)).toEqual(["1"]);
    expect(locationsInZone(rows, null)).toHaveLength(3);
  });

  it("labels missing zones", () => {
    expect(zoneCode({ code: "A", name: "Aisle A" })).toBe("A");
    expect(zoneCode(null)).toBe("—");
  });
});
