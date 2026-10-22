import { describe, expect, it } from "vitest";
import {
  buildingPrice,
  licensesForUncovered,
  monthlyLicenseTotal,
  planForOperatingMode,
} from "./building-license";

describe("building licenses", () => {
  it("prices a building from the mode the shop is running", () => {
    expect(planForOperatingMode("garage")).toBe("garage");
    expect(planForOperatingMode("warehouse")).toBe("manufacturer");
    expect(buildingPrice("garage")).toBe(150);
    expect(buildingPrice("shop")).toBe(349);
    expect(buildingPrice("manufacturer")).toBe(799);
  });

  it("covers only buildings that do not already have a license", () => {
    const drafts = licensesForUncovered(["main", "west"], new Set(["main"]), "manufacturer");
    expect(drafts).toEqual([{ warehouseId: "west", plan: "manufacturer", priceDollars: 799 }]);
    expect(licensesForUncovered(["main"], new Set(["main"]), "garage")).toEqual([]);
  });

  it("adds the monthly prices of the licenses a shop holds", () => {
    expect(monthlyLicenseTotal([150, 150])).toBe(300);
    expect(monthlyLicenseTotal([])).toBe(0);
  });
});
