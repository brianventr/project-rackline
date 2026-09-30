import { describe, expect, it } from "vitest";
import type { StockedBay } from "./partial-pick";
import {
  canQuickShip,
  needsScanAtPick,
  planQuickShip,
  planQuickShipRestore,
  quickShipLabelBlocker,
  quickShipUndoNote,
  runQuickShip,
  summarizeQuickShip,
  type QuickShipLine,
  type QuickShipSnapshot,
  type QuickShipStep,
  type QuickShipUndone,
} from "./quick-ship";

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

  it("checks the label before any stock moves", () => {
    expect(quickShipLabelBlocker({ live: false, hasApiKey: false })).toBeNull();
    expect(quickShipLabelBlocker({ purchaseError: "Unknown carrier service", live: false, hasApiKey: false })).toEqual({
      status: 400,
      error: "Unknown carrier service",
    });
    expect(quickShipLabelBlocker({ live: true, hasApiKey: false })).toMatchObject({ status: 400, error: "Live postage needs an API key" });
    expect(
      quickShipLabelBlocker({ live: true, hasApiKey: true, shipFrom: { street1: "1 Main" }, shipTo: { error: "Needs a street" } }),
    ).toEqual({ status: 409, error: "Needs a street", code: "LIVE_ADDRESS" });
    expect(quickShipLabelBlocker({ live: true, hasApiKey: true, shipFrom: { street1: "1 Main" }, shipTo: { street1: "2 Elm" } })).toBeNull();
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

describe("quick ship run", () => {
  const cleanUndo: QuickShipUndone = { shipped: false, voidedLabel: false };

  function recorder(failAt?: string, failure = { status: 409, error: "Nope", code: "X" }) {
    const ran: string[] = [];
    const step = (id: QuickShipStep["id"], name: string = id): QuickShipStep => ({
      id,
      run: async () => {
        ran.push(name);
        return name === failAt ? failure : null;
      },
    });
    return { ran, step };
  }

  it("buys the label only after pick and pack, whatever order the steps arrive in", async () => {
    const { ran, step } = recorder();
    const result = await runQuickShip([step("ship"), step("label"), step("pack"), step("pick", "pick A"), step("pick", "pick B")], async () => cleanUndo);
    expect(result).toEqual({ ok: true });
    expect(ran).toEqual(["pick A", "pick B", "pack", "label", "ship"]);
  });

  it("stops at the first failure and undoes once", async () => {
    const { ran, step } = recorder("label", { status: 409, error: "Carrier rejected the address", code: "CARRIER_LIVE" });
    let undos = 0;
    const result = await runQuickShip([step("pick"), step("pack"), step("label"), step("ship")], async () => {
      undos += 1;
      return cleanUndo;
    });
    expect(ran).toEqual(["pick", "pack", "label"]);
    expect(undos).toBe(1);
    expect(result).toEqual({
      ok: false,
      step: "label",
      failure: {
        status: 409,
        code: "CARRIER_LIVE",
        error: "Carrier rejected the address. No label was bought. The order is back where it started.",
      },
    });
  });

  it("does not undo when nothing failed", async () => {
    const { step } = recorder();
    let undos = 0;
    await runQuickShip([step("pick"), step("ship")], async () => {
      undos += 1;
      return cleanUndo;
    });
    expect(undos).toBe(0);
  });

  it("treats a thrown step as a failure and still undoes", async () => {
    let undone = false;
    const result = await runQuickShip(
      [
        {
          id: "pack",
          run: async () => {
            throw new Error("D1 went away");
          },
        },
      ],
      async () => {
        undone = true;
        return { shipped: false, voidedLabel: false };
      },
    );
    expect(undone).toBe(true);
    expect(result).toMatchObject({ ok: false, step: "pack", failure: { status: 500 } });
    if (!result.ok) expect(result.failure.error).toMatch(/^D1 went away\. /);
  });

  it("counts the order as shipped when the ship went through despite an error", async () => {
    const { step } = recorder("ship", { status: 500, error: "Tracking post-back failed", code: "X" });
    expect(await runQuickShip([step("ship")], async () => ({ shipped: true }))).toEqual({ ok: true });
  });

  it("ends the step error as a sentence before the undo note", async () => {
    const { step } = recorder("pick", { status: 409, error: "Only 1 of 2 LAMP free to ship (bay A-01-01)", code: "X" });
    const result = await runQuickShip([step("pick")], async () => cleanUndo);
    if (result.ok) throw new Error("expected a failure");
    expect(result.failure.error).toBe("Only 1 of 2 LAMP free to ship (bay A-01-01). No label was bought. The order is back where it started.");
  });

  it("reports an undo that threw", async () => {
    const { step } = recorder("pick");
    const result = await runQuickShip([step("pick")], async () => {
      throw new Error("lock timeout");
    });
    if (result.ok) throw new Error("expected a failure");
    expect(result.failure.error).toMatch(/Pick and pack could not be undone \(lock timeout\)/);
  });

  it("says what the undo did", () => {
    expect(quickShipUndoNote({ shipped: false, voidedLabel: true })).toBe("The label was voided. The order is back where it started.");
    expect(quickShipUndoNote({ shipped: false, voidedLabel: false, voidError: "Too late to void" })).toBe(
      "The label could not be voided (Too late to void), so void it on the order. The order is back where it started.",
    );
    expect(quickShipUndoNote({ shipped: false, voidedLabel: true, restoreError: "busy" })).toBe(
      "The label was voided. Pick and pack could not be undone (busy), so unpick the order before shipping again.",
    );
  });
});

describe("quick ship restore", () => {
  const snapshot: QuickShipSnapshot = {
    startedAt: 1,
    status: "open",
    pickedAt: null,
    packedAt: null,
    pickLocationId: null,
    hadLabel: false,
    label: {
      labelStatus: "none",
      trackingNumber: null,
      trackingCompany: null,
      trackingUrl: null,
      carrierService: "ups_ground",
      carrierConnectionId: null,
      carrierShipmentId: null,
      carrierLabelId: null,
      postageCents: null,
      trackerStatus: null,
      trackerUpdatedAt: null,
      packageWeightOz: null,
      packageLengthIn: null,
      packageWidthIn: null,
      packageHeightIn: null,
    },
    lines: [
      { id: "l1", qtyPicked: 0, qtyPacked: 0 },
      { id: "l2", qtyPicked: 1, qtyPacked: 0 },
    ],
    allocations: [{ id: "keep", qty: 2 }],
  };

  it("unpicks and unpacks only what the run did and resets reservations", () => {
    const plan = planQuickShipRestore(snapshot, {
      status: "packed",
      labelStatus: "purchased",
      trackingNumber: "1Z999",
      lines: [
        { id: "l1", qtyPicked: 2, qtyPacked: 2 },
        { id: "l2", qtyPicked: 3, qtyPacked: 3 },
      ],
      allocations: [{ id: "new", qty: 1 }],
    });
    expect(plan).toEqual({
      shipped: false,
      voidLabel: true,
      unpick: [
        { lineId: "l1", qty: 2 },
        { lineId: "l2", qty: 2 },
      ],
      lines: [
        { lineId: "l1", qtyPicked: 0, qtyPacked: 0 },
        { lineId: "l2", qtyPicked: 1, qtyPacked: 0 },
      ],
      releaseAllocationIds: ["new"],
      resetAllocations: [{ id: "keep", qty: 2 }],
      restoreOrder: true,
    });
  });

  it("only unpacks when the order was already picked", () => {
    const picked: QuickShipSnapshot = {
      ...snapshot,
      status: "picked",
      lines: [{ id: "l1", qtyPicked: 2, qtyPacked: 0 }],
      allocations: [],
    };
    const plan = planQuickShipRestore(picked, {
      status: "packed",
      labelStatus: null,
      trackingNumber: null,
      lines: [{ id: "l1", qtyPicked: 2, qtyPacked: 2 }],
      allocations: [],
    });
    expect(plan.unpick).toEqual([]);
    expect(plan.lines).toEqual([{ lineId: "l1", qtyPicked: 2, qtyPacked: 0 }]);
    expect(plan.voidLabel).toBe(false);
    expect(plan.restoreOrder).toBe(true);
  });

  it("keeps a label the order had before and never raises a count", () => {
    const plan = planQuickShipRestore(
      { ...snapshot, hadLabel: true, lines: [{ id: "l1", qtyPicked: 2, qtyPacked: 2 }] },
      {
        status: "packing",
        labelStatus: "purchased",
        trackingNumber: "1Z1",
        lines: [{ id: "l1", qtyPicked: 1, qtyPacked: 1 }],
        allocations: [{ id: "keep", qty: 2 }],
      },
    );
    expect(plan.voidLabel).toBe(false);
    expect(plan.unpick).toEqual([]);
    expect(plan.lines).toEqual([]);
    expect(plan.resetAllocations).toEqual([]);
  });

  it("leaves a shipped order alone", () => {
    const plan = planQuickShipRestore(snapshot, {
      status: "shipped",
      labelStatus: "purchased",
      trackingNumber: "1Z1",
      lines: [{ id: "l1", qtyPicked: 2, qtyPacked: 2 }],
      allocations: [],
    });
    expect(plan).toMatchObject({ shipped: true, voidLabel: false, unpick: [], restoreOrder: false });
  });

  it("does nothing when the first step failed before changing anything", () => {
    const plan = planQuickShipRestore(snapshot, {
      status: "open",
      labelStatus: null,
      trackingNumber: null,
      lines: snapshot.lines,
      allocations: snapshot.allocations,
    });
    expect(plan).toMatchObject({ voidLabel: false, unpick: [], lines: [], releaseAllocationIds: [], resetAllocations: [], restoreOrder: false });
  });
});
