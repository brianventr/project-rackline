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

  it("after putaway, a same-aisle pick beats an older Shopify pick and a shorter walk", () => {
    const ranked = rankJobs(
      [
        job({
          id: "shop",
          verb: "pick",
          aisle: "A",
          shopify: true,
          createdAt: now - 72 * 3_600_000,
          fromX: 11,
          fromY: 10,
        }),
        job({ id: "here", verb: "pick", aisle: "B", createdAt: now, fromX: 80, fromY: 80 }),
      ],
      { now, fromX: 10, fromY: 10, lastVerb: "putaway", lastAisle: "B" },
    );
    expect(ranked[0]?.id).toBe("here");
    expect(ranked[0]?.reason).toBe("Pick on aisle B, the aisle you just worked");
  });

  it("after receive, a same-aisle pick still wins, and a same-aisle bonus of 80 would not", () => {
    const olderShopify = job({
      id: "shop",
      verb: "pick",
      aisle: "A",
      shopify: true,
      createdAt: now - 72 * 3_600_000,
      fromX: 10,
      fromY: 10,
    });
    const here = job({ id: "here", verb: "pick", aisle: "B", createdAt: now, fromX: 40, fromY: 40 });
    const ranked = rankJobs([olderShopify, here], { now, fromX: 10, fromY: 10, lastVerb: "receive", lastAisle: "B" });
    expect(ranked[0]?.id).toBe("here");
    const withoutInterleave = rankJobs([olderShopify, here], { now, fromX: 10, fromY: 10, lastVerb: "pick", lastAisle: "B" });
    expect(withoutInterleave[0]?.id).toBe("shop");
  });

  it("does not let a same-aisle pick beat pinned, starved, or expiring work", () => {
    const ranked = rankJobs(
      [
        job({ id: "here", verb: "pick", aisle: "B" }),
        job({ id: "pin", verb: "count", aisle: "A", pinned: true }),
        job({ id: "starve", verb: "replenish", aisle: "A", starved: true }),
        job({ id: "exp", verb: "pick", aisle: "A", expiringDays: 14 }),
      ],
      { now, lastVerb: "putaway", lastAisle: "B" },
    );
    expect(ranked.map((row) => row.id)).toEqual(["pin", "starve", "exp", "here"]);
  });
});
