import { destColumns, formatShipToAddress, resolveFromText, resolvePlace, type DestColumns } from "./geo";

export async function shopifyHmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function verifyShopifyHmac(
  secret: string,
  body: string,
  header: string | undefined,
): Promise<boolean> {
  if (!header) return false;
  const expected = decodeBase64(await shopifyHmac(secret, body));
  const actual = decodeBase64(header);
  if (!expected || !actual || expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected[i]! ^ actual[i]!;
  }
  return diff === 0;
}

export const SHOPIFY_API_VERSION = "2026-07";

export const FULFILLMENT_CREATE_MUTATION = `#graphql
mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) {
    fulfillment {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}
`;

export const ORDER_FULFILLMENT_ORDERS_QUERY = `#graphql
query OrderFulfillmentOrders($id: ID!) {
  order(id: $id) {
    id
    name
    fulfillmentOrders(first: 20) {
      nodes {
        id
        status
        requestStatus
        destination {
          firstName
          lastName
          address1
          city
          province
          countryCode
          zip
        }
        lineItems(first: 50) {
          nodes {
            id
            remainingQuantity
            sku
            lineItem {
              id
              sku
              title
            }
          }
        }
      }
    }
  }
}
`;

export const ASSIGNED_FULFILLMENT_ORDERS_QUERY = `#graphql
query AssignedFulfillmentOrders {
  shop {
    assignedFulfillmentOrders(first: 20, assignmentStatus: FULFILLMENT_REQUESTED) {
      nodes {
        id
        status
        requestStatus
        order {
          id
          name
        }
        destination {
          firstName
          lastName
          address1
          city
          province
          countryCode
          zip
        }
        lineItems(first: 50) {
          nodes {
            id
            remainingQuantity
            sku
            lineItem {
              id
              sku
              title
            }
          }
        }
      }
    }
  }
}
`;

export const ACCEPT_FULFILLMENT_REQUEST_MUTATION = `#graphql
mutation AcceptFulfillmentRequest($id: ID!, $message: String) {
  fulfillmentOrderAcceptFulfillmentRequest(id: $id, message: $message) {
    fulfillmentOrder {
      id
      status
      requestStatus
    }
    userErrors {
      field
      message
    }
  }
}
`;

export type ShopifyRestLineItem = {
  id?: number | string;
  admin_graphql_api_id?: string | null;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  quantity?: number;
  fulfillable_quantity?: number;
  fulfillment_status?: string | null;
};

export type ShopifyRestOrder = {
  id?: number | string;
  admin_graphql_api_id?: string | null;
  name?: string | null;
  email?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  fulfillment_status?: string | null;
  financial_status?: string | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  shipping_address?: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    province_code?: string | null;
    country?: string | null;
    country_code?: string | null;
    zip?: string | null;
  } | null;
  line_items?: ShopifyRestLineItem[];
};

export type MappedInboundLine = {
  sku: string;
  title: string;
  qty: number;
  shopifyLineItemId: string;
  shopifyLineItemGid: string | null;
  shopifyFulfillmentLineItemId: string | null;
};

export type MappedInboundOrder = {
  shopifyOrderId: string;
  shopifyOrderGid: string;
  shopifyOrderName: string;
  customerName: string;
  shipToAddress: string | null;
  dest: DestColumns;
  lines: MappedInboundLine[];
};

export type SkipInbound = { skip: true; reason: string };

export type ShopifyFulfillmentOrderNode = {
  id: string;
  status?: string | null;
  requestStatus?: string | null;
  order?: { id?: string | null; name?: string | null } | null;
  destination?: {
    firstName?: string | null;
    lastName?: string | null;
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    countryCode?: string | null;
    zip?: string | null;
  } | null;
  lineItems?: {
    nodes?: Array<{
      id: string;
      remainingQuantity?: number | null;
      sku?: string | null;
      lineItem?: { id?: string | null; sku?: string | null; title?: string | null } | null;
    }>;
  } | null;
};

