import { describe, expect, it } from "vitest";
import { rateActivity } from "./billing";

describe("rateActivity", () => {
  it("bills on-hand pieces, picked units, and shipped cartons", () => {
    expect(rateActivity({ storagePieces: 10, pickedUnits: 4, shippedCartons: 2 })).toEqual({
      lines: [
        { kind: "storage", label: "On-hand pieces", qty: 10, unitCents: 2, amountCents: 20 },
        { kind: "pick", label: "Picked units", qty: 4, unitCents: 25, amountCents: 100 },
        { kind: "carton", label: "Shipped cartons", qty: 2, unitCents: 150, amountCents: 300 },
      ],
      amountCents: 420,
    });
  });

  it("skips a client with no activity", () => {
    expect(rateActivity({ storagePieces: 0, pickedUnits: 0, shippedCartons: 0 })).toBeNull();
  });
});
