import { canShipCartonOrder } from "./status";

export type ShortShipLine = {
  lineId: string;
  itemId: string;
  sku: string;
  qty: number;
  qtyPicked: number;
  qtyPacked: number;
};

export type ShortShipPackage = {
  id: string;
  shippedAt?: number | null;
  lines: { orderLineId: string; qty: number }[];
};

export type ShortShipFailure = {
  ok: false;
  code: "NOT_OPEN" | "NOTHING_SHIPPED" | "NO_REMAINDER";
  error: string;
};

export type ShortShipPlan = {
  ok: true;
  shippedByLine: { lineId: string; qty: number }[];
  remainder: { lineId: string; itemId: string; sku: string; qty: number }[];
  unpick: { lineId: string; qty: number }[];
  dropPackageIds: string[];
};

export function planShortShip(input: {
  status: string;
  lines: ShortShipLine[];
  packages: ShortShipPackage[];
}): ShortShipPlan | ShortShipFailure {
  if (!canShipCartonOrder(input.status)) {
    return { ok: false, code: "NOT_OPEN", error: "Short ship is only for a packing or packed order" };
  }
  const shippedByLine = new Map<string, number>();
  for (const pkg of input.packages) {
    if (!pkg.shippedAt) continue;
    for (const line of pkg.lines) {
      if (line.qty <= 0) continue;
      shippedByLine.set(line.orderLineId, (shippedByLine.get(line.orderLineId) ?? 0) + line.qty);
    }
  }
  const shippedUnits = [...shippedByLine.values()].reduce((sum, qty) => sum + qty, 0);
  if (shippedUnits <= 0) {
    return { ok: false, code: "NOTHING_SHIPPED", error: "Ship a labeled carton before short-shipping. Cancel if nothing has left." };
  }

  const remainder: ShortShipPlan["remainder"] = [];
  const unpick: ShortShipPlan["unpick"] = [];
  const shipped: ShortShipPlan["shippedByLine"] = [];
  for (const line of input.lines) {
    const shippedQty = Math.min(line.qty, shippedByLine.get(line.lineId) ?? 0);
    if (shippedQty > 0) shipped.push({ lineId: line.lineId, qty: shippedQty });
    const left = line.qty - shippedQty;
    if (left > 0) remainder.push({ lineId: line.lineId, itemId: line.itemId, sku: line.sku, qty: left });
    const back = Math.max(0, line.qtyPicked - shippedQty);
    if (back > 0) unpick.push({ lineId: line.lineId, qty: back });
  }
  if (remainder.length === 0) {
    return {
      ok: false,
      code: "NO_REMAINDER",
      error: "Every ordered unit is already in a shipped carton",
    };
  }
  return {
    ok: true,
    shippedByLine: shipped,
    remainder,
    unpick,
    dropPackageIds: input.packages.filter((pkg) => !pkg.shippedAt).map((pkg) => pkg.id),
  };
}

export function ledgerUnpick(
  unpick: { lineId: string; itemId: string; qty: number }[],
  sliceQtyByItem: Map<string, number>,
): { lineId: string; qty: number }[] {
  const available = new Map(sliceQtyByItem);
  const covered: { lineId: string; qty: number }[] = [];
  for (const row of unpick) {
    if (row.qty <= 0) continue;
    const have = available.get(row.itemId) ?? 0;
    const qty = Math.min(row.qty, have);
    if (qty <= 0) continue;
    available.set(row.itemId, have - qty);
    covered.push({ lineId: row.lineId, qty });
  }
  return covered;
}

export function backorderNumber(parentNumber: string, taken: string[]): string {
  const base = `${parentNumber}-BO`;
  if (!taken.includes(base)) return base;
  let seq = 2;
  while (taken.includes(`${base}${seq}`)) seq += 1;
  return `${base}${seq}`;
}

export function shopifyBackorderFields(parent: {
  source: string;
  shopifyOrderGid?: string | null;
  shopifyOrderName?: string | null;
  shopifyFulfillmentOrderId?: string | null;
  shopifyShopDomain?: string | null;
}): {
  source: string;
  shopifyOrderGid: string | null;
  shopifyOrderName: string | null;
  shopifyFulfillmentOrderId: string | null;
  shopifyShopDomain: string | null;
  shopifySyncStatus: string;
} {
  if (parent.source !== "shopify") {
    return {
      source: parent.source || "manual",
      shopifyOrderGid: null,
      shopifyOrderName: null,
      shopifyFulfillmentOrderId: null,
      shopifyShopDomain: null,
      shopifySyncStatus: "none",
    };
  }
  return {
    source: "shopify",
    shopifyOrderGid: parent.shopifyOrderGid ?? null,
    shopifyOrderName: parent.shopifyOrderName ?? null,
    shopifyFulfillmentOrderId: parent.shopifyFulfillmentOrderId ?? null,
    shopifyShopDomain: parent.shopifyShopDomain ?? null,
    shopifySyncStatus: "none",
  };
}
