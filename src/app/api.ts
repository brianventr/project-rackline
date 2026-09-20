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
  floorVerbs?: string[];
  warehouses: { id: string; name: string }[];
};

export type AsBuiltLink = {
  refType: string;
  refId: string;
  parentItemId: string;
  parentSku: string;
  parentLotCode: string | null;
  parentSerial: string | null;
  componentItemId: string;
  componentSku: string;
  componentLotCode: string | null;
  componentSerial: string | null;
  qty: number;
};

export type Item = {
  id: string;
  sku: string;
  name: string;
  type: string;
  barcode: string;
  reorderPoint: number;
  pickMin?: number;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
  onHand?: {
    locationId: string;
    locationCode: string;
    locationName: string;
    barcode: string;
    qty: number;
    allocated?: number;
    atp?: number;
  }[];
  lots?: {
    locationId: string;
    locationCode: string;
    lotCode: string;
    qty: number;
    expiresOn?: number | null;
    usedIn?: AsBuiltLink[];
  }[];
  serials?: {
    serialCode: string;
    status: string;
    locationId: string | null;
    locationCode: string | null;
    builtFrom?: AsBuiltLink[];
    usedIn?: AsBuiltLink[];
  }[];
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
  slotRole?: string;
  zoneId?: string | null;
  warehouseId: string;
  warehouseName: string;
};

export type MapContent = {
  itemId: string;
  sku: string;
  itemName: string;
  itemType: string;
  qty: number;
  held?: boolean;
  holdNumber?: string | null;
  holdReason?: string | null;
  availableQty?: number;
  allocated?: number;
  suggestedLocation?: SuggestedLocation | null;
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
  shipFromAddress?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
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
  holds?: Hold[];
};

export type ScanItemHit = {
  kind: "item";
  item: Item;
  onHand: {
    locationId: string;
    locationCode: string;
    locationName: string;
    barcode: string;
    qty: number;
    held?: boolean;
    holdNumber?: string | null;
    holdReason?: string | null;
    availableQty?: number;
    allocated?: number;
  }[];
};

export type ScanOrderHit = { kind: "order"; order: Order };
export type ScanReceiptHit = { kind: "receipt"; receipt: Receipt };
export type ScanTransferHit = { kind: "transfer"; transfer: Transfer };
export type ScanWorkOrderHit = { kind: "workOrder"; workOrder: WorkOrder };
export type ScanCycleCountHit = { kind: "cycleCount"; cycleCount: CycleCount };
export type ScanPurchaseHit = { kind: "purchase"; purchase: Purchase };
export type ScanRmaHit = { kind: "rma"; rma: Rma };
export type ScanVendorReturnHit = { kind: "vendorReturn"; vendorReturn: VendorReturn };
export type ScanReplenishmentHit = { kind: "replenishment"; replenishment: Replenishment };
export type ScanKitHit = { kind: "kit"; kit: KitBuild };
export type ScanHoldHit = { kind: "hold"; hold: Hold };
export type ScanWaveHit = { kind: "wave"; wave: Wave };
export type ScanAsnHit = { kind: "asn"; asn: Asn };
export type ScanYardHit = { kind: "yard"; yard: YardVisit };
export type ScanEquipmentHit = { kind: "equipment"; equipment: Equipment };
export type ScanSerialHit = {
  kind: "serial";
  serial: {
    serialCode: string;
    status: string;
    itemId: string;
    sku: string;
    itemName: string;
    locationId: string | null;
    locationCode: string | null;
    locationName: string | null;
  };
  item: Pick<Item, "id" | "sku" | "name" | "barcode">;
  builtFrom: AsBuiltLink[];
  usedIn: AsBuiltLink[];
};
export type ScanLotHit = {
  kind: "lot";
  lotCode: string;
  onHand: {
    locationId: string;
    locationCode: string;
    locationName: string;
    barcode: string;
    itemId: string;
    sku: string;
    itemName: string;
    lotCode: string;
    qty: number;
    expiresOn?: number | null;
  }[];
  builtFrom: AsBuiltLink[];
  usedIn: AsBuiltLink[];
};

