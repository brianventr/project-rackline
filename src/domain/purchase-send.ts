const OPEN_ASN = new Set(["draft", "expected", "receiving"]);

export type PurchaseSendLine = {
  itemId: string;
  sku?: string;
  qtyOrdered: number;
  qtyReceived: number;
};

export type OpenAsnCover = {
  itemId: string;
  status: string;
};

export function remainingToExpect(line: PurchaseSendLine): number {
  return line.qtyOrdered - line.qtyReceived;
}

export function asnLinesFromPurchase(purchaseLines: PurchaseSendLine[], openAsnLines: OpenAsnCover[]): { itemId: string; sku?: string; qty: number }[] {
  const covered = new Set(
    openAsnLines.filter((row) => OPEN_ASN.has(row.status)).map((row) => row.itemId),
  );
  return purchaseLines
    .map((line) => ({
      itemId: line.itemId,
      sku: line.sku,
      qty: remainingToExpect(line),
    }))
    .filter((line) => line.qty > 0 && !covered.has(line.itemId));
}

export function demoPurchaseMessage(input: { number: string; vendorName: string; lines: { sku?: string; qtyOrdered: number }[] }): string {
  const skus = input.lines
    .map((line) => `${line.sku ?? "SKU"} × ${line.qtyOrdered}`)
    .join(", ");
  return `Please fulfill ${input.number}: ${skus}.`;
}
