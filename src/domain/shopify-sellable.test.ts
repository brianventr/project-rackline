import { describe, expect, it } from "vitest";
import {
  computeSellable,
  demoInventoryItemGid,
  isOpenPickStatus,
  remainingToPickQty,
} from "./shopify-sellable";

describe("sellable qty", () => {
  it("is on-hand minus holds minus remaining-to-pick, never negative", () => {
    expect(computeSellable({ onHand: 10, held: 2, remainingToPick: 3 })).toMatchObject({
      available: 8,
      sellable: 5,
    });
    expect(computeSellable({ onHand: 4, held: 0, remainingToPick: 9 }).sellable).toBe(0);
    expect(computeSellable({ onHand: 4, held: 4, remainingToPick: 1 }).sellable).toBe(0);
  });

  it("treats unstarted and in-progress picks as storefront demand, not packed leftover", () => {
    expect(isOpenPickStatus("open")).toBe(true);
    expect(isOpenPickStatus("picking")).toBe(true);
    expect(isOpenPickStatus("packed")).toBe(false);
    expect(isOpenPickStatus("shipped")).toBe(false);
    expect(remainingToPickQty(4, 1)).toBe(3);
    expect(remainingToPickQty(4, 4)).toBe(0);
  });

  it("mints a stable demo inventory item gid from the SKU", () => {
    expect(demoInventoryItemGid("LAMP")).toBe("gid://shopify/InventoryItem/demo-LAMP");
    expect(demoInventoryItemGid("LED BULB")).toBe("gid://shopify/InventoryItem/demo-LEDBULB");
  });
});
