import { describe, expect, it } from "vitest";
import { etsyInventoryWithQty, wooStockBody } from "./channel-sellable";

describe("channel sellable", () => {
  it("sets Woo stock and marks a zero as out of stock", () => {
    expect(wooStockBody(4)).toEqual({ manage_stock: true, stock_quantity: 4, stock_status: "instock" });
    expect(wooStockBody(0).stock_status).toBe("outofstock");
  });

  it("replaces the matching Etsy offering and leaves other SKUs", () => {
    const next = etsyInventoryWithQty(
      { products: [{ sku: "LED", offerings: [{ offering_id: 1, quantity: 9 }] }, { sku: "SHADE", offerings: [{ quantity: 2 }] }] },
      "led",
      3,
    );
    expect(next?.products?.[0]?.offerings?.[0]?.quantity).toBe(3);
    expect(next?.products?.[1]?.offerings?.[0]?.quantity).toBe(2);
    expect(etsyInventoryWithQty({ products: [{ sku: "OTHER", offerings: [] }] }, "LED", 1)).toBeNull();
  });
});