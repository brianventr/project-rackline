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

  it("uses a client override and falls back to the org rate when a field is null", () => {
    const org = { storageCentsPerPiece: 2, pickCentsPerUnit: 25, cartonCents: 150 };
    expect(
      rateActivity(
        { storagePieces: 1, pickedUnits: 2, shippedCartons: 1 },
        org,
        { storageCentsPerPiece: null, pickCentsPerUnit: 40, cartonCents: null },
      ),
    ).toEqual({
      lines: [
        { kind: "storage", label: "On-hand pieces", qty: 1, unitCents: 2, amountCents: 2 },
        { kind: "pick", label: "Picked units", qty: 2, unitCents: 40, amountCents: 80 },
        { kind: "carton", label: "Shipped cartons", qty: 1, unitCents: 150, amountCents: 150 },
      ],
      amountCents: 232,
    });
  });

  it("keeps a zero pick rate instead of falling back to 25¢", () => {
    const rated = rateActivity(
      { storagePieces: 1, pickedUnits: 4, shippedCartons: 0 },
      { storageCentsPerPiece: 2, pickCentsPerUnit: 25, cartonCents: 150 },
      { storageCentsPerPiece: null, pickCentsPerUnit: 0, cartonCents: null },
    );
    expect(rated?.lines.map((line) => [line.kind, line.unitCents])).toEqual([
      ["storage", 2],
      ["pick", 0],
    ]);
  });
});
