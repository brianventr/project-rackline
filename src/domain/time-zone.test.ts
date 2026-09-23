import { describe, expect, it } from "vitest";
import { startOfZonedDay } from "./time-zone";

describe("startOfZonedDay", () => {
  it("lands exactly on local midnight when the input has milliseconds", () => {
    const at = Date.UTC(2026, 8, 23, 15, 30, 12, 987);
    expect(startOfZonedDay(at, "UTC")).toBe(Date.UTC(2026, 8, 23));
    // 00:00 PDT is 07:00 UTC.
    expect(startOfZonedDay(at, "America/Los_Angeles")).toBe(Date.UTC(2026, 8, 23, 7));
  });

  it("steps back one day from a millisecond before midnight", () => {
    const midnight = Date.UTC(2026, 8, 23);
    expect(startOfZonedDay(midnight - 1, "UTC")).toBe(Date.UTC(2026, 8, 22));
  });
});
