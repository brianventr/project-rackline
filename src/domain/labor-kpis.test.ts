import { describe, expect, it } from "vitest";
import {
  buildLaborKpis,
  classifyLaborFact,
  expectedLineMs,
  manhattanTravel,
  paceScore,
  sessionActiveMs,
  skuComplexity,
  utcDay,
  LABOR_MAX_GAP_MS,
} from "./labor-kpis";

const members = [
  { userId: "maya", userName: "Maya Chen", role: "operator" },
  { userId: "jordan", userName: "Jordan Dock", role: "operator" },
];

const items = [
  {
    itemId: "base",
    sku: "BASE",
    name: "Lamp base",
    type: "raw",
    trackLot: false,
    trackSerial: false,
    catchWeight: false,
    trackExpiry: false,
  },
  {
    itemId: "glue",
    sku: "GLUE",
    name: "Wood glue",
    type: "raw",
    trackLot: true,
    trackSerial: false,
    catchWeight: false,
    trackExpiry: true,
  },
  {
    itemId: "lamp",
    sku: "LAMP",
    name: "Desk lamp",
    type: "finished",
    trackLot: false,
    trackSerial: true,
    catchWeight: false,
    trackExpiry: false,
  },
  {
    itemId: "resin",
    sku: "RESIN",
    name: "Casting resin",
    type: "raw",
    trackLot: false,
    trackSerial: false,
    catchWeight: true,
    trackExpiry: false,
  },
];

const locations = [
  { id: "a0101", warehouseId: "wh1", posX: 2, posY: 7 },
  { id: "b0101", warehouseId: "wh1", posX: 22, posY: 7 },
];

function fact(partial: {
  userId: string;
  type: string;
  itemId: string;
  qty: number;
  createdAt: number;
  refId?: string;
  refType?: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  reason?: string;
}) {
  return {
    refType: partial.refType ?? "order",
    refId: partial.refId ?? "ord-1",
    fromLocationId: partial.fromLocationId ?? "a0101",
    toLocationId: partial.toLocationId ?? null,
    reason: partial.reason ?? null,
    ...partial,
  };
}

