import { describe, expect, it } from "vitest";
import { BomCycleError, explodeBom, madeComponentShortfalls } from "./nested-bom";

describe("explodeBom", () => {
  it("walks a two-level recipe and multiplies qty", () => {
    const lines = explodeBom({
      itemId: "lamp",
      qty: 2,
      boms: [
        {
          itemId: "lamp",
          lines: [
            { itemId: "shade", qty: 1 },
            { itemId: "base", qty: 2 },
          ],
        },
        { itemId: "shade", lines: [{ itemId: "fabric", qty: 3 }] },
      ],
    });
    expect(lines).toEqual([
      { itemId: "shade", qty: 2, depth: 1, parentItemId: "lamp" },
      { itemId: "fabric", qty: 6, depth: 2, parentItemId: "shade" },
      { itemId: "base", qty: 4, depth: 1, parentItemId: "lamp" },
    ]);
  });

  it("returns a cycle error instead of looping", () => {
    expect(() =>
      explodeBom({
        itemId: "a",
        qty: 1,
        boms: [
          { itemId: "a", lines: [{ itemId: "b", qty: 1 }] },
          { itemId: "b", lines: [{ itemId: "a", qty: 1 }] },
        ],
      }),
    ).toThrow(BomCycleError);
    try {
      explodeBom({
        itemId: "a",
        qty: 1,
        boms: [
          { itemId: "a", lines: [{ itemId: "b", qty: 1 }] },
          { itemId: "b", lines: [{ itemId: "a", qty: 1 }] },
        ],
      });
    } catch (err) {
      expect(err).toBeInstanceOf(BomCycleError);
      expect((err as Error).message).toBe("Recipe cycle: a → b → a");
    }
  });
});

describe("madeComponentShortfalls", () => {
  it("reports only made components that are short", () => {
    const shorts = madeComponentShortfalls({
      lines: [
        { itemId: "shade", sku: "SHADE", qty: 1 },
        { itemId: "cord", sku: "CORD", qty: 1 },
      ],
      madeItemIds: new Set(["shade"]),
      produceQty: 4,
      onHandByItem: new Map([
        ["shade", 1],
        ["cord", 0],
      ]),
    });
    expect(shorts).toEqual([{ itemId: "shade", sku: "SHADE", needed: 4, onHand: 1, shortQty: 3 }]);
  });
});
