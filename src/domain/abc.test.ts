import { describe, expect, it } from "vitest";
import { ABC_CADENCE_DAYS, DAY_MS, chooseCountBay, classifyAbc, cycleCountDue } from "./abc";

describe("classifyAbc", () => {
  it("puts the 80% cutoff in A, the 95% cutoff in B, and the rest in C", () => {
    const classes = classifyAbc([
      { itemId: "fast", units: 80 },
      { itemId: "mid", units: 15 },
      { itemId: "slow", units: 5 },
    ]);
    expect(classes.get("fast")).toBe("A");
    expect(classes.get("mid")).toBe("B");
    expect(classes.get("slow")).toBe("C");
  });

  it("keeps the item that crosses 80% in A", () => {
    const classes = classifyAbc([
      { itemId: "a", units: 50 },
      { itemId: "b", units: 31 },
      { itemId: "c", units: 19 },
    ]);
    expect(classes.get("a")).toBe("A");
    expect(classes.get("b")).toBe("A");
    expect(classes.get("c")).toBe("B");
  });

  it("classes zero movement as C, including when nothing moved", () => {
    expect(classifyAbc([{ itemId: "idle", units: 0 }]).get("idle")).toBe("C");
    const mixed = classifyAbc([
      { itemId: "fast", units: 10 },
      { itemId: "idle", units: 0 },
    ]);
    expect(mixed.get("fast")).toBe("A");
    expect(mixed.get("idle")).toBe("C");
  });
});

describe("cycleCountDue", () => {
  const now = 1_000_000_000_000;

  it("skips an item that already has an open count", () => {
    expect(cycleCountDue({ abcClass: "A", lastPostedAt: null, open: true, now })).toBe(false);
  });

  it("skips an A item counted inside 7 days and counts it again on the boundary", () => {
    const recent = now - (ABC_CADENCE_DAYS.A - 1) * DAY_MS;
    const due = now - ABC_CADENCE_DAYS.A * DAY_MS;
    expect(cycleCountDue({ abcClass: "A", lastPostedAt: recent, open: false, now })).toBe(false);
    expect(cycleCountDue({ abcClass: "A", lastPostedAt: due, open: false, now })).toBe(true);
  });

  it("uses 30 days for B and 90 for C", () => {
    expect(
      cycleCountDue({ abcClass: "B", lastPostedAt: now - 29 * DAY_MS, open: false, now }),
    ).toBe(false);
    expect(
      cycleCountDue({ abcClass: "B", lastPostedAt: now - 30 * DAY_MS, open: false, now }),
    ).toBe(true);
    expect(
      cycleCountDue({ abcClass: "C", lastPostedAt: now - 89 * DAY_MS, open: false, now }),
    ).toBe(false);
    expect(
      cycleCountDue({ abcClass: "C", lastPostedAt: now - 90 * DAY_MS, open: false, now }),
    ).toBe(true);
  });
});

describe("chooseCountBay", () => {
  it("prefers the pick face, then the fullest bay", () => {
    expect(
      chooseCountBay([
        { locationId: "bulk", qty: 20, slotRole: "bulk" },
        { locationId: "pick", qty: 2, slotRole: "pick" },
      ]),
    ).toBe("pick");
    expect(
      chooseCountBay([
        { locationId: "a", qty: 1, slotRole: "bulk" },
        { locationId: "b", qty: 9, slotRole: null },
      ]),
    ).toBe("b");
    expect(chooseCountBay([{ locationId: "empty", qty: 0, slotRole: "pick" }])).toBeNull();
  });
});
