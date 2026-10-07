import { describe, expect, it } from "vitest";
import { matchReturnLines, returnReasonNote } from "./shopify-return";

describe("Shopify return from a disposition", () => {
  it("puts the disposition, grade, and serial in the note", () => {
    expect(returnReasonNote({ sku: "PLANK", quantity: 1, disposition: "refurb", grade: "b", serial: "SN-1", condition: "scratch" })).toBe(
      "Rackline refurb. grade B. serial SN-1. scratch",
    );
    expect(returnReasonNote({ sku: "PLANK", quantity: 1, disposition: "scrap", condition: "x".repeat(300) }).length).toBe(255);
  });

  it("matches fulfilled units by SKU and skips a line that never shipped", () => {
    expect(
      matchReturnLines(
        [
          { sku: "plank", quantity: 1, disposition: "restock" },
          { sku: "RAIL", quantity: 1, disposition: "scrap" },
        ],
        [{ id: "gid://shopify/FulfillmentLineItem/1", sku: "PLANK", quantity: 1 }],
      ),
    ).toEqual([
      {
        fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/1",
        quantity: 1,
        returnReason: "OTHER",
        returnReasonNote: "Rackline restock",
      },
    ]);
  });
});
