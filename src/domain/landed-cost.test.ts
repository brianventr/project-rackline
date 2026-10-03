import { describe, expect, it } from "vitest";
import { landedUnitCosts, weightedUnitCost } from "./landed-cost";

describe("landed cost", () => {
  it("spreads freight by extended cost and keeps the unit cost when freight is zero", () => {
    expect(
      landedUnitCosts({
        freightCents: 100,
        lines: [
          { itemId: "a", qty: 10, unitCostCents: 100 },
          { itemId: "b", qty: 5, unitCostCents: 100 },
        ],
      }),
    ).toEqual([
      { itemId: "a", unitCents: 106 },
      { itemId: "b", unitCents: 106 },
    ]);
    expect(landedUnitCosts({ freightCents: 0, lines: [{ itemId: "a", qty: 2, unitCostCents: 50 }] })).toEqual([
      { itemId: "a", unitCents: 50 },
    ]);
  });

  it("spreads a free purchase by quantity", () => {
    expect(
      landedUnitCosts({
        freightCents: 9,
        lines: [
          { itemId: "a", qty: 1, unitCostCents: 0 },
          { itemId: "b", qty: 2, unitCostCents: 0 },
        ],
      }).map((row) => row.unitCents),
    ).toEqual([3, 3]);
  });

  it("averages the receipt into what is already on the shelf", () => {
    expect(weightedUnitCost({ onHand: 10, oldUnitCents: 100, received: 10, receivedUnitCents: 200 })).toBe(150);
    expect(weightedUnitCost({ onHand: 0, oldUnitCents: 0, received: 4, receivedUnitCents: 125 })).toBe(125);
  });
});