export type ScanHit =
  | ScanLocationHit
  | ScanItemHit
  | ScanOrderHit
  | ScanReceiptHit
  | ScanTransferHit
  | ScanWorkOrderHit
  | ScanCycleCountHit
  | ScanPurchaseHit
  | ScanRmaHit
  | ScanVendorReturnHit
  | ScanReplenishmentHit
  | ScanKitHit
  | ScanHoldHit
  | ScanWaveHit
  | ScanAsnHit
  | ScanYardHit
  | ScanEquipmentHit
  | ScanSerialHit
  | ScanLotHit;

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
  allocated?: number;
  atp?: number;
  sku: string;
  itemName: string;
  itemType: string;
  itemId: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  warehouseId?: string;
};

export type ReceiptLine = {
  id: string;
  itemId: string;
  qty: number;
  qtyReceived: number;
  remaining: number;
  sku: string;
  itemName: string;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
};

export type Receipt = {
  id: string;
  number: string;
  status: string;
  notes: string | null;
  createdAt: number;
  locationId: string | null;
  warehouseId?: string;
  lines?: ReceiptLine[];
};

export type SuggestedLocation = {
  locationId: string;
  locationCode: string;
  locationName: string;
  barcode: string;
  qty: number;
};

export type OrderAllocation = {
  id: string;
  locationId: string;
  locationCode: string;
  itemId: string;
  sku: string;
  qty: number;
  orderLineId?: string;
};

export type OrderLine = {
  id: string;
  itemId: string;
  qty: number;
  qtyPicked: number;
  qtyPacked?: number;
  remaining: number;
  packRemaining?: number;
  unpickRemaining?: number;
  allocatedQty?: number;
  allocations?: OrderAllocation[];
  sku: string;
  itemName: string;
  shopifyLineItemId?: string | null;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
  suggestedLocation?: SuggestedLocation | null;
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
  shipToAddress?: string | null;
  shipToCity?: string | null;
  shipToRegion?: string | null;
  shipToCountry?: string | null;
  shipToLat?: number | null;
  shipToLng?: number | null;
  carrierService?: string | null;
  carrierConnectionId?: string | null;
  labelStatus?: string | null;
  packedAt?: number | null;
  allocatedUnits?: number;
  allocations?: OrderAllocation[];
  shopify?: { status?: string; fulfillmentId?: string | null; error?: string | null };
  lines?: OrderLine[];
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
  qtyCompleted?: number;
  remaining?: number;
  status: string;
  sku: string;
  itemName: string;
  sourceLocationId: string;
  outputLocationId: string;
  createdAt: number;
  warehouseId?: string;
  asBuilt?: AsBuiltLink[];
};

export type KitBuild = {
  id: string;
  number: string;
  itemId: string;
  qty: number;
  qtyCompleted?: number;
  remaining?: number;
  status: string;
  sku: string;
  itemName: string;
  sourceLocationId: string;
  outputLocationId: string;
  createdAt: number;
  warehouseId?: string;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  components?: { itemId: string; qty: number; sku: string; itemName: string }[];
  asBuilt?: AsBuiltLink[];
};

export type Replenishment = {
  id: string;
  number: string;
  status: string;
  itemId: string;
  qty: number;
  qtyMoved?: number;
  remaining?: number;
  sku: string;
  itemName: string;
  fromLocationId: string;
  toLocationId: string;
  fromCode?: string;
  toCode?: string;
  warehouseId?: string;
  notes?: string | null;
  createdAt: number;
  trackLot?: boolean;
  trackSerial?: boolean;
};

export type ReplenishSuggestion = {
  itemId: string;
  sku: string;
  itemName: string;
  pickMin: number;
  pickQty: number;
  fromLocationId: string;
  fromCode: string;
  toLocationId: string;
  toCode: string;
  qty: number;
  warehouseId: string;
};

export type ShippingLabel = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  shipToAddress: string;
  shipFromAddress?: string | null;
  carrierCompany: string;
  carrierService: string;
  carrierServiceId: string;
  trackingNumber: string;
  trackingUrl: string;
  connectionId?: string | null;
  labelStatus?: string | null;
};

export type CarrierServiceOption = {
  id: string;
  company: string;
  service: string;
  connectionId: string | null;
  provider: string;
  isDefault?: boolean;
};

export type CarrierCatalogProvider = {
  id: string;
  name: string;
  kind: string;
  description: string;
  credentialFields: string[];
  services: { id: string; company: string; service: string }[];
};

export type CarrierConnection = {
  id: string;
  provider: string;
  name: string;
  kind: string;
  nickname: string;
  accountNumber: string | null;
  mode: string;
  status: string;
  isDefault: boolean;
  enabledServices: string[];
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasMeterNumber: boolean;
  apiKeyHint: string | null;
  apiSecretHint: string | null;
  meterHint: string | null;
  lastTestedAt: number | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
};

