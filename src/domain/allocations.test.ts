import { describe, expect, it } from "vitest";
import {
  allocatedQtyAt,
  applyAllocationsToOnHand,
  assertAtpForMove,
  atpQty,
  consumeAllocations,
  InsufficientAtpError,
  isAtpRestrictedType,
  planAllocations,
} from "./allocations";
import type { StockedBay } from "./partial-pick";

const pickFace: StockedBay = {
  locationId: "a0102",
  locationCode: "A-01-02",
  locationName: "Pick",
  barcode: "A-01-02",
  qty: 6,
  type: "storage",
  slotRole: "pick",
};

const bulk: StockedBay = {
  locationId: "a0101",
  locationCode: "A-01-01",
  locationName: "Bulk",
  barcode: "A-01-01",
  qty: 40,
  type: "storage",
  slotRole: "bulk",
};

describe("isAtpRestrictedType", () => {
  it("blocks pick/move/kit/wo consume", () => {
    expect(isAtpRestrictedType("pick")).toBe(true);
    expect(isAtpRestrictedType("move")).toBe(true);
    expect(isAtpRestrictedType("rtv")).toBe(true);
    expect(isAtpRestrictedType("receive")).toBe(false);
    expect(isAtpRestrictedType("ship")).toBe(false);
    expect(isAtpRestrictedType("scrap")).toBe(false);
  });
});

describe("atpQty", () => {
  it("subtracts allocated from on-hand", () => {
    expect(atpQty(10, 6)).toBe(4);
    expect(atpQty(6, 6)).toBe(0);
    expect(atpQty(4, 6)).toBe(0);
  });
});

describe("applyAllocationsToOnHand", () => {
  it("leaves this order's reserved qty visible when excluded", () => {
    const rows = [
      { locationId: "a0102", itemId: "lamp", qty: 6 },
      { locationId: "a0101", itemId: "lamp", qty: 40 },
    ];
    const allocs = [{ locationId: "a0102", itemId: "lamp", qty: 6, orderId: "ord-a" }];
    const others = applyAllocationsToOnHand(rows, allocs);
    expect(others.find((row) => row.locationId === "a0102")?.qty).toBe(0);
    const self = applyAllocationsToOnHand(rows, allocs, "ord-a");
    expect(self.find((row) => row.locationId === "a0102")?.qty).toBe(6);
  });
});

describe("planAllocations", () => {
  it("fills the pick face then bulk", () => {
    const { drafts, short } = planAllocations({
      lines: [{ lineId: "l1", itemId: "lamp", sku: "LAMP", remaining: 8 }],
      baysByItem: new Map([["lamp", [pickFace, bulk]]]),
    });
    expect(short).toEqual([]);
    expect(drafts).toEqual([
      {
        orderLineId: "l1",
        locationId: "a0102",
        locationCode: "A-01-02",
        itemId: "lamp",
        sku: "LAMP",
        qty: 6,
      },
      {
        orderLineId: "l1",
        locationId: "a0101",
        locationCode: "A-01-01",
        itemId: "lamp",
        sku: "LAMP",
        qty: 2,
      },
    ]);
  });

  it("does not let a second order take reserved ATP", () => {
    const first = planAllocations({
      lines: [{ lineId: "l1", itemId: "lamp", sku: "LAMP", remaining: 6 }],
      baysByItem: new Map([["lamp", [pickFace]]]),
    });
    expect(first.short).toEqual([]);
    const after = applyAllocationsToOnHand(
      [{ locationId: "a0102", itemId: "lamp", qty: 6, locationCode: "A-01-02", locationName: "Pick", barcode: "A-01-02", type: "storage", slotRole: "pick" }],
      first.drafts.map((row) => ({ ...row, orderId: "ord-a" })),
    );
    const second = planAllocations({
      lines: [{ lineId: "l2", itemId: "lamp", sku: "LAMP", remaining: 1 }],
      baysByItem: new Map([["lamp", after]]),
    });
    expect(second.drafts).toEqual([]);
    expect(second.short[0]).toEqual({ sku: "LAMP", remaining: 1, atp: 0 });
  });
});

describe("consumeAllocations", () => {
  it("burns the pick-bay reservation first", () => {
    const updates = consumeAllocations(
      [
        {
          id: "a1",
          orderId: "ord",
          orderLineId: "l1",
          locationId: "a0102",
          locationCode: "A-01-02",
          itemId: "lamp",
          sku: "LAMP",
          qty: 6,
        },
      ],
      "l1",
      "a0102",
      2,
    );
    expect(updates).toEqual([{ id: "a1", qty: 4 }]);
  });

  it("releases another bay when the floor picks elsewhere", () => {
    const updates = consumeAllocations(
      [
        {
          id: "a1",
          orderId: "ord",
          orderLineId: "l1",
          locationId: "a0102",
          locationCode: "A-01-02",
          itemId: "lamp",
          sku: "LAMP",
          qty: 6,
        },
      ],
      "l1",
      "a0101",
      2,
    );
    expect(updates).toEqual([{ id: "a1", qty: 4 }]);
  });
});

describe("assertAtpForMove", () => {
  it("409s when the move would steal a reservation", () => {
    expect(() => assertAtpForMove(10, 6, 5, "LAMP", "A-01-02")).toThrow(InsufficientAtpError);
    expect(() => assertAtpForMove(10, 6, 4, "LAMP", "A-01-02")).not.toThrow();
  });
});

describe("allocatedQtyAt", () => {
  it("sums other orders only", () => {
    const rows = [
      { locationId: "a", itemId: "lamp", qty: 2, orderId: "one" },
      { locationId: "a", itemId: "lamp", qty: 3, orderId: "two" },
    ];
    expect(allocatedQtyAt(rows, "a", "lamp")).toBe(5);
    expect(allocatedQtyAt(rows, "a", "lamp", "one")).toBe(3);
  });
});
