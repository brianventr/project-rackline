import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  DEFAULT_LEAD_MS,
  buildRunwayBoard,
  buildRunwayDraftLines,
  countShipDays,
  effectiveRate,
  explodeMakeDemand,
  isThinHistory,
  medianPositive,
  observedShipRate,
  orderByAt,
  pickLotsForCover,
  projectRunway,
  runsOutThisWeek,
  runwayStatus,
  stackBomBurn,
  suggestedRunwayQty,
  utcDayStart,
} from "./runway";

const asOf = Date.UTC(2026, 8, 21);

describe("observed and effective rates", () => {
  it("divides units by the window and ignores empty windows", () => {
    expect(observedShipRate(30, 10)).toBe(3);
    expect(observedShipRate(10, 0)).toBe(0);
    expect(observedShipRate(-4, 7)).toBe(0);
  });

  it("prefers a positive baseline, then observed, then none, and applies the multiplier", () => {
    expect(effectiveRate({ observed: 2, baseline: 5, multiplier: 1 })).toEqual({
      rate: 5,
      rateSource: "baseline",
    });
    expect(effectiveRate({ observed: 2, baseline: 5, multiplier: 2 })).toEqual({
      rate: 10,
      rateSource: "baseline",
    });
    expect(effectiveRate({ observed: 2, baseline: 0, multiplier: 1.5 })).toEqual({
      rate: 3,
      rateSource: "observed",
    });
    expect(effectiveRate({ observed: 0, baseline: null, multiplier: 2 })).toEqual({
      rate: 0,
      rateSource: "none",
    });
  });
});

describe("projectRunway", () => {
  it("is idle when rate is zero and stock remains", () => {
    const next = projectRunway({ sellable: 12, rate: 0, asOf });
    expect(next.stockoutAt).toBeNull();
    expect(next.daysOfCover).toBeNull();
    expect(next.coveredByInbound).toBe(false);
  });

  it("is out immediately when sellable is zero and demand exists", () => {
    const next = projectRunway({ sellable: 0, rate: 4, asOf });
    expect(next.stockoutAt).toBe(utcDayStart(asOf));
    expect(next.daysOfCover).toBe(0);
  });

  it("covers integer days as sellable / rate without inbound", () => {
    const next = projectRunway({ sellable: 10, rate: 4, asOf });
    expect(next.daysOfCover).toBeCloseTo(2.5, 5);
    expect(next.stockoutAt).toBe(asOf + 2.5 * DAY_MS);
    expect(next.firstGapAt).toBe(next.stockoutAt);
    expect(next.coveredByInbound).toBe(false);
  });

  it("treats inbound that arrives before the gap as cover", () => {
    const inbound = [{ at: asOf + 2 * DAY_MS, qty: 20 }];
    const next = projectRunway({ sellable: 10, rate: 5, inbound, asOf });
    expect(next.firstGapAt).toBe(asOf + 2 * DAY_MS);
    expect(next.coveredByInbound).toBe(true);
    expect(next.stockoutAt).toBe(asOf + 6 * DAY_MS);
    const lasting = projectRunway({
      sellable: 10,
      rate: 5,
      inbound: [{ at: asOf + 2 * DAY_MS, qty: 500 }],
      asOf,
    });
    expect(lasting.stockoutAt).toBeNull();
    expect(lasting.horizonHit).toBe(true);
    expect(lasting.coveredByInbound).toBe(true);
  });

  it("does not treat late inbound as cover", () => {
    const inbound = [{ at: asOf + 3 * DAY_MS, qty: 20 }];
    const next = projectRunway({ sellable: 10, rate: 5, inbound, asOf });
    expect(next.coveredByInbound).toBe(false);
    expect(next.stockoutAt).toBe(asOf + 2 * DAY_MS);
    expect(next.firstGapAt).toBe(asOf + 2 * DAY_MS);
  });

  it("excludes expired lots from cover and drops lots that expire before they would ship", () => {
    const lots = [
      { qty: 10, expiresOn: 20260922 },
      { qty: 6, expiresOn: 20260901 },
    ];
    expect(pickLotsForCover(lots, 16, 20260921)).toEqual([{ qty: 10, expiresOn: 20260922 }]);
    const next = projectRunway({
      sellable: 10,
      rate: 1,
      lots: [{ qty: 10, expiresOn: 20260922 }],
      asOf,
    });
    expect(next.daysOfCover).toBeCloseTo(2, 5);
    expect(next.stockoutAt).toBe(asOf + 2 * DAY_MS);
  });
});

describe("BOM burn and make demand", () => {
  it("stacks finished-good ship rate onto components without replacing their own rate", () => {
    const rates = new Map([
      ["lamp", 1.5],
      ["cord", 5],
    ]);
    const next = stackBomBurn(rates, [{ parentItemId: "lamp", componentItemId: "cord", qty: 1 }]);
    expect(next.get("cord")).toBeCloseTo(6.5, 5);
    expect(next.get("lamp")).toBeCloseTo(1.5, 5);
  });

  it("explodes remaining kit / work-order qty as committed component demand", () => {
    const remaining = new Map([["lamp", 4]]);
    const committed = explodeMakeDemand(remaining, [
      { parentItemId: "lamp", componentItemId: "cord", qty: 1 },
      { parentItemId: "lamp", componentItemId: "shade", qty: 1 },
    ]);
    expect(committed.get("cord")).toBe(4);
    expect(committed.get("shade")).toBe(4);
  });
});

