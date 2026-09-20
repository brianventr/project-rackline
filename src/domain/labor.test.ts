import { describe, expect, it } from "vitest";
import { isLaborVerb, rollupLabor } from "./labor";

describe("labor", () => {
  it("recognizes verbs", () => {
    expect(isLaborVerb("pick")).toBe(true);
    expect(isLaborVerb("dance")).toBe(false);
  });

  it("rolls up events by user", () => {
    expect(
      rollupLabor([
        { userId: "a", userName: "Ada", qty: 3, durationSec: 60 },
        { userId: "a", userName: "Ada", qty: 2, durationSec: 40 },
        { userId: "b", userName: "Bea", qty: null, durationSec: 10 },
      ]),
    ).toEqual([
      { userId: "a", userName: "Ada", events: 2, qty: 5, durationSec: 100 },
      { userId: "b", userName: "Bea", events: 1, qty: 0, durationSec: 10 },
    ]);
  });
});
