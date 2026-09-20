import { describe, expect, it } from "vitest";
import {
  allocateBatchPick,
  buildBatchLines,
  isBatchFullyPicked,
  OverBatchPickError,
  remainingOnBatchLine,
  waveOrdersComplete,
} from "./waves";

describe("waves / batch", () => {
  const lines = [
    { orderId: "o1", orderLineId: "l1", itemId: "bulb", sku: "LED-BULB", remaining: 4 },
    { orderId: "o2", orderLineId: "l2", itemId: "bulb", sku: "LED-BULB", remaining: 6 },
    { orderId: "o2", orderLineId: "l3", itemId: "shade", sku: "SHADE", remaining: 2 },
  ];

  it("consolidates remaining qty by SKU", () => {
    expect(buildBatchLines(lines)).toEqual([
      { itemId: "bulb", sku: "LED-BULB", qty: 10, orderLineIds: ["l1", "l2"] },
      { itemId: "shade", sku: "SHADE", qty: 2, orderLineIds: ["l3"] },
    ]);
  });

  it("spreads a batch pick across orders FIFO", () => {
    expect(allocateBatchPick(lines, "bulb", 5)).toEqual([
      { orderId: "o1", orderLineId: "l1", itemId: "bulb", sku: "LED-BULB", qty: 4 },
      { orderId: "o2", orderLineId: "l2", itemId: "bulb", sku: "LED-BULB", qty: 1 },
    ]);
  });

  it("rejects over-batch-pick", () => {
    expect(() => allocateBatchPick(lines, "bulb", 11)).toThrow(OverBatchPickError);
  });

  it("tracks batch line remaining", () => {
    expect(remainingOnBatchLine({ qty: 10, qtyPicked: 3 })).toBe(7);
    expect(isBatchFullyPicked([{ qty: 10, qtyPicked: 10 }])).toBe(true);
    expect(isBatchFullyPicked([{ qty: 10, qtyPicked: 9 }])).toBe(false);
  });

  it("knows when wave orders are past pick", () => {
    expect(waveOrdersComplete([{ status: "picked" }, { status: "packing" }])).toBe(true);
    expect(waveOrdersComplete([{ status: "picking" }, { status: "picked" }])).toBe(false);
    expect(waveOrdersComplete([])).toBe(false);
  });
});
