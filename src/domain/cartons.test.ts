import { describe, expect, it } from "vitest";
import {
  OverCartonError,
  applyCarton,
  cartonNumber,
  cartonShipGate,
  hasUncartoned,
  isFullyCartoned,
  orderLevelLabelGate,
  remainingToCarton,
  asnCartonReceiveGate,
  asnCartonPutawayGate,
  canPutawayAsnCarton,
} from "./cartons";

const lamps = { lineId: "l1", sku: "LAMP", qtyPacked: 2, qtyCartoned: 0 };
const shades = { lineId: "l2", sku: "SHADE", qtyPacked: 4, qtyCartoned: 0 };

describe("cartons", () => {
  it("numbers boxes BOX-n", () => {
    expect(cartonNumber(1)).toBe("BOX-1");
    expect(cartonNumber(2)).toBe("BOX-2");
  });

  it("posts a short carton and leaves remainder", () => {
    const first = applyCarton([lamps, shades], [{ lineId: "l1", qty: 1 }]);
    expect(first.posted).toEqual([{ lineId: "l1", qty: 1 }]);
    expect(remainingToCarton(first.next[0]!)).toBe(1);
    expect(hasUncartoned(first.next)).toBe(true);
    expect(isFullyCartoned(first.next)).toBe(false);

    const rest = applyCarton(first.next, [
      { lineId: "l1", qty: 1 },
      { lineId: "l2", qty: 4 },
    ]);
    expect(isFullyCartoned(rest.next)).toBe(true);
    expect(hasUncartoned(rest.next)).toBe(false);
  });

  it("rejects an over-carton against remaining packed qty", () => {
    expect(() => applyCarton([lamps], [{ lineId: "l1", qty: 3 }])).toThrow(OverCartonError);
    expect(() => applyCarton([lamps], [{ lineId: "missing", qty: 1 }])).toThrow(/not on this document/);
    expect(() => applyCarton([lamps], [])).toThrow(/At least one/);
  });

  it("lets ship skip cartons until the first box exists", () => {
    expect(cartonShipGate({ packedUnits: 2, packages: [] })).toEqual({ ok: true });
    expect(orderLevelLabelGate(0)).toEqual({ ok: true });
    expect(orderLevelLabelGate(2).ok).toBe(false);
    expect(
      cartonShipGate({
        packedUnits: 2,
        packages: [{ units: 1, trackingNumber: "RL-1" }],
      }),
    ).toMatchObject({ ok: false, code: "NEED_PACKAGE" });
    expect(
      cartonShipGate({
        packedUnits: 2,
        packages: [
          { units: 1, trackingNumber: "RL-1" },
          { units: 1, trackingNumber: null },
        ],
      }),
    ).toMatchObject({ ok: false, code: "NEED_PACKAGE" });
    expect(
      cartonShipGate({
        packedUnits: 2,
        packages: [
          { units: 1, trackingNumber: "RL-1" },
          { units: 1, trackingNumber: "RL-2" },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it("requires carton receive once the first vendor box exists", () => {
    expect(asnCartonReceiveGate(0)).toEqual({ ok: true });
    expect(asnCartonReceiveGate(2)).toMatchObject({ ok: false, code: "NEED_PACKAGE" });
  });

  it("requires carton putaway once a received vendor box is waiting", () => {
    expect(asnCartonPutawayGate(0)).toEqual({ ok: true });
    expect(asnCartonPutawayGate(1)).toMatchObject({ ok: false, code: "NEED_PACKAGE" });
    expect(canPutawayAsnCarton({ receivedAt: null, putawayAt: null })).toMatchObject({
      ok: false,
      code: "NOT_RECEIVED",
    });
    expect(canPutawayAsnCarton({ receivedAt: 1, putawayAt: 2 })).toMatchObject({
      ok: false,
      code: "ALREADY_PUTAWAY",
    });
    expect(canPutawayAsnCarton({ receivedAt: 1, putawayAt: null })).toEqual({ ok: true });
  });
});
