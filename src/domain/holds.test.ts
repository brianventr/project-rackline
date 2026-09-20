import { describe, expect, it } from "vitest";
import {
  applyHoldsToOnHand,
  availableQty,
  blocksLocationItem,
  blocksLot,
  coveringHold,
  holdLabel,
  holdScope,
  isHoldRestrictedType,
  matchingHoldForMove,
  unheldLots,
} from "./holds";

const bay = {
  id: "h1",
  number: "HLD-1",
  reason: "QC",
  locationId: "a0102",
  locationCode: "A-01-02",
  itemId: null,
  sku: null,
  lotCode: null,
};

const sku = {
  ...bay,
  id: "h2",
  number: "HLD-2",
  itemId: "bulb",
  sku: "LED-BULB",
};

const lot = {
  ...sku,
  id: "h3",
  number: "HLD-3",
  lotCode: "LOT-2026-A",
};

describe("holdScope", () => {
  it("is bay, sku, or lot", () => {
    expect(holdScope(bay)).toBe("bay");
    expect(holdScope(sku)).toBe("sku");
    expect(holdScope(lot)).toBe("lot");
  });
});

describe("blocksLocationItem", () => {
  it("bay hold locks every SKU in the bay", () => {
    expect(blocksLocationItem(bay, "a0102", "bulb")).toBe(true);
    expect(blocksLocationItem(bay, "a0101", "bulb")).toBe(false);
  });

  it("sku hold locks that SKU only", () => {
    expect(blocksLocationItem(sku, "a0102", "bulb")).toBe(true);
    expect(blocksLocationItem(sku, "a0102", "shade")).toBe(false);
  });

  it("lot hold does not zero the whole SKU", () => {
    expect(blocksLocationItem(lot, "a0102", "bulb")).toBe(false);
    expect(blocksLot(lot, "a0102", "bulb", "LOT-2026-A")).toBe(true);
    expect(blocksLot(lot, "a0102", "bulb", "LOT-2026-B")).toBe(false);
  });
});

describe("coveringHold", () => {
  it("treats a bay hold as covering a new SKU hold", () => {
    expect(coveringHold([bay], "a0102", "bulb", null)?.number).toBe("HLD-1");
  });

  it("does not treat a SKU hold as covering a whole-bay hold", () => {
    expect(coveringHold([sku], "a0102", null, null)).toBeNull();
  });

  it("treats a SKU hold as covering a lot hold on that SKU", () => {
    expect(coveringHold([sku], "a0102", "bulb", "LOT-2026-A")?.number).toBe("HLD-2");
  });
});

describe("availableQty", () => {
  it("zeros a SKU or bay hold and subtracts held lots", () => {
    expect(availableQty(6, [sku], "a0102", "bulb")).toBe(0);
    expect(availableQty(40, [lot], "a0102", "bulb", 25)).toBe(15);
    expect(availableQty(40, [], "a0102", "bulb", 0)).toBe(40);
  });
});

describe("applyHoldsToOnHand", () => {
  it("filters pick-face qty", () => {
    const next = applyHoldsToOnHand(
      [
        { locationId: "a0102", itemId: "bulb", qty: 6 },
        { locationId: "a0101", itemId: "bulb", qty: 40 },
      ],
      [sku],
    );
    expect(next.find((row) => row.locationId === "a0102")?.qty).toBe(0);
    expect(next.find((row) => row.locationId === "a0101")?.qty).toBe(40);
  });
});

describe("unheldLots", () => {
  it("drops the held lot for FIFO", () => {
    expect(
      unheldLots(
        [
          { lotCode: "LOT-2026-A", qty: 25 },
          { lotCode: "LOT-2026-B", qty: 15 },
        ],
        [lot],
        "a0102",
        "bulb",
      ).map((row) => row.lotCode),
    ).toEqual(["LOT-2026-B"]);
  });
});

describe("matchingHoldForMove", () => {
  it("matches after a lot is assigned", () => {
    expect(matchingHoldForMove([lot], "a0102", "bulb", "LOT-2026-A")?.number).toBe("HLD-3");
    expect(matchingHoldForMove([lot], "a0102", "bulb", "LOT-2026-B")).toBeNull();
    expect(matchingHoldForMove([sku], "a0102", "bulb", null)?.number).toBe("HLD-2");
  });
});

describe("isHoldRestrictedType", () => {
  it("blocks pick, move, kit, and work-order consume", () => {
    expect(isHoldRestrictedType("pick")).toBe(true);
    expect(isHoldRestrictedType("move")).toBe(true);
    expect(isHoldRestrictedType("kit_consume")).toBe(true);
    expect(isHoldRestrictedType("wo_consume")).toBe(true);
    expect(isHoldRestrictedType("rtv")).toBe(true);
    expect(isHoldRestrictedType("receive")).toBe(false);
    expect(isHoldRestrictedType("adjust")).toBe(false);
    expect(isHoldRestrictedType("ship")).toBe(false);
    expect(isHoldRestrictedType("scrap")).toBe(false);
  });
});

describe("holdLabel", () => {
  it("names bay, sku, and lot scopes", () => {
    expect(holdLabel({ locationCode: "A-01-02" })).toBe("A-01-02");
    expect(holdLabel({ locationCode: "A-01-02", sku: "LED-BULB" })).toBe("LED-BULB @ A-01-02");
    expect(holdLabel({ locationCode: "A-01-01", sku: "LED-BULB", lotCode: "LOT-2026-A" })).toBe(
      "LED-BULB LOT-2026-A @ A-01-01",
    );
  });
});