export type FulfillmentCreateInput = {
  notifyCustomer: boolean;
  trackingInfo?: { number?: string; url?: string; company?: string };
  lineItemsByFulfillmentOrder: Array<{
    fulfillmentOrderId: string;
    fulfillmentOrderLineItems?: Array<{ id: string; quantity: number }>;
  }>;
};

export function normalizeShopDomain(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/\/.*$/, "");
  if (!value) {
    throw new Error("Shop domain is required");
  }
  if (!value.includes(".")) {
    value = `${value}.myshopify.com`;
  }
  return value;
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export function orderGid(id: string | number): string {
  const raw = String(id);
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/Order/${raw}`;
}

export function numericIdFromGid(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] || gid;
}

function destFromRestAddress(addr: ShopifyRestOrder["shipping_address"]): { shipToAddress: string | null; dest: DestColumns } {
  if (!addr) return { shipToAddress: null, dest: destColumns(null) };
  const formatted = formatShipToAddress({
    address1: addr.address1,
    address2: addr.address2,
    city: addr.city,
    region: addr.province_code || addr.province,
    postal: addr.zip,
    country: addr.country_code || addr.country,
  });
  const place =
    resolvePlace({
      city: addr.city ?? undefined,
      region: addr.province_code || addr.province || undefined,
      postal: addr.zip ?? undefined,
      country: addr.country_code || addr.country || undefined,
    }) ?? resolveFromText(formatted);
  return { shipToAddress: formatted, dest: destColumns(place) };
}

function destFromFulfillmentDestination(
  dest: ShopifyFulfillmentOrderNode["destination"],
): { shipToAddress: string | null; dest: DestColumns } {
  if (!dest) return { shipToAddress: null, dest: destColumns(null) };
  const formatted = formatShipToAddress({
    address1: dest.address1,
    city: dest.city,
    region: dest.province,
    postal: dest.zip,
    country: dest.countryCode,
  });
  const place =
    resolvePlace({
      city: dest.city ?? undefined,
      region: dest.province ?? undefined,
      postal: dest.zip ?? undefined,
      country: dest.countryCode ?? undefined,
    }) ?? resolveFromText(formatted);
  return { shipToAddress: formatted, dest: destColumns(place) };
}

function customerNameFrom(order: ShopifyRestOrder): string {
  const ship = order.shipping_address;
  if (ship?.name?.trim()) return ship.name.trim();
  const first = ship?.first_name || order.customer?.first_name || "";
  const last = ship?.last_name || order.customer?.last_name || "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (order.email?.trim()) return order.email.trim();
  return "Shopify customer";
}

export function lineSku(line: ShopifyRestLineItem, fallbackId: string): string {
  const sku = line.sku?.trim();
  if (sku) return sku;
  return `SHOPIFY-${fallbackId}`;
}

export function lineQty(line: ShopifyRestLineItem): number {
  if (typeof line.fulfillable_quantity === "number") return line.fulfillable_quantity;
  if (typeof line.quantity === "number") return line.quantity;
  return 0;
}

export function mapRestOrder(order: ShopifyRestOrder): MappedInboundOrder | SkipInbound {
  if (order.cancelled_at) {
    return { skip: true, reason: "cancelled" };
  }
  if (order.fulfillment_status === "fulfilled") {
    return { skip: true, reason: "already_fulfilled" };
  }
  if (order.id == null) {
    return { skip: true, reason: "missing_id" };
  }

  const shopifyOrderId = String(order.id);
  const lines: MappedInboundLine[] = [];
  for (const line of order.line_items ?? []) {
    if (line.fulfillment_status === "fulfilled") continue;
    const id = line.id != null ? String(line.id) : "";
    if (!id) continue;
    const qty = lineQty(line);
    if (!Number.isInteger(qty) || qty <= 0) continue;
    lines.push({
      sku: lineSku(line, id),
      title: (line.title || line.name || lineSku(line, id)).trim(),
      qty,
      shopifyLineItemId: id,
      shopifyLineItemGid: line.admin_graphql_api_id ?? null,
      shopifyFulfillmentLineItemId: null,
    });
  }

  if (lines.length === 0) {
    return { skip: true, reason: "no_fulfillable_lines" };
  }

  return {
    shopifyOrderId,
    shopifyOrderGid: order.admin_graphql_api_id || orderGid(shopifyOrderId),
    shopifyOrderName: order.name?.trim() || `#${shopifyOrderId}`,
    customerName: customerNameFrom(order),
    ...destFromRestAddress(order.shipping_address),
    lines,
  };
}

