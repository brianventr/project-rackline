import { describe, expect, it } from "vitest";
import type { StockedBay } from "./partial-pick";
import { canQuickShip, needsScanAtPick, planQuickShip, summarizeQuickShip, type QuickShipLine } from "./quick-ship";

function bay(locationId: string, qty: number, extra: Partial<StockedBay> = {}): StockedBay {
  return { locationId, locationCode: locationId.toUpperCase(), locationName: locationId, barcode: locationId, qty, ...extra };
}

function line(id: string, itemId: string, qty: number, extra: Partial<QuickShipLine> = {}): QuickShipLine {
  return { id, itemId, sku: itemId.toUpperCase(), qty, qtyPicked: 0, qtyPacked: 0, ...extra };
}

describe("quick ship", () => {
  it("allows every status from open to packed", () => {
    for (const status of ["draft", "open", "picking", "picked", "packing", "packed"]) expect(canQuickShip(status)).toBe(true);
    expect(canQuickShip("shipped")).toBe(false);
    expect(canQuickShip("cancelled")).toBe(false);
  });

  it("picks each line from the suggested bay and groups picks by bay", () => {
    const plan = planQuickShip(
      { status: "open", packageCount: 0, lines: [line("l1", "a", 2), line("l2", "b", 1)] },
      new Map([
        ["a", [bay("shelf-1", 5, { slotRole: "pick" })]],
        ["b", [bay("shelf-1", 1, { slotRole: "pick" })]],
      ]),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.picks).toEqual([
      { locationId: "shelf-1", locationCode: "SHELF-1", lines: [{ lineId: "l1", qty: 2 }, { lineId: "l2", qty: 1 }] },
    ]);
    expect(plan.pickDone).toBe(false);
    expect(plan.packNeeded).toBe(true);
  });

  it("splits a line across bays when no single bay has enough", () => {
    const plan = planQuickShip(
      { status: "open", packageCount: 0, lines: [line("l1", "a", 5)] },
      new Map([["a", [bay("pick", 3, { slotRole: "pick" }), bay("bulk", 10, { type: "storage" })]]]),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const total = plan.picks.flatMap((pick) => pick.lines).reduce((sum, row) => sum + row.qty, 0);
    expect(total).toBe(5);
  });

  it("does not double-count stock shared by two lines of the same SKU", () => {
    const plan = planQuickShip(
      { status: "open", packageCount: 0, lines: [line("l1", "a", 3), line("l2", "a", 3)] },
      new Map([["a", [bay("shelf", 4)]]]),
    );
    expect(plan).toMatchObject({ ok: false, code: "INSUFFICIENT_ATP", sku: "A" });
  });

  it("only picks what is left and skips picking when the order is already picked", () => {
    const plan = planQuickShip(
      { status: "picked", packageCount: 0, lines: [line("l1", "a", 2, { qtyPicked: 2 })] },
      new Map(),
    );
    expect(plan).toEqual({ ok: true, picks: [], pickDone: true, packNeeded: true });
    const packed = planQuickShip(
      { status: "packed", packageCount: 0, lines: [line("l1", "a", 2, { qtyPicked: 2, qtyPacked: 2 })] },
      new Map(),
    );
    expect(packed).toEqual({ ok: true, picks: [], pickDone: true, packNeeded: false });
  });

  it("refuses catch-weight SKUs, boxed orders, and closed orders", () => {
    expect(needsScanAtPick({ catchWeight: true })).toBe(true);
    expect(needsScanAtPick({})).toBe(false);
    expect(
      planQuickShip({ status: "open", packageCount: 0, lines: [line("l1", "a", 1, { catchWeight: true })] }, new Map()),
    ).toMatchObject({ ok: false, code: "NEED_SCAN", sku: "A" });
    expect(
      planQuickShip({ status: "open", packageCount: 0, lines: [line("l1", "a", 1, { catchWeight: true, qtyPicked: 1 })] }, new Map()),
    ).toMatchObject({ ok: true });
    expect(
      planQuickShip(
        { status: "open", packageCount: 0, lines: [line("l1", "a", 1, { trackLot: true, trackSerial: true, trackExpiry: true })] },
        new Map([["a", [bay("shelf", 1)]]]),
      ),
    ).toMatchObject({ ok: true });
    expect(planQuickShip({ status: "packing", packageCount: 1, lines: [] }, new Map())).toMatchObject({
      code: "NEED_CARTON_FLOW",
    });
    expect(planQuickShip({ status: "shipped", packageCount: 0, lines: [] }, new Map())).toMatchObject({ code: "NOT_SHIPPABLE" });
  });

  it("counts shipped and failed orders", () => {
    expect(
      summarizeQuickShip([
        { orderId: "o1", ok: true, number: "ORD-1", trackingNumber: "1Z" },
        { orderId: "o2", ok: false, status: 409, code: "NEED_SCAN", error: "scan" },
      ]),
    ).toEqual({ shipped: 1, failed: 1, total: 2 });
  });
});

describe("quick ship helpers", () => {
  it("adds an order's own reservations back to the bays it can ship from", async () => {
    const { withOwnReservations } = await import("./quick-ship");
    const bays = new Map([["a", [bay("shelf", 1)]]]);
    const next = withOwnReservations(bays, [
      { itemId: "a", locationId: "shelf", locationCode: "SHELF", qty: 2 },
      { itemId: "b", locationId: "bin", locationCode: "BIN", qty: 1 },
    ]);
    expect(next.get("a")![0]!.qty).toBe(3);
    expect(next.get("b")![0]!.qty).toBe(1);
    expect(bays.get("a")![0]!.qty).toBe(1);
  });

  it("lists the four setup steps in order", async () => {
    const { shipSetupSteps } = await import("./quick-ship");
    const steps = shipSetupSteps({ storeConnected: true, carrierConnected: false, hasShipFrom: true, hasBox: false });
    expect(steps.map((row) => [row.id, row.done])).toEqual([
      ["store", true],
      ["carrier", false],
      ["ship-from", true],
      ["box", false],
    ]);
  });
});