describe("order-by, suggested qty, and status", () => {
  it("backs stockout up by lead time", () => {
    expect(orderByAt(asOf + 10 * DAY_MS, 7 * DAY_MS)).toBe(asOf + 3 * DAY_MS);
    expect(orderByAt(null, DEFAULT_LEAD_MS)).toBeNull();
  });

  it("ceils the gap to cover lead plus buffer minus sellable and inbound", () => {
    expect(suggestedRunwayQty({ rate: 5, leadDays: 7, bufferDays: 14, sellable: 25, inbound: 15 })).toBe(65);
    expect(suggestedRunwayQty({ rate: 2, leadDays: 7, bufferDays: 14, sellable: 50, inbound: 0 })).toBe(0);
    expect(suggestedRunwayQty({ rate: 0, leadDays: 7, sellable: 0, inbound: 0 })).toBe(0);
  });

  it("marks thin observed history and ranks risk ahead of thin", () => {
    expect(isThinHistory(2, "observed")).toBe(true);
    expect(isThinHistory(2, "baseline")).toBe(false);
    expect(
      runwayStatus({
        sellable: 10,
        rate: 5,
        asOf,
        stockoutAt: asOf + 2 * DAY_MS,
        orderByAt: asOf - DAY_MS,
        coveredByInbound: false,
        thin: true,
      }),
    ).toBe("order_now");
    expect(
      runwayStatus({
        sellable: 40,
        rate: 1,
        asOf,
        stockoutAt: asOf + 60 * DAY_MS,
        orderByAt: asOf + 53 * DAY_MS,
        coveredByInbound: false,
        thin: true,
      }),
    ).toBe("thin");
    expect(
      runwayStatus({
        sellable: 12,
        rate: 0,
        asOf,
        stockoutAt: null,
        orderByAt: null,
        coveredByInbound: false,
        thin: false,
      }),
    ).toBe("idle");
  });

  it("flags uncovered stockouts inside a week", () => {
    expect(runsOutThisWeek(asOf + 4 * DAY_MS, asOf)).toBe(true);
    expect(runsOutThisWeek(asOf + 10 * DAY_MS, asOf)).toBe(false);
    expect(runsOutThisWeek(null, asOf)).toBe(false);
  });
});

describe("buildRunwayBoard", () => {
  it("uses sellable qty, BOM burn, inbound cover, and skips open-PO SKUs on draft lines", () => {
    const board = buildRunwayBoard({
      asOf,
      window: "30d",
      multiplier: 1,
      boms: [{ parentItemId: "lamp", componentItemId: "cord", qty: 1 }],
      items: [
        {
          itemId: "cord",
          sku: "CORD",
          name: "Power cord",
          baselineShipRate: 5,
          onHand: 25,
          held: 0,
          remainingToPick: 0,
          unitsShipped: 2,
          shipDays: 1,
          inbound: [{ at: asOf + 7 * DAY_MS, qty: 15 }],
          lastVendorName: "Harbor Components",
          leadTimeMs: 7 * DAY_MS,
          coveredByOpenPo: true,
        },
        {
          itemId: "lamp",
          sku: "LAMP",
          name: "Desk lamp",
          baselineShipRate: 1.5,
          onHand: 10,
          held: 0,
          remainingToPick: 2,
          unitsShipped: 12,
          shipDays: 8,
          inbound: [],
          leadTimeMs: 7 * DAY_MS,
          coveredByOpenPo: false,
        },
        {
          itemId: "glue",
          sku: "GLUE",
          name: "Cyanoacrylate",
          trackExpiry: true,
          baselineShipRate: 1,
          onHand: 10,
          held: 0,
          remainingToPick: 0,
          lots: [
            { qty: 6, expiresOn: 20260901 },
            { qty: 4, expiresOn: 20261001 },
          ],
          unitsShipped: 0,
          shipDays: 0,
          inbound: [],
          leadTimeMs: 7 * DAY_MS,
          coveredByOpenPo: false,
        },
      ],
    });

    const cord = board.rows.find((row) => row.sku === "CORD")!;
    const lamp = board.rows.find((row) => row.sku === "LAMP")!;
    const glue = board.rows.find((row) => row.sku === "GLUE")!;

    expect(lamp.sellable).toBe(8);
    expect(cord.burnRate).toBeCloseTo(6.5, 5);
    expect(cord.rateSource).toBe("baseline");
    expect(cord.thin).toBe(false);
    expect(cord.coveredByOpenPo).toBe(true);
    expect(glue.sellable).toBe(4);

    const lines = buildRunwayDraftLines(board.rows, "Harbor Components");
    expect(lines.map((line) => line.sku)).not.toContain("CORD");
  });

  it("counts unique ship days in the window", () => {
    expect(countShipDays([asOf, asOf + 3_600_000, asOf + DAY_MS], asOf, asOf + 7 * DAY_MS)).toBe(2);
  });

  it("takes the median of positive lead samples", () => {
    expect(medianPositive([3 * DAY_MS, 7 * DAY_MS, 9 * DAY_MS], DEFAULT_LEAD_MS)).toBe(7 * DAY_MS);
    expect(medianPositive([], DEFAULT_LEAD_MS)).toBe(DEFAULT_LEAD_MS);
  });
});
