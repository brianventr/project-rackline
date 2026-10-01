/**
 * Vendor and customer records. Documents (purchases, orders, returns) keep the name they were made
 * with and link to the record by id, so renaming a record changes new documents, not old ones.
 */
import { isEmailAddress } from "./purchase-mail";

export type ChannelRef = { channel: string; ref: string };

/** How two names compare: case and surrounding spaces ignored (the `lower(trim(name))` index). */
export function nameKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/** A usable email, trimmed, or null. */
export function cleanEmail(email: string | null | undefined): string | null {
  const value = (email ?? "").trim();
  return value && isEmailAddress(value) ? value : null;
}

/** Addresses compare without case, punctuation, or line breaks: "12 Oak St.\nPortland" = "12 oak st, portland". */
export function addressKey(address: string | null | undefined): string {
  return (address ?? "")
    .toLowerCase()
    .replace(/[.,#;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseChannelRefs(json: string | null | undefined): ChannelRef[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is ChannelRef =>
        Boolean(row) && typeof row.channel === "string" && typeof row.ref === "string" && row.ref.length > 0,
    );
  } catch {
    return [];
  }
}

/** The refs with `next` added, or null when it was already there. */
export function withChannelRef(refs: ChannelRef[], next: ChannelRef | null): ChannelRef[] | null {
  if (!next) return null;
  if (refs.some((row) => row.channel === next.channel && row.ref === next.ref)) return null;
  return [...refs, next];
}

export type CustomerCandidate = {
  id: string;
  name: string;
  email: string | null;
  shipToAddress: string | null;
  channelRefs: ChannelRef[];
  updatedAt: number;
};

export type IncomingCustomer = {
  name: string;
  email?: string | null;
  address?: string | null;
  /** The customer's id on the channel the order came from (Shopify customer id, Woo customer id). */
  channelRef?: ChannelRef | null;
};

export type CustomerMatch = { id: string; via: "channel" | "email" | "name_address" | "name" };

/**
 * Which existing customer an incoming order belongs to, or null to create one.
 *
 * 1. Same channel customer id.
 * 2. Same email.
 * 3. Same name and same ship-to address. When the order has an email, only customers without one
 *    qualify (a different email means a different person).
 * 4. With no address to compare (a typed order, a return), same name: the one without an address
 *    first, else the most recently updated.
 */
export function matchCustomer(candidates: CustomerCandidate[], incoming: IncomingCustomer): CustomerMatch | null {
  const ordered = [...candidates].sort((a, b) => b.updatedAt - a.updatedAt);
  const ref = incoming.channelRef;
  if (ref) {
    const byRef = ordered.find((row) => row.channelRefs.some((r) => r.channel === ref.channel && r.ref === ref.ref));
    if (byRef) return { id: byRef.id, via: "channel" };
  }
  const email = cleanEmail(incoming.email);
  if (email) {
    const byEmail = ordered.find((row) => nameKey(row.email) === nameKey(email));
    if (byEmail) return { id: byEmail.id, via: "email" };
  }
  const key = nameKey(incoming.name);
  if (!key) return null;
  const sameName = ordered.filter((row) => nameKey(row.name) === key && (!email || !cleanEmail(row.email)));
  const address = addressKey(incoming.address);
  if (address) {
    const byAddress = sameName.find((row) => addressKey(row.shipToAddress) === address);
    return byAddress ? { id: byAddress.id, via: "name_address" } : null;
  }
  const byName = sameName.find((row) => !addressKey(row.shipToAddress)) ?? sameName[0];
  return byName ? { id: byName.id, via: "name" } : null;
}

export type CustomerPatch = { email?: string; shipToAddress?: string; channelRefsJson?: string };

/** Blanks the incoming order can fill on a matched customer. Never overwrites what is there. */
export function customerFill(candidate: CustomerCandidate, incoming: IncomingCustomer): CustomerPatch {
  const patch: CustomerPatch = {};
  const email = cleanEmail(incoming.email);
  if (email && !cleanEmail(candidate.email)) patch.email = email;
  const address = incoming.address?.trim();
  if (address && !candidate.shipToAddress?.trim()) patch.shipToAddress = address;
  const refs = withChannelRef(candidate.channelRefs, incoming.channelRef ?? null);
  if (refs) patch.channelRefsJson = JSON.stringify(refs);
  return patch;
}

export type CostLine = {
  itemId: string;
  sku: string;
  itemName: string;
  unitCostCents: number | null;
  qtyOrdered: number;
  purchaseId: string;
  purchaseNumber: string;
  at: number;
};

/**
 * The last price paid per item: the newest line with a cost. Items only ever bought without a cost
 * still show, with a null cost, so the vendor page lists everything you buy from them.
 */
export function lastCostByItem(lines: CostLine[]): CostLine[] {
  const newest = [...lines].sort((a, b) => b.at - a.at);
  const byItem = new Map<string, CostLine>();
  for (const line of newest) {
    const held = byItem.get(line.itemId);
    if (!held || (held.unitCostCents == null && line.unitCostCents != null)) byItem.set(line.itemId, line);
  }
  return [...byItem.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Cost for a new PO line: what was typed, else the vendor's last price, else the item's standard cost. */
export function defaultLineCost(input: {
  typed?: number | null;
  vendorLast?: number | null;
  itemCost?: number | null;
}): number | null {
  for (const value of [input.typed, input.vendorLast]) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  return typeof input.itemCost === "number" && input.itemCost > 0 ? input.itemCost : null;
}

/** "$1.75", or "—" when no price was recorded. */
export function formatMoney(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Dollars typed into a cost box ("1.75", "$2") as cents; null when blank, "invalid" when not a price. */
export function parseMoneyInput(value: string | null | undefined): number | null | "invalid" {
  const text = (value ?? "").trim().replace(/^\$/, "");
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "invalid";
  return Math.round(Number(text) * 100);
}

/** Whole days, 0–365. Null clears. */
export function parseLeadTimeDays(value: unknown): number | null | "invalid" {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : "invalid";
}

/** Three-letter ISO code, upper-cased. */
export function parseCurrency(value: unknown): string | null {
  if (value == null) return null;
  const code = String(value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
