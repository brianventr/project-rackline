/**
 * Sellable qty (the same number Shopify already gets) as the body a second channel accepts.
 * Etsy inventory is the listing's existing payload with that SKU's offering quantity replaced.
 */

export function wooStockBody(qty: number): {
  manage_stock: true;
  stock_quantity: number;
  stock_status: "instock" | "outofstock";
} {
  const stock = Math.max(0, Math.floor(qty));
  return { manage_stock: true, stock_quantity: stock, stock_status: stock > 0 ? "instock" : "outofstock" };
}

export type EtsyOffering = { offering_id?: number; quantity?: number; is_enabled?: boolean };
export type EtsyInventoryProduct = { sku?: string | null; product_id?: number; offerings?: EtsyOffering[] };
export type EtsyInventory = {
  products?: EtsyInventoryProduct[];
  price_on_property?: number[];
  quantity_on_property?: number[];
  sku_on_property?: number[];
};

/** The PUT body, or null when this listing has no product with that SKU. */
export function etsyInventoryWithQty(inventory: EtsyInventory, sku: string, qty: number): EtsyInventory | null {
  const want = sku.trim().toLowerCase();
  let found = false;
  const products = (inventory.products ?? []).map((product) => {
    if ((product.sku ?? "").trim().toLowerCase() !== want) return product;
    found = true;
    const offerings = product.offerings ?? [];
    return {
      ...product,
      offerings: offerings.length
        ? offerings.map((offering) => ({ ...offering, quantity: Math.max(0, Math.floor(qty)) }))
        : [{ quantity: Math.max(0, Math.floor(qty)), is_enabled: true }],
    };
  });
  if (!found) return null;
  return { ...inventory, products };
}
