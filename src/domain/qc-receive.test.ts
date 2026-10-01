import { describe, expect, it } from "vitest";
import {
  QcSampleError,
  applyOpenQcToOnHand,
  normalizeQcSamplePercent,
  qcDecisionEffect,
  qcReceiveSplit,
  qcSampleQty,
} from "./qc-receive";

describe("qc sample split", () => {
  it("treats null and 0 as off, and 100 as every unit", () => {
    expect(qcSampleQty("line-1", 8, null)).toBe(0);
    expect(qcSampleQty("line-1", 8, 0)).toBe(0);
    expect(qcReceiveSplit("line-1", 8, null)).toEqual({
      onHandQty: 8,
      availableQty: 8,
      sampleQty: 0,
      plateQty: 8,
    });
    expect(qcReceiveSplit("line-1", 8, 100)).toEqual({
      onHandQty: 8,
      availableQty: 0,
      sampleQty: 8,
      plateQty: 0,
    });
  });

  it("chooses the same units from the receipt line id, not Math.random", () => {
    expect(qcSampleQty("line-a", 10, 50)).toBe(5);
    expect(qcSampleQty("line-a", 10, 50)).toBe(5);
    expect(qcSampleQty("line-b", 10, 50)).toBe(3);
  });

  it("keeps sampled units off the plate so they are on hand once", () => {
    const split = qcReceiveSplit("line-a", 10, 100);
    expect(split.onHandQty).toBe(10);
    expect(split.plateQty).toBe(0);
    expect(split.sampleQty).toBe(split.onHandQty - split.availableQty);
  });

  it("rejects a percent outside 0 to 100", () => {
    expect(normalizeQcSamplePercent(null)).toBeNull();
    expect(normalizeQcSamplePercent("")).toBeNull();
    expect(normalizeQcSamplePercent(0)).toBe(0);
    expect(normalizeQcSamplePercent(100)).toBe(100);
    expect(() => normalizeQcSamplePercent(101)).toThrow(QcSampleError);
    expect(() => normalizeQcSamplePercent(1.5)).toThrow(QcSampleError);
  });
});

describe("qc decision stock effect", () => {
  it("restocks without receiving the units again", () => {
    expect(qcDecisionEffect("restock", 4)).toEqual({
      onHandDelta: 0,
      availableDelta: 4,
      adjustmentQty: 0,
      createsHold: false,
    });
  });

  it("holds without a second on-hand post", () => {
    expect(qcDecisionEffect("hold", 4)).toEqual({
      onHandDelta: 0,
      availableDelta: 0,
      adjustmentQty: 0,
      createsHold: true,
    });
  });

  it("scraps once", () => {
    expect(qcDecisionEffect("scrap", 4)).toEqual({
      onHandDelta: -4,
      availableDelta: 0,
      adjustmentQty: -4,
      createsHold: false,
    });
  });
});

describe("applyOpenQcToOnHand", () => {
  it("holds sampled units back and does not subtract a closed sample", () => {
    const rows = [{ locationId: "dock", itemId: "bulb", qty: 10 }];
    expect(applyOpenQcToOnHand(rows, [{ locationId: "dock", itemId: "bulb", qty: 10 }])).toEqual([
      { locationId: "dock", itemId: "bulb", qty: 0 },
    ]);
    expect(applyOpenQcToOnHand(rows, [])).toEqual(rows);
    expect(applyOpenQcToOnHand(rows, [{ locationId: "dock", itemId: "bulb", qty: 3 }])[0]?.qty).toBe(7);
  });

  it("does not drive available below zero when the reservation is larger than on hand", () => {
    expect(applyOpenQcToOnHand([{ locationId: "dock", itemId: "bulb", qty: 2 }], [{ locationId: "dock", itemId: "bulb", qty: 5 }])[0]?.qty).toBe(0);
  });
});
