import { describe, expect, it } from "vitest";
import {
  allLinesEntered,
  applyCountEntries,
  countHasItem,
  countHasVariance,
  countVariance,
  formatCountVariance,
  isBlindCount,
  isCountEntered,
  revealSystemQty,
} from "./blind-count";

describe("isBlindCount", () => {
  it("hides system qty until the count is posted", () => {
    expect(isBlindCount("draft")).toBe(true);
    expect(isBlindCount("counting")).toBe(true);
    expect(isBlindCount("posted")).toBe(false);
  });
});

describe("count entries", () => {
  it("treats 0 as a real count once entered", () => {
    expect(isCountEntered(0)).toBe(false);
    expect(isCountEntered(1)).toBe(true);
    expect(isCountEntered(true)).toBe(true);
    expect(
      allLinesEntered([
        { entered: true },
        { entered: 1 },
      ]),
    ).toBe(true);
    expect(allLinesEntered([{ entered: false }, { entered: true }])).toBe(false);
    expect(allLinesEntered([])).toBe(true);
  });

  it("marks posted body lines entered and leaves omitted lines as stored", () => {
    const next = applyCountEntries(
      [
        { id: "a", countedQty: 0, entered: false },
        { id: "b", countedQty: 0, entered: false },
      ],
      [{ id: "a", countedQty: 0 }],
    );
    expect(next).toEqual([
      { id: "a", countedQty: 0, entered: true },
      { id: "b", countedQty: 0, entered: false },
    ]);
    expect(allLinesEntered(next)).toBe(false);
  });
});

describe("countHasItem", () => {
  it("finds a SKU already on the snapshot", () => {
    const lines = [
      { itemId: "cord" },
      { itemId: "bulb" },
    ];
    expect(countHasItem(lines, "bulb")).toBe(true);
    expect(countHasItem(lines, "shade")).toBe(false);
  });
});

describe("countVariance", () => {
  it("is counted minus system", () => {
    expect(countVariance(38, 40)).toBe(-2);
    expect(countVariance(0, 4)).toBe(-4);
    expect(countHasVariance(40, 40)).toBe(false);
    expect(countHasVariance(0, 0)).toBe(false);
    expect(countHasVariance(2, 0)).toBe(true);
  });
});

describe("formatCountVariance", () => {
  it("signs overages", () => {
    expect(formatCountVariance(2)).toBe("+2");
    expect(formatCountVariance(-2)).toBe("-2");
    expect(formatCountVariance(0)).toBe("0");
  });
});

describe("revealSystemQty", () => {
  it("returns null while counting", () => {
    expect(revealSystemQty("counting", 40)).toBeNull();
    expect(revealSystemQty("posted", 40)).toBe(40);
  });
});
