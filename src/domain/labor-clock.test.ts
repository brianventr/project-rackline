import { describe, expect, it } from "vitest";
import { closeClock, durationSeconds, openClocksForUser } from "./labor-clock";

describe("labor clocks", () => {
  it("computes duration", () => {
    expect(durationSeconds(1000, 5500)).toBe(4);
    expect(closeClock({ startedAt: 0, endedAt: 3000 }).durationSec).toBe(3);
  });

  it("lists open clocks with elapsed", () => {
    const open = openClocksForUser(
      [
        { id: "a", startedAt: 0, endedAt: null },
        { id: "b", startedAt: 5000, endedAt: 6000 },
      ],
      4000,
    );
    expect(open).toHaveLength(1);
    expect(open[0]?.elapsedSec).toBe(4);
  });
});
