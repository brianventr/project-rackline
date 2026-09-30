/**
 * Lot / serial recall report from as-built genealogy + open balances.
 */

export type RecallHit = {
  kind: "balance" | "as_built_parent" | "as_built_component" | "order_shipped";
  sku: string;
  name?: string;
  lotCode?: string | null;
  serial?: string | null;
  locationCode?: string | null;
  qty?: number;
  documentNumber?: string | null;
  detail: string;
};

export function buildRecallSummary(hits: RecallHit[]): {
  balanceQty: number;
  asBuiltLinks: number;
  locations: string[];
} {
  const locations = new Set<string>();
  let balanceQty = 0;
  let asBuiltLinks = 0;
  for (const hit of hits) {
    if (hit.locationCode) locations.add(hit.locationCode);
    if (hit.kind === "balance") balanceQty += hit.qty ?? 0;
    if (hit.kind === "as_built_parent" || hit.kind === "as_built_component") asBuiltLinks += 1;
  }
  return { balanceQty, asBuiltLinks, locations: [...locations].sort() };
}