export type CarrierHub = {
  catalog: CarrierCatalogProvider[];
  connections: CarrierConnection[];
  enabledServices: CarrierServiceOption[];
  shipFromAddress: string | null;
  warehouseId: string | null;
};

export type CarrierRate = CarrierServiceOption & {
  amountCents: number;
  currency: string;
  transitDays: number;
};

export type CarrierOutbound = {
  id: string;
  connectionId: string | null;
  orderId: string | null;
  kind: string;
  status: string;
  createdAt: number;
  request: unknown;
  response: unknown;
};

export type PutawaySuggestion = {
  itemId: string;
  sku: string;
  itemName: string;
  qty: number;
  fromLocationId: string;
  fromCode: string;
  fromBarcode: string;
  toLocationId: string;
  toCode: string;
  toBarcode: string;
  warehouseId: string;
};

export type Dashboard = {
  onHandUnits: number;
  binRows: number;
  skuCount: number;
  allocatedUnits?: number;
  openReceipts: number;
  openOrders: number;
  openWorkOrders: number;
  shopifyOpenOrders: number;
  openTransfers: number;
  putawayDue?: number;
  openCycleCounts: number;
  countVariances?: number;
  openHolds?: number;
  openPurchases: number;
  openReturns: number;
  openVendorReturns?: number;
  openReplenishments?: number;
  openKits?: number;
  openWaves?: number;
  openAsns?: number;
  openYard?: number;
  openCheckouts?: number;
  outOfService?: number;
  expiringCerts?: number;
  replenishDue?: number;
  expiringLots?: number;
  lowStock: { itemId: string; sku: string; name: string; onHand: number; reorderPoint: number }[];
  recent: { id: string; type: string; qty: number; createdAt: number; sku: string }[];
  hotBays: { locationId: string; locationCode: string; locationName: string; units: number }[];
  replenishSuggestions?: ReplenishSuggestion[];
  putawaySuggestions?: PutawaySuggestion[];
  queues: {
    receipts: Receipt[];
    orders: Order[];
    workOrders: WorkOrder[];
    putaways: Transfer[];
    counts: CycleCount[];
    countVariances?: CountVariance[];
    holds?: Hold[];
    purchases: Purchase[];
    returns: Rma[];
    vendorReturns?: VendorReturn[];
    replenishments?: Replenishment[];
    kits?: KitBuild[];
    waves?: Wave[];
    asns?: Asn[];
    yard?: YardVisit[];
    checkouts?: EquipmentCheckout[];
    outOfService?: Equipment[];
    expiringCerts?: OperatorCertification[];
    shopifyExceptions: Order[];
    expiringLots?: {
      locationId: string;
      locationCode: string;
      itemId: string;
      sku: string;
      itemName: string;
      lotCode: string;
      qty: number;
      expiresOn: number | null;
    }[];
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
  purchases: Pick<Purchase, "id" | "number" | "vendorName" | "status">[];
  returns: Pick<Rma, "id" | "number" | "customerName" | "status">[];
  vendorReturns?: Pick<VendorReturn, "id" | "number" | "vendorName" | "status">[];
  replenishments?: Pick<Replenishment, "id" | "number" | "status">[];
  kits?: Pick<KitBuild, "id" | "number" | "status">[];
  holds?: Pick<Hold, "id" | "number" | "status">[];
  waves?: Pick<Wave, "id" | "number" | "status">[];
  asns?: Pick<Asn, "id" | "number" | "status" | "vendorName">[];
  yard?: Pick<YardVisit, "id" | "number" | "status" | "carrierName">[];
  equipment?: Pick<Equipment, "id" | "code" | "name" | "barcode" | "status" | "class">[];
  serials?: { serialCode: string; itemId: string; sku: string; status: string }[];
};

export type TeamMember = {
  id: string;
  role: string;
  userId: string;
  name: string;
  email: string;
  floorVerbs?: string[];
};

export type Transfer = {
  id: string;
  number: string;
  status: string;
  fromLocationId: string;
  toLocationId: string;
  fromCode?: string;
  toCode?: string;
  fromBarcode?: string;
  toBarcode?: string;
  warehouseId?: string;
  toWarehouseId?: string | null;
  notes: string | null;
  lines?: { id: string; itemId: string; qty: number; qtyMoved?: number; remaining?: number; sku: string; itemName: string }[];
};

export type CountVariance = {
  id: string;
  countId: string;
  number: string;
  status: string;
  locationId: string;
  locationCode?: string;
  sku: string;
  itemName?: string;
  systemQty: number;
  countedQty: number;
  variance: number;
  postedAt?: number | null;
  warehouseId?: string;
};

export type CycleCount = {
  id: string;
  number: string;
  status: string;
  locationId: string;
  locationCode?: string;
  locationBarcode?: string;
  warehouseId?: string;
  notes: string | null;
  lines?: {
    id: string;
    itemId: string;
    systemQty: number | null;
    countedQty: number;
    entered?: boolean;
    sku: string;
    itemName: string;
    catchWeight?: boolean;
    weightGrams?: number | null;
  }[];
};

export type Hold = {
  id: string;
  number: string;
  status: string;
  warehouseId: string;
  locationId: string;
  locationCode?: string;
  locationBarcode?: string;
  itemId: string | null;
  sku?: string | null;
  itemName?: string | null;
  lotCode: string | null;
  reason: string;
  notes: string | null;
  createdAt: number;
  releasedAt: number | null;
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
  lotCode?: string | null;
  serialsJson?: string | null;
  weightGrams?: number | null;
  expiresOn?: number | null;
  equipmentId?: string | null;
  assignmentId?: string | null;
  equipmentCode?: string | null;
};

export type PurchaseLine = {
  id: string;
  itemId: string;
  qtyOrdered: number;
  qtyReceived: number;
  remaining: number;
  sku: string;
  itemName: string;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
};

export type Purchase = {
  id: string;
  number: string;
  vendorName: string;
  status: string;
  notes: string | null;
  createdAt: number;
  locationId: string | null;
  warehouseId?: string;
  lines?: PurchaseLine[];
};

export type RmaLine = {
  id: string;
  itemId: string;
  qtyExpected: number;
  qtyReceived: number;
  remaining: number;
  sku: string;
  itemName: string;
  disposition?: string;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
};

export type Rma = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  notes: string | null;
  createdAt: number;
  orderId: string | null;
  orderNumber?: string | null;
  locationId: string | null;
  warehouseId?: string;
  lines?: RmaLine[];
};

