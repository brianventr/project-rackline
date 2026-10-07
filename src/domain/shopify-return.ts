/** A Shopify return opened from a Rackline disposition, so the refund can be issued without re-keying. */

export const SHOPIFY_RETURN_CREATE = `#graphql
mutation RacklineReturnCreate($returnInput: ReturnInput!) {
  returnCreate(returnInput: $returnInput) {
    return { id }
    userErrors { message }
  }
}
`;

export const SHOPIFY_FULFILLMENT_LINES = `#graphql
query RacklineFulfillmentLines($id: ID!) {
  order(id: $id) {
    fulfillments {
      fulfillmentLineItems(first: 50) {
        nodes {
          id
          quantity
          lineItem { sku }
        }
      }
    }
  }
}
`;

export type ShopifyReturnLine = {
  sku: string;
  quantity: number;
  disposition: string;
  grade?: string | null;
  serial?: string | null;
  condition?: string | null;
};

export function returnReasonNote(line: ShopifyReturnLine): string {
  const parts = [
    `Rackline ${line.disposition}`,
    line.grade ? `grade ${line.grade.toUpperCase()}` : null,
    line.serial ? `serial ${line.serial}` : null,
    line.condition?.trim() || null,
  ].filter(Boolean);
  return parts.join(". ").slice(0, 255);
}

export function matchReturnLines(
  wanted: readonly ShopifyReturnLine[],
  fulfilled: readonly { id: string; sku: string | null; quantity: number }[],
): { fulfillmentLineItemId: string; quantity: number; returnReason: "OTHER"; returnReasonNote: string }[] {
  const left = fulfilled.map((row) => ({ ...row, quantity: Math.max(0, row.quantity) }));
  const matched = [];
  for (const line of wanted) {
    if (line.quantity <= 0) continue;
    const row = left.find((item) => item.quantity > 0 && item.sku?.trim().toUpperCase() === line.sku.trim().toUpperCase());
    if (!row) continue;
    const quantity = Math.min(line.quantity, row.quantity);
    row.quantity -= quantity;
    matched.push({
      fulfillmentLineItemId: row.id,
      quantity,
      returnReason: "OTHER" as const,
      returnReasonNote: returnReasonNote(line),
    });
  }
  return matched;
}
