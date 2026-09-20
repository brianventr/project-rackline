import { describe, expect, it } from "vitest";
import {
  OverMoveError,
  applyPartialMove,
  hasUnmoved,
  isFullyMoved,
  remainingToMove,
} from "./partial-transfer";

const shades = { lineId: "l1", sku: "SHADE", qtyExpected: 8, qtyMoved: 0 };
const bases = { lineId: "l2", sku: "BASE", qtyExpected: 6, qtyMoved: 0 };

describe("partial transfer", () => {
  it("posts a short move and leaves remainder", () => {
    const first = applyPartialMove([shades, bases], [{ lineId: "l1", qty: 3 }]);
    expect(first.posted).toEqual([{ lineId: "l1", qty: 3 }]);
    expect(remainingToMove(first.next[0]!)).toBe(5);
    expect(hasUnmoved(first.next)).toBe(true);
    expect(isFullyMoved(first.next)).toBe(false);

    const rest = applyPartialMove(first.next, [
      { lineId: "l1", qty: 5 },
      { lineId: "l2", qty: 6 },
    ]);
    expect(isFullyMoved(rest.next)).toBe(true);
    expect(hasUnmoved(rest.next)).toBe(false);
  });

  it("rejects an over-move against remaining qty", () => {
    expect(() => applyPartialMove([shades], [{ lineId: "l1", qty: 9 }])).toThrow(OverMoveError);
    expect(() => applyPartialMove([shades], [{ lineId: "nope", qty: 1 }])).toThrow(/not on this transfer/);
    expect(() => applyPartialMove([shades], [])).toThrow(/At least one/);
  });

  it("cannot move more than the ticket expected", () => {
    const first = applyPartialMove([shades], [{ lineId: "l1", qty: 8 }]);
    expect(isFullyMoved(first.next)).toBe(true);
    expect(() => applyPartialMove(first.next, [{ lineId: "l1", qty: 1 }])).toThrow(OverMoveError);
  });
});
