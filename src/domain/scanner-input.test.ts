import { describe, expect, it } from "vitest";
import { nextScanTimestamp, parseScannerInputMode, scanFieldInputMode } from "./scanner-input";

describe("scanner input preference", () => {
  it("restores accessory mode and defaults missing or unknown preferences to touch", () => {
    expect(parseScannerInputMode("accessory")).toBe("accessory");
    for (const value of [null, undefined, "touch", "", "bluetooth", "{broken storage}"]) {
      expect(parseScannerInputMode(value)).toBe("touch");
    }
  });

  it("suppresses the software keyboard only when accessory mode is armed for scanning", () => {
    expect(scanFieldInputMode("accessory", false)).toBe("none");
    expect(scanFieldInputMode("accessory", true)).toBe("text");
    expect(scanFieldInputMode("touch", false)).toBe("text");
    expect(scanFieldInputMode("touch", true)).toBe("text");
  });
});

describe("scan identity", () => {
  it("retains repeated scans in the same millisecond and across a clock adjustment", () => {
    const first = nextScanTimestamp(0, 1000);
    const second = nextScanTimestamp(first, 1000);
    const third = nextScanTimestamp(second, 900);
    expect([first, second, third]).toEqual([1000, 1001, 1002]);
    expect(nextScanTimestamp(third, 2000)).toBe(2000);
  });
});
