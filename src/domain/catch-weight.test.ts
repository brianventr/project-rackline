import { describe, expect, it } from "vitest";
import {
  formatCatchWeight,
  requireCatchWeight,
  requireCountCatchWeight,
  splitCatchWeight,
} from "./catch-weight";

describe("requireCatchWeight", () => {
  it("ignores weight when the SKU is not catch-weight", () => {
    expect(requireCatchWeight(false, "SHADE", 500)).toBeNull();
    expect(requireCatchWeight(false, "SHADE", undefined)).toBeNull();
  });

  it("requires a positive integer in grams", () => {
    expect(requireCatchWeight(true, "RESIN", 500)).toBe(500);
    expect(() => requireCatchWeight(true, "RESIN", undefined)).toThrow("RESIN is catch-weight; enter weight in grams");
    expect(() => requireCatchWeight(true, "RESIN", 0)).toThrow("positive integer");
    expect(() => requireCatchWeight(true, "RESIN", 1.5)).toThrow("positive integer");
  });
});

describe("requireCountCatchWeight", () => {
  it("skips weight when the counted qty is 0", () => {
    expect(requireCountCatchWeight(true, "RESIN", 0, undefined)).toBeNull();
    expect(requireCountCatchWeight(true, "RESIN", 2, 900)).toBe(900);
  });
});

describe("formatCatchWeight", () => {
  it("renders grams", () => {
    expect(formatCatchWeight(500)).toBe("500 g");
    expect(formatCatchWeight(null)).toBe("—");
  });
});

describe("splitCatchWeight", () => {
  it("keeps the remainder on the last piece", () => {
    expect(splitCatchWeight(1000, [2, 1])).toEqual([666, 334]);
    expect(splitCatchWeight(null, [2, 1])).toEqual([null, null]);
  });
});
