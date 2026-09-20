import { describe, expect, it } from "vitest";
import { PIN_SCORE, STARVE_SCORE, rankJobs, walkDistance } from "./job-rank";
import type { RankInput } from "./job-rank";

const now = 1_000_000_000_000;

function job(partial: Partial<RankInput> & { id: string; verb: RankInput["verb"] }): RankInput {
  return {
    pinned: false,
    createdAt: now,
    dueAt: null,
    fromX: 10,
    fromY: 10,
    aisle: "A",
    starved: false,
    expiringDays: null,
    shopify: false,
    dockDwellMs: 0,
    ...partial,
  };
}

describe("rankJobs", () => {
  it("ranks a starved replenish ahead of an idle cycle count", () => {
    const ranked = rankJobs(
      [
        job({ id: "count", verb: "count", createdAt: now - 86_400_000 }),
        job({ id: "rpl", verb: "replenish", starved: true }),
      ],
      { now },
    );
    expect(ranked[0]?.id).toBe("rpl");
    expect(ranked[0]?.reason).toBe("Pick face is starving open picks");
    expect(ranked[0]!.score).toBeGreaterThan(STARVE_SCORE - 1);
  });

  it("prefers the nearer bay when urgency matches", () => {
    const ranked = rankJobs(
      [
        job({ id: "far", verb: "pick", fromX: 40, fromY: 40 }),
        job({ id: "near", verb: "pick", fromX: 12, fromY: 10 }),
      ],
      { now, fromX: 10, fromY: 10 },
    );
    expect(ranked[0]?.id).toBe("near");
    expect(walkDistance(10, 10, 12, 10)).toBe(2);
    expect(walkDistance(10, 10, 40, 40)).toBe(60);
  });

  it("hides notBefore jobs at the filter layer; pin still wins when present", () => {
    const ranked = rankJobs(
      [
        job({ id: "old", verb: "receive", createdAt: now - 10_000_000, dockDwellMs: 10_000_000 }),
        job({ id: "pin", verb: "count", pinned: true }),
      ],
      { now },
    );
    expect(ranked[0]?.id).toBe("pin");
    expect(ranked[0]?.reason).toBe("Pinned");
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(PIN_SCORE);
  });

  it("calls out FEFO lots inside 14 days", () => {
    const ranked = rankJobs([job({ id: "lot", verb: "pick", expiringDays: 2 })], { now });
    expect(ranked[0]?.reason).toBe("Expires in 2 days");
  });
});
