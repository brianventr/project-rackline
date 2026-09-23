import { describe, expect, it } from "vitest";
import { dailyTrend } from "./trends";

const DAY = 86_400_000;
// 2026-09-23 15:00 UTC = 08:00 in Los Angeles (PDT, UTC-7).
const now = Date.UTC(2026, 8, 23, 15, 0, 0);

describe("dailyTrend", () => {
  it("returns seven local days ending today", () => {
    const days = dailyTrend([], now, "UTC");
    expect(days).toHaveLength(7);
    expect(days[6]!.start).toBe(Date.UTC(2026, 8, 23));
    expect(days[0]!.start).toBe(Date.UTC(2026, 8, 17));
  });

  it("buckets by the warehouse timezone, not UTC", () => {
    // 06:00 UTC on the 23rd is 23:00 on the 22nd in Los Angeles.
    const late = Date.UTC(2026, 8, 23, 6, 0, 0);
    const days = dailyTrend([{ type: "receive", qty: 5, createdAt: late, refId: "r1" }], now, "America/Los_Angeles");
    expect(days[6]!.received).toBe(0);
    expect(days[5]!.received).toBe(5);
  });

  it("sums units by kind and counts shipped orders once per day", () => {
    const days = dailyTrend(
      [
        { type: "pick", qty: -3, createdAt: now - 1000, refId: "o1" },
        { type: "ship", qty: 2, createdAt: now - 2000, refId: "o1" },
        { type: "ship", qty: 1, createdAt: now - 3000, refId: "o1" },
        { type: "ship", qty: 4, createdAt: now - 4000, refId: "o2" },
        { type: "kit_produce", qty: 2, createdAt: now - 5000, refId: "k1" },
        { type: "wo_produce", qty: 1, createdAt: now - 6000, refId: "w1" },
        { type: "adjust", qty: 9, createdAt: now - 7000, refId: "a1" },
      ],
      now,
      "UTC",
    );
    expect(days[6]).toMatchObject({ picked: 3, shipped: 7, shippedOrders: 2, built: 3, received: 0 });
  });

  it("drops movements older than the window or in the future", () => {
    const days = dailyTrend(
      [
        { type: "receive", qty: 1, createdAt: now - 8 * DAY, refId: "old" },
        { type: "receive", qty: 1, createdAt: now + DAY, refId: "future" },
      ],
      now,
      "UTC",
    );
    expect(days.reduce((sum, day) => sum + day.received, 0)).toBe(0);
  });
});
