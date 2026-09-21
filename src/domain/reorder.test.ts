import { describe, expect, it } from "vitest";
import { buildReorderLines, majorityVendor, suggestedReorderQty } from "./reorder";

describe("draft PO from reorder", () => {
  it("orders the gap up to the reorder point, at least 1", () => {
    expect(suggestedReorderQty(25, 40)).toBe(15);
    expect(suggestedReorderQty(0, 8)).toBe(8);
    expect(suggestedReorderQty(4, 4)).toBe(1);
    expect(suggestedReorderQty(10, 0)).toBe(0);
  });

  it("skips SKUs already on an open PO and uses the last vendor", () => {
    const lines = buildReorderLines(
      [
        { itemId: "cord", sku: "CORD", name: "Power cord", onHand: 25, reorderPoint: 40, lastVendorName: "Harbor Components" },
        { itemId: "bulb", sku: "LED-BULB", name: "LED bulb", onHand: 10, reorderPoint: 24, lastVendorName: "Harbor Components" },
        { itemId: "shade", sku: "SHADE", name: "Lamp shade", onHand: 50, reorderPoint: 10 },
      ],
      ["bulb"],
      "West Coast Plastics",
    );
    expect(lines).toEqual([
      {
        itemId: "cord",
        sku: "CORD",
        name: "Power cord",
        qty: 15,
        onHand: 25,
        reorderPoint: 40,
        vendorName: "Harbor Components",
      },
    ]);
    expect(majorityVendor(lines)).toBe("Harbor Components");
  });
});
