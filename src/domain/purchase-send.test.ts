import { describe, expect, it } from "vitest";
import { asnLinesFromPurchase, demoPurchaseMessage, remainingToExpect } from "./purchase-send";

describe("purchase send ASN", () => {
  it("mints remaining qty and skips SKUs already on an open ASN", () => {
    const lines = [
      { itemId: "bulb", sku: "LED-BULB", qtyOrdered: 20, qtyReceived: 0 },
      { itemId: "shade", sku: "SHADE", qtyOrdered: 8, qtyReceived: 2 },
      { itemId: "cord", sku: "CORD", qtyOrdered: 15, qtyReceived: 0 },
    ];
    expect(remainingToExpect(lines[1]!)).toBe(6);
    expect(
      asnLinesFromPurchase(lines, [
        { itemId: "bulb", status: "expected" },
        { itemId: "shade", status: "receiving" },
      ]),
    ).toEqual([{ itemId: "cord", sku: "CORD", qty: 15 }]);
  });

  it("skips received-closed ASN covers and empty remainders", () => {
    expect(
      asnLinesFromPurchase(
        [
          { itemId: "lamp", sku: "LAMP", qtyOrdered: 2, qtyReceived: 2 },
          { itemId: "cord", sku: "CORD", qtyOrdered: 4, qtyReceived: 0 },
        ],
        [{ itemId: "cord", status: "received" }],
      ),
    ).toEqual([{ itemId: "cord", sku: "CORD", qty: 4 }]);
    expect(asnLinesFromPurchase([{ itemId: "lamp", sku: "LAMP", qtyOrdered: 1, qtyReceived: 0 }], [{ itemId: "lamp", status: "draft" }])).toEqual(
      [],
    );
  });

  it("records a demo send body", () => {
    expect(demoPurchaseMessage({ number: "PO-DEMO1", vendorName: "Harbor", lines: [{ sku: "CORD", qtyOrdered: 15 }] })).toMatch(
      /PO-DEMO1/,
    );
  });
});