export type VendorReturnLine = {
  id: string;
  itemId: string;
  qtyExpected: number;
  qtyReturned: number;
  remaining: number;
  sku: string;
  itemName: string;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
};

export type VendorReturn = {
  id: string;
  number: string;
  vendorName: string;
  status: string;
  notes: string | null;
  createdAt: number;
  purchaseId: string | null;
  purchaseNumber?: string | null;
  locationId: string | null;
  warehouseId?: string;
  lines?: VendorReturnLine[];
};

export type FloorJob = {
  id: string;
  verb: string;
  refType: string;
  refId: string;
  status: string;
  number: string | null;
  title: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  itemId: string | null;
  fromCode: string | null;
  fromBarcode: string | null;
  toCode: string | null;
  aisle: string | null;
  qty: number | null;
  pinned: boolean;
  notBefore: number | null;
  dueAt: number | null;
  createdAt: number;
  floorPath: string;
  officePath: string;
  score?: number;
  reason?: string;
};

export type Client = {
  id: string;
  organizationId?: string;
  code: string;
  name: string;
  createdAt: number;
};

export type Zone = {
  id: string;
  organizationId?: string;
  warehouseId: string;
  code: string;
  name: string;
  createdAt: number;
};

export type WaveOrder = {
  id: string;
  number: string;
  status: string;
  customerName: string;
  warehouseId: string;
  waveId?: string | null;
  clientId?: string | null;
};

export type WaveOrderLine = {
  id: string;
  orderId: string;
  itemId: string;
  qty: number;
  qtyPicked: number;
  remaining: number;
  sku: string;
  itemName: string;
};

export type WaveBatchLine = {
  id: string;
  itemId: string;
  qty: number;
  qtyPicked: number;
  remaining: number;
  sku: string;
  itemName: string;
};

export type Wave = {
  id: string;
  number: string;
  status: string;
  mode: "wave" | "batch" | string;
  warehouseId: string;
  zoneId?: string | null;
  clientId?: string | null;
  notes?: string | null;
  createdAt: number;
  releasedAt?: number | null;
  completedAt?: number | null;
  orderCount?: number;
  orders?: WaveOrder[];
  orderLines?: WaveOrderLine[];
  batchLines?: WaveBatchLine[];
};