export function mapFulfillmentOrder(node: ShopifyFulfillmentOrderNode): MappedInboundOrder | SkipInbound {
  if (!node.id) return { skip: true, reason: "missing_id" };
  if (node.status === "closed" || node.status === "cancelled") {
    return { skip: true, reason: node.status };
  }
  const orderGidValue = node.order?.id;
  const shopifyOrderId = orderGidValue ? numericIdFromGid(orderGidValue) : numericIdFromGid(node.id);
  const dest = node.destination;
  const customerName = `${dest?.firstName ?? ""} ${dest?.lastName ?? ""}`.trim() || "Shopify customer";
  const lines: MappedInboundLine[] = [];
  for (const line of node.lineItems?.nodes ?? []) {
    const qty = line.remainingQuantity ?? 0;
    if (!Number.isInteger(qty) || qty <= 0) continue;
    const sku = line.sku?.trim() || line.lineItem?.sku?.trim() || `SHOPIFY-${numericIdFromGid(line.id)}`;
    lines.push({
      sku,
      title: line.lineItem?.title?.trim() || sku,
      qty,
      shopifyLineItemId: line.lineItem?.id ? numericIdFromGid(line.lineItem.id) : numericIdFromGid(line.id),
      shopifyLineItemGid: line.lineItem?.id ?? null,
      shopifyFulfillmentLineItemId: line.id,
    });
  }
  if (lines.length === 0) {
    return { skip: true, reason: "no_fulfillable_lines" };
  }
  return {
    shopifyOrderId,
    shopifyOrderGid: orderGidValue || orderGid(shopifyOrderId),
    shopifyOrderName: node.order?.name?.trim() || `#${shopifyOrderId}`,
    customerName,
    ...destFromFulfillmentDestination(node.destination),
    lines,
  };
}

export function applyFulfillmentOrderIds(
  inbound: MappedInboundOrder,
  fulfillmentOrder: ShopifyFulfillmentOrderNode,
): MappedInboundOrder {
  const bySku = new Map<string, string>();
  const byLineGid = new Map<string, string>();
  for (const line of fulfillmentOrder.lineItems?.nodes ?? []) {
    const sku = line.sku?.trim() || line.lineItem?.sku?.trim();
    if (sku) bySku.set(sku.toLowerCase(), line.id);
    if (line.lineItem?.id) byLineGid.set(line.lineItem.id, line.id);
  }
  return {
    ...inbound,
    shopifyOrderGid: inbound.shopifyOrderGid,
    lines: inbound.lines.map((line) => ({
      ...line,
      shopifyFulfillmentLineItemId:
        (line.shopifyLineItemGid ? byLineGid.get(line.shopifyLineItemGid) : undefined) ||
        bySku.get(line.sku.toLowerCase()) ||
        line.shopifyFulfillmentLineItemId,
    })),
  };
}

export function demoFulfillmentIds(inbound: MappedInboundOrder): MappedInboundOrder {
  return {
    ...inbound,
    lines: inbound.lines.map((line) => ({
      ...line,
      shopifyFulfillmentLineItemId:
        line.shopifyFulfillmentLineItemId || `gid://shopify/FulfillmentOrderLineItem/demo-${line.shopifyLineItemId}`,
    })),
  };
}

export function demoFulfillmentOrderId(shopifyOrderId: string): string {
  return `gid://shopify/FulfillmentOrder/demo-${shopifyOrderId}`;
}

