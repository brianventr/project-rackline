import { describe, expect, it } from "vitest";
import { ageInDays, relativeTime } from "./relative-time";

const now = Date.UTC(2026, 8, 23, 12, 0, 0);

describe("relativeTime", () => {
  it("rounds to the largest sensible unit", () => {
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("reads future times forward", () => {
    expect(relativeTime(now + 10 * 60_000, now)).toBe("in 10m");
  });

  it("falls back to a date after two weeks", () => {
    expect(relativeTime(now - 30 * 86_400_000, now)).toBe("Aug 24");
  });
});

describe("ageInDays", () => {
  it("floors partial days and never goes negative", () => {
    expect(ageInDays(now - 36 * 3_600_000, now)).toBe(1);
    expect(ageInDays(now + 3_600_000, now)).toBe(0);
  });
});