export type WaveOpenOrder = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  warehouseId: string;
  waveId: string | null;
  clientId: string | null;
  createdAt: number;
};

export type AsnLine = {
  id: string;
  itemId: string;
  qtyExpected: number;
  qtyReceived: number;
  remaining: number;
  sku: string;
  itemName: string;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
};

export type Asn = {
  id: string;
  number: string;
  vendorName: string;
  status: string;
  notes: string | null;
  createdAt: number;
  warehouseId: string;
  purchaseId?: string | null;
  clientId?: string | null;
  locationId?: string | null;
  eta?: number | null;
  expectedAt?: number | null;
  receivedAt?: number | null;
  lines?: AsnLine[];
};

export type YardVisit = {
  id: string;
  number: string;
  status: string;
  warehouseId: string;
  carrierName: string;
  trailerNumber?: string | null;
  dockLocationId?: string | null;
  asnId?: string | null;
  purchaseId?: string | null;
  eta?: number | null;
  notes?: string | null;
  createdAt: number;
  checkedInAt?: number | null;
  checkedOutAt?: number | null;
};

export type EquipmentAssignment = {
  id: string;
  number: string;
  equipmentId: string;
  operatorUserId: string;
  operatorName?: string | null;
  status: string;
  shift: string | null;
  refType: string | null;
  refId: string | null;
  taskNumber?: string | null;
  startedAt: number;
  endedAt?: number | null;
  startedBy?: string;
  endedBy?: string | null;
};

export type EquipmentCheckout = EquipmentAssignment & {
  equipmentCode: string;
  equipmentName?: string;
  warehouseId?: string;
};

export type EquipmentInspection = {
  id: string;
  equipmentId: string;
  assignmentId: string | null;
  result: string;
  itemsJson?: string;
  items?: { code: string; result: string; notes?: string }[];
  createdBy: string;
  createdAt: number;
};

export type EquipmentEvent = {
  id: string;
  equipmentId: string;
  assignmentId: string | null;
  type: string;
  actorUserId: string;
  payloadJson: string | null;
  createdAt: number;
};

export type Equipment = {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  class: string;
  barcode: string;
  status: string;
  notes: string | null;
  createdAt: number;
  currentAssignment?: EquipmentAssignment | null;
  checklist?: { code: string; label: string }[];
  assignments?: EquipmentAssignment[];
  events?: EquipmentEvent[];
  inspections?: EquipmentInspection[];
};

export type OperatorCertification = {
  id: string;
  userId: string;
  userName?: string;
  email?: string;
  class: string;
  expiresOn: number;
  createdAt?: number;
};

export type EquipmentAudit = {
  at: number | null;
  assignment: (EquipmentAssignment & { equipmentCode?: string; equipmentName?: string }) | null;
  assignments: (EquipmentAssignment & { equipmentCode?: string; equipmentName?: string })[];
};

export type LaborEvent = {
  id: string;
  warehouseId: string;
  userId: string;
  userName: string;
  verb: string;
  refType: string;
  refId: string;
  qty: number | null;
  durationSec: number | null;
  notes: string | null;
  createdAt: number;
};

export type LaborRollup = {
  userId: string;
  userName: string;
  events: number;
  qty: number;
  durationSec: number;
};

export type LaborBoard = {
  events: LaborEvent[];
  rollup: LaborRollup[];
};

export type Printer = {
  id: string;
  organizationId: string;
  name: string;
  connection: "browser" | "qz" | "download";
  media: "letter" | "4x6" | "2x1";
  dpi: number;
  qzPrinterName: string | null;
  isDefault: boolean;
  createdAt: number;
};

export type PrintStation = {
  id: string;
  organizationId: string;
  name: string;
  warehouseId: string | null;
  defaultPrinterId: string | null;
  bayPrinterId: string | null;
  shippingPrinterId: string | null;
  createdAt: number;
};

export type PrintJobAudit = {
  id: string;
  organizationId: string;
  printerId: string | null;
  stationId: string | null;
  kind: string;
  payloadFormat: string;
  status: string;
  refType: string | null;
  refId: string | null;
  error: string | null;
  createdAt: number;
  sentAt: number | null;
};

export type {
  TrafficDestination,
  TrafficException,
  TrafficFlight,
  TrafficGrain,
  TrafficHorizon,
  TrafficSnapshot,
} from "@/domain/traffic";
