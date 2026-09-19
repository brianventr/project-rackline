import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : res.statusText) || "Request failed";
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export type Me = {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string };
  role: "owner" | "operator";
  warehouses: { id: string; name: string }[];
};

export type Item = {
  id: string;
  sku: string;
  name: string;
  type: string;
  barcode: string;
  reorderPoint: number;
  onHand?: { locationId: string; locationCode: string; locationName: string; barcode: string; qty: number }[];
};

export type Location = {
  id: string;
  code: string;
  name: string;
  type: string;
  barcode: string;
  area: string;
  aisle: string | null;
  rack: string | null;
  bay: string | null;
  level: number;
  posX: number;
  posY: number;
  posZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  warehouseId: string;
  warehouseName: string;
};

export type MapContent = {
  itemId: string;
  sku: string;
  itemName: string;
  itemType: string;
  qty: number;
};

export type MapLocation = Location & {
  unitsOnHand: number;
  skuCount: number;
  contents: MapContent[];
};

export type WarehouseMapInfo = {
  id: string;
  name: string;
  mapWidth: number;
  mapDepth: number;
  mapHeight: number;
};

export type WarehouseMapData = {
  warehouse: WarehouseMapInfo;
  warehouses: WarehouseMapInfo[];
  locations: MapLocation[];
};

export type ScanLocationHit = {
  kind: "location";
  location: Location;
  contents: MapContent[];
};

export type ScanItemHit = {
  kind: "item";
  item: Item;
  onHand: { locationId: string; locationCode: string; locationName: string; barcode: string; qty: number }[];
};

export type ScanOrderHit = { kind: "order"; order: Order };
export type ScanReceiptHit = { kind: "receipt"; receipt: Receipt };
export type ScanTransferHit = { kind: "transfer"; transfer: Transfer };
export type ScanWorkOrderHit = { kind: "workOrder"; workOrder: WorkOrder };
export type ScanCycleCountHit = { kind: "cycleCount"; cycleCount: CycleCount };

export type ScanHit =
  | ScanLocationHit
  | ScanItemHit
  | ScanOrderHit
  | ScanReceiptHit
  | ScanTransferHit
  | ScanWorkOrderHit
  | ScanCycleCountHit;

export type MoveResult = {
  ok: true;
  refId: string;
  from: { id: string; code: string; name: string; barcode: string };
  to: { id: string; code: string; name: string; barcode: string };
  moved: { itemId: string; sku: string; itemName: string; qty: number }[];
};

export type InventoryRow = {
  id: string;
  qty: number;
  sku: string;
  itemName: string;
  itemType: string;
  itemId: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  warehouseId?: string;
};

export type Receipt = {
  id: string;
  number: string;
  status: string;
  notes: string | null;
  createdAt: number;
  locationId: string | null;
  warehouseId?: string;
  lines?: { id: string; itemId: string; qty: number; sku: string; itemName: string }[];
};

export type Order = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  createdAt: number;
  pickLocationId: string | null;
  warehouseId?: string;
  source?: string;
  shopifyOrderId?: string | null;
  shopifyOrderName?: string | null;
  shopifySyncStatus?: string | null;
  shopifySyncError?: string | null;
  shopifyFulfillmentId?: string | null;
  trackingNumber?: string | null;
  trackingCompany?: string | null;
  trackingUrl?: string | null;
  packedAt?: number | null;
  shopify?: { status?: string; fulfillmentId?: string | null; error?: string | null };
  lines?: {
    id: string;
    itemId: string;
    qty: number;
    sku: string;
    itemName: string;
    shopifyLineItemId?: string | null;
  }[];
};

export type ShopifyConnection = {
  connected: boolean;
  shopDomain: string | null;
  mode: string;
  apiVersion: string;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
  tokenHint: string | null;
  webhookUrl: string;
  fulfillmentNotificationUrl: string;
  scopes: string[];
};

export type ShopifyOutbound = {
  id: string;
  orderId: string | null;
  kind: string;
  status: string;
  createdAt: number;
  request: unknown;
  response: unknown;
};

export type Bom = {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  lines: { id: string; itemId: string; qty: number; sku: string; itemName: string }[];
};

export type WorkOrder = {
  id: string;
  number: string;
  itemId: string;
  qty: number;
  status: string;
  sku: string;
  itemName: string;
  sourceLocationId: string;
  outputLocationId: string;
  createdAt: number;
  warehouseId?: string;
};

export type Dashboard = {
  onHandUnits: number;
  binRows: number;
  skuCount: number;
  openReceipts: number;
  openOrders: number;
  openWorkOrders: number;
  shopifyOpenOrders: number;
  openTransfers: number;
  openCycleCounts: number;
  lowStock: { itemId: string; sku: string; name: string; onHand: number; reorderPoint: number }[];
  recent: { id: string; type: string; qty: number; createdAt: number; sku: string }[];
  hotBays: { locationId: string; locationCode: string; locationName: string; units: number }[];
  queues: {
    receipts: Receipt[];
    orders: Order[];
    workOrders: WorkOrder[];
    putaways: Transfer[];
    counts: CycleCount[];
    shopifyExceptions: Order[];
  };
};

export type SearchResults = {
  q: string;
  items: Pick<Item, "id" | "sku" | "name" | "barcode" | "type">[];
  locations: Pick<Location, "id" | "code" | "name" | "barcode" | "type">[];
  orders: Pick<Order, "id" | "number" | "customerName" | "status" | "source">[];
  receipts: Pick<Receipt, "id" | "number" | "status" | "notes">[];
  transfers: Pick<Transfer, "id" | "number" | "status">[];
  workOrders: Pick<WorkOrder, "id" | "number" | "status">[];
  counts: Pick<CycleCount, "id" | "number" | "status">[];
};

export type TeamMember = {
  id: string;
  role: string;
  userId: string;
  name: string;
  email: string;
};

export type Transfer = {
  id: string;
  number: string;
  status: string;
  fromLocationId: string;
  toLocationId: string;
  fromCode?: string;
  toCode?: string;
  warehouseId?: string;
  notes: string | null;
  lines?: { id: string; itemId: string; qty: number; sku: string; itemName: string }[];
};

export type CycleCount = {
  id: string;
  number: string;
  status: string;
  locationId: string;
  locationCode?: string;
  warehouseId?: string;
  notes: string | null;
  lines?: {
    id: string;
    itemId: string;
    systemQty: number;
    countedQty: number;
    sku: string;
    itemName: string;
  }[];
};

export type Movement = {
  id: string;
  type: string;
  qty: number;
  sku: string;
  itemName: string;
  reason: string | null;
  createdAt: number;
  fromLocationCode: string | null;
  toLocationCode: string | null;
};