describe("labor KPIs", () => {
  it("scores pace on the ShipHero 0–10 scale", () => {
    expect(paceScore(1000, 1000)).toBe(5);
    expect(paceScore(1000, 500)).toBe(10);
    expect(paceScore(1000, 2000)).toBe(0);
    expect(paceScore(1000, 1500)).toBe(2.5);
    expect(paceScore(1000, 750)).toBe(7.5);
    expect(paceScore(1000, 0)).toBe(5);
  });

  it("weights SKU complexity from item flags", () => {
    expect(skuComplexity({})).toBe(1);
    expect(skuComplexity({ trackLot: true, trackExpiry: true })).toBeCloseTo(1.7);
    expect(
      skuComplexity({ trackLot: true, trackSerial: true, catchWeight: true, trackExpiry: true }),
    ).toBeCloseTo(2.4);
  });

  it("adds map travel onto expected time", () => {
    const easy = expectedLineMs({ qty: 1, complexity: 1 });
    const walked = expectedLineMs({ qty: 1, complexity: 1, travelMapUnits: 20 });
    expect(walked).toBeGreaterThan(easy);
    expect(manhattanTravel({ posX: 2, posY: 7 }, { posX: 22, posY: 7 })).toBe(20);
  });

  it("does not count overnight gaps as active time", () => {
    const t0 = 1_000_000;
    expect(sessionActiveMs([t0, t0 + 60_000])).toBe(60_000);
    expect(sessionActiveMs([t0, t0 + LABOR_MAX_GAP_MS + 1])).toBe(0);
    expect(sessionActiveMs([t0])).toBe(0);
  });

  it("drops seed rows and unknown createdBy", () => {
    expect(classifyLaborFact({ type: "receive", refType: "seed" }).kind).toBe("ignore");
    const board = buildLaborKpis({
      members,
      items,
      locations,
      facts: [
        fact({ userId: "ghost", type: "pick", itemId: "base", qty: 99, createdAt: 1 }),
        fact({ userId: "maya", type: "receive", itemId: "base", qty: 4, createdAt: 1, refType: "seed" }),
      ],
    });
    expect(board.staff).toHaveLength(0);
    expect(board.team.units).toBe(0);
  });

  it("keeps unpick and cycle-count variance out of UPH", () => {
    const t0 = Date.parse("2026-09-20T16:00:00Z");
    const board = buildLaborKpis({
      members,
      items,
      locations,
      facts: [
        fact({ userId: "maya", type: "pick", itemId: "base", qty: 10, createdAt: t0 }),
        fact({ userId: "maya", type: "pick", itemId: "base", qty: 2, createdAt: t0 + 60_000 }),
        fact({ userId: "maya", type: "unpick", itemId: "base", qty: 2, createdAt: t0 + 90_000 }),
        fact({
          userId: "maya",
          type: "adjust",
          itemId: "base",
          qty: 3,
          createdAt: t0 + 120_000,
          refType: "cycle_count",
          reason: "Cycle count variance (5 → 2)",
        }),
      ],
    });
    const maya = board.staff[0]!;
    expect(maya.units).toBe(12);
    expect(maya.exceptionUnits).toBe(5);
    expect(maya.lines).toBe(2);
    expect(board.verbMix.some((row) => row.verb === "unpick")).toBe(true);
    expect(board.verbMix.some((row) => row.verb === "count")).toBe(true);
  });

  it("pivots staff × SKU and flags hard SKUs", () => {
    const t0 = Date.parse("2026-09-18T14:00:00Z");
    const board = buildLaborKpis({
      members,
      items,
      locations,
      facts: [
        fact({ userId: "maya", type: "pick", itemId: "glue", qty: 2, createdAt: t0, refId: "ord-hard" }),
        fact({
          userId: "maya",
          type: "pick",
          itemId: "lamp",
          qty: 1,
          createdAt: t0 + 20 * 60_000,
          refId: "ord-hard",
          fromLocationId: "b0101",
        }),
        fact({ userId: "jordan", type: "receive", itemId: "base", qty: 20, createdAt: t0, refId: "rcp-1", refType: "receipt" }),
        fact({
          userId: "jordan",
          type: "move",
          itemId: "base",
          qty: 20,
          createdAt: t0 + 30_000,
          refId: "xfr-1",
          refType: "transfer",
          fromLocationId: "a0101",
          toLocationId: "b0101",
        }),
        fact({
          userId: "jordan",
          type: "receive",
          itemId: "resin",
          qty: 4,
          createdAt: t0 + 3_600_000,
          refId: "rcp-2",
          refType: "receipt",
        }),
      ],
    });

    expect(board.staff.map((row) => row.userId).sort()).toEqual(["jordan", "maya"]);
    const glue = board.skus.find((row) => row.sku === "GLUE")!;
    expect(glue.complexity).toBe(1.7);
    expect(glue.trackLot).toBe(true);
    expect(glue.trackExpiry).toBe(true);
    const base = board.skus.find((row) => row.sku === "BASE")!;
    expect(base.complexity).toBe(1);
    expect(board.matrix.some((cell) => cell.userId === "maya" && cell.sku === "LAMP")).toBe(true);
    expect(board.matrix.some((cell) => cell.userId === "jordan" && cell.sku === "BASE" && cell.units === 40)).toBe(true);
    expect(utcDay(t0)).toBe("2026-09-18");
    expect(board.daily[0]?.day).toBe("2026-09-18");
    expect(glue.hard).toBe(true);
  });

  it("does not count idle time between documents as active hours", () => {
    const t0 = Date.parse("2026-09-20T16:00:00Z");
    const board = buildLaborKpis({
      members,
      items,
      locations,
      facts: [
        fact({ userId: "maya", type: "pick", itemId: "base", qty: 2, createdAt: t0, refId: "ord-a" }),
        fact({
          userId: "maya",
          type: "pick",
          itemId: "glue",
          qty: 1,
          createdAt: t0 + 10 * 60_000,
          refId: "ord-b",
        }),
      ],
    });
    const maya = board.staff[0]!;
    expect(maya.activeMs).toBeLessThan(60_000);
    expect(maya.pace).toBe(5);
  });

  it("raises expected time when a picker walks between bays", () => {
    const t0 = 5_000_000;
    const still = buildLaborKpis({
      members,
      items,
      locations,
      facts: [
        fact({ userId: "maya", type: "pick", itemId: "base", qty: 1, createdAt: t0, refId: "walk" }),
        fact({ userId: "maya", type: "pick", itemId: "base", qty: 1, createdAt: t0 + 10_000, refId: "walk" }),
      ],
    });
    const walked = buildLaborKpis({
      members,
      items,
      locations,
      facts: [
        fact({ userId: "maya", type: "pick", itemId: "base", qty: 1, createdAt: t0, refId: "walk" }),
        fact({
          userId: "maya",
          type: "pick",
          itemId: "lamp",
          qty: 1,
          createdAt: t0 + 10_000,
          refId: "walk",
          fromLocationId: "b0101",
        }),
      ],
    });
    expect(walked.staff[0]!.expectedMs).toBeGreaterThan(still.staff[0]!.expectedMs);
  });
});