export function buildFulfillmentCreateInput(input: {
  fulfillmentOrderId: string;
  lineItems: Array<{ id: string; quantity: number }>;
  tracking?: { number?: string | null; url?: string | null; company?: string | null };
  notifyCustomer?: boolean;
}): FulfillmentCreateInput {
  const trackingInfo: { number?: string; url?: string; company?: string } = {};
  if (input.tracking?.number) trackingInfo.number = input.tracking.number;
  if (input.tracking?.url) trackingInfo.url = input.tracking.url;
  if (input.tracking?.company) trackingInfo.company = input.tracking.company;
  const fulfillment: FulfillmentCreateInput = {
    notifyCustomer: input.notifyCustomer ?? true,
    lineItemsByFulfillmentOrder: [
      {
        fulfillmentOrderId: input.fulfillmentOrderId,
        fulfillmentOrderLineItems: input.lineItems.map((line) => ({
          id: line.id,
          quantity: line.quantity,
        })),
      },
    ],
  };
  if (Object.keys(trackingInfo).length > 0) {
    fulfillment.trackingInfo = trackingInfo;
  }
  return fulfillment;
}

export function buildDemoOrderPayload(input: {
  id?: number;
  name?: string;
  customerName: string;
  email?: string;
  address1?: string;
  city?: string;
  region?: string;
  postal?: string;
  country?: string;
  lines: Array<{ sku: string; title?: string; qty: number; lineId?: number }>;
}): ShopifyRestOrder {
  const id = input.id ?? Math.floor(Date.now() % 1_000_000_000);
  const [firstName, ...rest] = input.customerName.trim().split(/\s+/);
  const lastName = rest.join(" ") || "Customer";
  return {
    id,
    admin_graphql_api_id: orderGid(id),
    name: input.name ?? `#${id}`,
    email: input.email ?? null,
    cancelled_at: null,
    fulfillment_status: null,
    financial_status: "paid",
    customer: { first_name: firstName, last_name: lastName },
    shipping_address: {
      name: input.customerName,
      first_name: firstName,
      last_name: lastName,
      address1: input.address1 ?? null,
      city: input.city ?? null,
      province_code: input.region ?? null,
      zip: input.postal ?? null,
      country_code: input.country ?? null,
    },
    line_items: input.lines.map((line, index) => ({
      id: line.lineId ?? id * 10 + index + 1,
      sku: line.sku,
      title: line.title ?? line.sku,
      quantity: line.qty,
      fulfillable_quantity: line.qty,
      fulfillment_status: null,
    })),
  };
}

export const REQUIRED_SCOPES = [
  "read_orders",
  "write_orders",
  "read_merchant_managed_fulfillment_orders",
  "write_merchant_managed_fulfillment_orders",
  "read_assigned_fulfillment_orders",
  "write_assigned_fulfillment_orders",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "read_products",
];

export const LOCATIONS_QUERY = `#graphql
query RacklineLocations {
  locations(first: 20) {
    nodes {
      id
      name
      fulfillsOnlineOrders
    }
  }
}
`;

export const VARIANT_INVENTORY_QUERY = `#graphql
query RacklineVariantInventory($query: String!) {
  productVariants(first: 1, query: $query) {
    nodes {
      id
      sku
      inventoryItem {
        id
      }
    }
  }
}
`;

export const INVENTORY_SET_QUANTITIES_MUTATION = `#graphql
mutation RacklineInventorySetQuantities($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup {
      createdAt
      reason
    }
    userErrors {
      field
      message
    }
  }
}
`;

export function buildInventorySetQuantitiesInput(input: {
  locationId: string;
  quantities: Array<{ inventoryItemId: string; quantity: number }>;
}) {
  return {
    name: "available",
    reason: "correction",
    ignoreCompareQuantity: true,
    quantities: input.quantities.map((row) => ({
      inventoryItemId: row.inventoryItemId,
      locationId: input.locationId,
      quantity: row.quantity,
    })),
  };
}
