import { createAuthClient } from "better-auth/react";
import { composeErrorText, explainError, type ExplainedError } from "@/domain/error-copy";
import type { CustomsDeclaration, CustomsGap } from "@/domain/customs";
import type { PlateStatus, PlateType } from "@/domain/license-plates";

export const authClient = createAuthClient({
  basePath: "/api/auth",
});

/**
 * A failed API call. `message` is the plain sentence plus the fix (what banners and toasts show);
 * `detail` keeps the raw server text, `code` the server's error code, `hint` the fix on its own.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  code: string | null;
  hint: string | null;
  /** The raw server text, before it was made plain. */
  detail: string;
  /** The plain sentence without the hint. */
  summary: string;

  constructor(message: string, status: number, body: unknown) {
    const explained = explainError(status, body, message);
    super(composeErrorText(explained));
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.code = explained.code;
    this.hint = explained.hint;
    this.summary = explained.message;
    this.detail = message;
    rememberExplained(this.message, explained);
  }
}

/* Banners only get the composed string, so remember how recent errors split into sentence + fix. */
const explainedByText = new Map<string, { message: string; hint: string | null }>();
const EXPLAINED_LIMIT = 50;

function rememberExplained(text: string, explained: ExplainedError) {
  if (!explained.hint) return;
  explainedByText.delete(text);
  explainedByText.set(text, { message: explained.message, hint: explained.hint });
  while (explainedByText.size > EXPLAINED_LIMIT) {
    const oldest = explainedByText.keys().next().value;
    if (oldest === undefined) break;
    explainedByText.delete(oldest);
  }
}

/** Split an error string from an `ApiError` back into its sentence and fix; any other text comes back whole. */
export function splitErrorText(text: string): { message: string; hint: string | null } {
  return explainedByText.get(text) ?? { message: text, hint: null };
}

/** The text to show for anything a write threw. */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** The raw text the server sent (`error`, or better-auth's `message`), else the status line. */
function serverMessage(data: unknown, statusText: string): string {
  if (data && typeof data === "object") {
    const record = data as { error?: unknown; message?: unknown };
    if (typeof record.error === "string" && record.error) return record.error;
    if (typeof record.message === "string" && record.message) return record.message;
  }
  return statusText || "Request failed";
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(err instanceof Error ? err.message : "Network request failed", 0, null);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await send(path, {
    ...init,
    headers,
    credentials: "include",
  });
  if (res.status === 204) {
    return undefined as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(serverMessage(data, res.statusText), res.status, data);
  }
  return data as T;
}

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append("file", file);
  const res = await send(path, {
    method: "POST",
    body,
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(serverMessage(data, res.statusText), res.status, data);
  }
  return data as T;
}

export type Me = {
  user: { id: string; name: string; email: string };
  organization: {
    id: string;
    name: string;
    operatingMode?: "garage" | "warehouse";
    brandColor?: string | null;
    logoUrl?: string | null;
    restockPolicy?: "off" | "alert" | "draft";
  };
  role: "owner" | "operator";
  floorVerbs?: string[];
  warehouses: { id: string; name: string }[];
  /** The hidden CAD lab is open to this organization (never the shared demo). */
  lab?: boolean;
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

export type ItemPack = {
  level: "inner" | "case" | "pallet";
  qty: number;
  barcode: string | null;
  weightOz: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
};

export type Item = {
  id: string;
  sku: string;
  name: string;
  type: string;
  barcode: string;
  altUom?: string | null;
  altPerStock?: number | null;
  packs?: ItemPack[];
  reorderPoint: number;
  baselineShipRate?: number | null;
  pickMin?: number;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
  imageUrl?: string | null;
  unitCostCents?: number;
  shipWeightOz?: number | null;
  shipLengthIn?: number | null;
  shipWidthIn?: number | null;
  shipHeightIn?: number | null;
  hsCode?: string | null;
  originCountry?: string | null;
  customsDescription?: string | null;
  customsValueCents?: number | null;
  /** Null means incoming QC is off. */
  qcSamplePercent?: number | null;
  makeDays?: number | null;
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

export type SlottingProposal = {
  itemId: string;
  sku: string;
  itemName: string;
  units: number;
  fromLocationId: string;
  fromCode: string;
  toLocationId: string;
  toCode: string;
  qty: number;
  transfer: { id: string; number: string } | null;
};

export type SlottingPlan = {
  created: number;
  proposals: SlottingProposal[];
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
  /** Bin capacity; null means no limit. Weight in oz, volume in cubic inches. */
  maxQty?: number | null;
  maxWeightOz?: number | null;
  maxVolumeCuIn?: number | null;
  /** Tightest limit as a whole percent (can pass 100); null when the bay has no limits. */
  fillPercent?: number | null;
};

export type MapContent = {
  itemId: string;
  sku: string;
  itemName: string;
  itemType: string;
  imageUrl?: string | null;
  qty: number;
  held?: boolean;
  holdNumber?: string | null;
  holdReason?: string | null;
  availableQty?: number;
  allocated?: number;
  suggestedLocation?: SuggestedLocation | null;
  /** Of `qty`, the units on license plates and the units loose in the bay. */
  onPlates?: number;
  loose?: number;
};

export type PlateLine = {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  imageUrl: string | null;
  qty: number;
  lotCode: string | null;
  serial: string | null;
};

/** A tote, pallet, or carton with an LP- code. Its lines are a share of its bay's stock. */
export type Plate = {
  id: string;
  code: string;
  type: PlateType;
  status: PlateStatus;
  /** Null once the plate has shipped. */
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  warehouseId: string;
  units: number;
  lines: PlateLine[];
  createdAt: number;
  updatedAt: number;
};

export type PlateDetail = Plate & {
  /** What the plate's bay holds of each item, and how much of it no plate holds yet. */
  bayStock: {
    itemId: string;
    sku: string;
    itemName: string;
    imageUrl: string | null;
    trackLot: boolean;
    trackSerial: boolean;
    qty: number;
    onPlates: number;
    loose: number;
    /** Loose units in expired lots, which go on a plate only when their lot is typed. */
    expired: number;
  }[];
};

export type PlateSummary = Pick<Plate, "id" | "code" | "type" | "status" | "units">;

export type MapLocation = Location & {
  unitsOnHand: number;
  skuCount: number;
  contents: MapContent[];
  plates?: PlateSummary[];
};

export type WarehouseMapInfo = {
  id: string;
  name: string;
  mapWidth: number;
  mapDepth: number;
  mapHeight: number;
  /** Where north points on the map, degrees clockwise from the top edge; missing means 0. */
  mapNorth?: number;
  shipFromAddress?: string | null;
  /** Where customer return labels are addressed; blank means the ship-from address. */
  returnAddress?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  timeZone?: string | null;
  defaultCarrierService?: string | null;
  defaultCarrierConnectionId?: string | null;
  /** `RateStrategy` from `domain/ship-rules.ts`. */
  rateStrategy?: string;
  deliveryDays?: number | null;
};

export type LiveFlowId = "inbound" | "outbound" | "make" | "stock" | "yard";
export type LivePresence = "working" | "idle" | "clear";

export type LiveDay = {
  asOf: number;
  timeZone: string;
  dayStart: number;
  warehouse: { id: string; name: string };
  pulse: {
    unitsDone: number;
    unitsRemaining: number;
    pacePerHour: number | null;
    clearBy: number | null;
    peopleWorking: number;
    peopleIdle: number;
  };
  flows: {
    id: LiveFlowId;
    done: number;
    remaining: number;
    visits?: {
      id: string;
      number: string;
      status: string;
      carrierName: string;
      trailerNumber: string | null;
      dockCode: string | null;
      eta: number | null;
    }[];
  }[];
  people: {
    userId: string;
    name: string;
    initials: string;
    state: LivePresence;
    verb: string | null;
    jobId: string | null;
    documentNumber: string | null;
    documentTo: string | null;
    lastBay: { locationId: string; code: string; posX: number; posY: number } | null;
    lastAt: number | null;
    unitsToday: number;
    equipmentCode: string | null;
  }[];
  attention: {
    id: string;
    kind: "idle" | "due" | "dock" | "tracker";
    title: string;
    detail: string;
    to: string;
    jobId: string | null;
  }[];
  activity: {
    id: string;
    at: number;
    userId: string;
    userName: string;
    verb: string;
    qty: number;
    sku: string | null;
    bayCode: string | null;
    summary: string;
  }[];
  team: { userId: string; name: string }[];
};

export type WarehouseMapData = {
  warehouse: WarehouseMapInfo;
  warehouses: WarehouseMapInfo[];
  locations: MapLocation[];
  /** Zones on this floor; a zero size means the zone is a tag only and is not drawn. */
  zones?: Zone[];
};

export type ScanLocationHit = {
  kind: "location";
  location: Location;
  contents: MapContent[];
  holds?: Hold[];
  plates?: Plate[];
};

export type ScanPlateHit = { kind: "plate"; plate: Plate };

export type ScanItemHit = {
  kind: "item";
  item: Item;
  /** Set when the scan was a pack barcode: it counts `pack.qty` eaches. */
  pack?: ItemPack | null;
  packs?: ItemPack[];
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
export type ScanAsnHit = { kind: "asn"; asn: Asn; package?: AsnPackage };
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
  | ScanLotHit
  | ScanPlateHit;

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
  imageUrl?: string | null;
  itemId: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  locationType?: string;
  updatedAt?: number;
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
  imageUrl?: string | null;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
  qcSamplePercent?: number | null;
  makeDays?: number | null;
};

export type ReceiptQcSample = {
  id: string;
  receiptLineId: string;
  itemId: string;
  sku: string;
  itemName: string;
  locationId: string;
  qty: number;
  status: string;
  photoUrl?: string | null;
  holdId?: string | null;
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
  qc?: ReceiptQcSample[];
  /** Units still waiting on a QC decision. */
  openQc?: number;
};

export type SuggestedLocation = {
  locationId: string;
  locationCode: string;
  locationName: string;
  barcode: string;
  qty: number;
  /** Putaway only: eaches that still fit under the bay's capacity. Null means no limit. */
  room?: number | null;
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
  qtyCartoned?: number;
  qtyShipped?: number;
  cartonRemaining?: number;
  allocatedQty?: number;
  softReservedQty?: number;
  reservedQty?: number;
  shortQty?: number;
  allocations?: OrderAllocation[];
  sku: string;
  itemName: string;
  imageUrl?: string | null;
  barcode?: string | null;
  shopifyLineItemId?: string | null;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
  stockUom?: string | null;
  altUom?: string | null;
  altPerStock?: number | null;
  suggestedLocation?: SuggestedLocation | null;
};

export type Order = {
  id: string;
  number: string;
  customerName: string;
  customerId?: string | null;
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
  externalOrderId?: string | null;
  channelSyncStatus?: string | null;
  channelSyncError?: string | null;
  trackingNumber?: string | null;
  trackingCompany?: string | null;
  trackingUrl?: string | null;
  trackingToken?: string | null;
  customsFormUrl?: string | null;
  shipToAddress?: string | null;
  shipToCity?: string | null;
  shipToRegion?: string | null;
  shipToCountry?: string | null;
  shipToLat?: number | null;
  shipToLng?: number | null;
  carrierService?: string | null;
  carrierConnectionId?: string | null;
  labelStatus?: string | null;
  packageWeightOz?: number | null;
  packageLengthIn?: number | null;
  packageWidthIn?: number | null;
  packageHeightIn?: number | null;
  postageCents?: number | null;
  trackerStatus?: string | null;
  packedAt?: number | null;
  waveId?: string | null;
  clientId?: string | null;
  parentOrderId?: string | null;
  parent?: { id: string; number: string } | null;
  backorders?: { id: string; number: string; status: string }[];
  allocatedUnits?: number;
  reservedUnits?: number;
  shortUnits?: number;
  allocations?: OrderAllocation[];
  packages?: OrderPackage[];
  shopify?: { status?: string; fulfillmentId?: string | null; error?: string | null };
  lines?: OrderLine[];
};

export type OrderPackageLine = {
  id: string;
  packageId: string;
  orderLineId: string;
  itemId: string;
  qty: number;
  sku: string;
  itemName: string;
};

export type OrderPackage = {
  id: string;
  number: string;
  seq: number;
  weightOz?: number | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
  trackingNumber?: string | null;
  trackingCompany?: string | null;
  trackingUrl?: string | null;
  carrierService?: string | null;
  labelStatus?: string | null;
  postageCents?: number | null;
  trackerStatus?: string | null;
  shippedAt?: number | null;
  shopifyFulfillmentId?: string | null;
  units?: number;
  lines?: OrderPackageLine[];
};

export type ChannelHealth = "disconnected" | "csv" | "live" | "demo" | "error" | "pending" | "paused";

export type ChannelStatus = {
  id: "shopify" | "woocommerce" | "etsy" | "faire";
  name: string;
  auth: "oauth" | "api_key" | "csv";
  liveOrders: boolean;
  trackingPostBack: boolean;
  csvImport: boolean;
  blurb: string;
  health: ChannelHealth;
  mode: string | null;
  externalShop: string | null;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  webhookUrl: string | null;
  /** False when the deployment lacks the channel's app keys (Etsy). */
  configured: boolean;
  openOrders: number;
  failedPostBacks: number;
  setupPath: string;
};

export type ChannelsPayload = { operatingMode: "garage" | "warehouse"; channels: ChannelStatus[] };

export type ShopifyConnection = {
  connected: boolean;
  shopDomain: string | null;
  mode: string;
  apiVersion: string;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
  tokenHint: string | null;
  shopifyLocationGid?: string | null;
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

export type ShopifySellableRow = {
  itemId: string;
  sku: string;
  name: string;
  onHand: number;
  held: number;
  remainingToPick: number;
  available: number;
  sellable: number;
  shopifyInventoryItemGid: string | null;
};

export type ShopifyLocation = {
  id: string;
  name: string;
  fulfillsOnlineOrders?: boolean | null;
};

export type ShopifyInventory = {
  connected: boolean;
  mode: string | null;
  locationGid: string | null;
  rows: ShopifySellableRow[];
};

export type ShopifyInventorySync = {
  status: "synced" | "demo" | "skipped" | "failed";
  locationGid: string | null;
  rows: Array<{ sku: string; sellable: number; inventoryItemId: string }>;
  skipped: Array<{ sku: string; reason: string }>;
  error?: string | null;
  code?: string | null;
};

export type WorkCenter = {
  id: string;
  code: string;
  name: string;
};

export type BomStep = {
  id: string;
  seq: number;
  title: string;
  body: string;
  imageUrl?: string | null;
  componentItemId?: string | null;
  componentSku?: string | null;
  componentName?: string | null;
  componentImageUrl?: string | null;
  workCenterId?: string | null;
  workCenterCode?: string | null;
  workCenterName?: string | null;
};

export type BomLine = {
  id: string;
  itemId: string;
  qty: number;
  sku: string;
  itemName: string;
  imageUrl?: string | null;
};

export type Bom = {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  imageUrl?: string | null;
  lines: BomLine[];
  steps?: BomStep[];
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
  imageUrl?: string | null;
  sourceLocationId: string;
  outputLocationId: string;
  createdAt: number;
  warehouseId?: string;
  parentWorkOrderId?: string | null;
  parentNumber?: string | null;
  children?: { id: string; number: string; itemId: string; sku: string; itemName: string; qty: number; qtyCompleted?: number; status: string }[];
  asBuilt?: AsBuiltLink[];
  components?: { id?: string; itemId: string; qty: number; sku: string; itemName: string; imageUrl?: string | null }[];
  steps?: BomStep[];
  confirmations?: { stepId: string; qty: number }[];
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
  imageUrl?: string | null;
  sourceLocationId: string;
  outputLocationId: string;
  createdAt: number;
  warehouseId?: string;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  components?: { id?: string; itemId: string; qty: number; sku: string; itemName: string; imageUrl?: string | null }[];
  steps?: BomStep[];
  confirmations?: { stepId: string; qty: number }[];
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
  packageNumber?: string | null;
};

export type ItemCustoms = Required<Pick<Item, "id" | "sku" | "hsCode" | "originCountry" | "customsDescription" | "customsValueCents">>;

export type { CustomsDeclaration, CustomsGap };

/** `GET /api/orders/:id/customs`: what prints with an international label. */
export type OrderCustoms = {
  international: boolean;
  fromCountry: string | null;
  toCountry: string | null;
  /** The carrier's own customs form for this label, when it returned one. */
  formUrl: string | null;
  formKind: "CN22" | "CN23" | null;
  declaration: CustomsDeclaration | null;
  /** The declaration is the one the label's purchase sent, rather than what the items say now. */
  declared: boolean;
  gaps: CustomsGap[];
};

/** `GET /api/orders/:id/address`: the check a label purchase and quick-ship run on the ship-to address. */
export type OrderAddressCheck = {
  orderId: string;
  /** False once the order has a label, has shipped, or is cancelled. */
  editable: boolean;
  blocked: boolean;
  /** Someone chose to ship to this exact address as it is. */
  overridden: boolean;
  message: string | null;
  /** The carrier's corrected address on one line. */
  suggestion: string | null;
};

export type TrackingLink = { token: string; path: string; url: string };

export type PublicTrackingEvent = {
  at: number;
  status: string | null;
  label: string;
  message: string | null;
  place: string | null;
};

export type PublicTrackingPackage = {
  label: string;
  carrier: string | null;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string | null;
  statusLabel: string;
  estimatedDeliveryAt: number | null;
  deliveredAt: number | null;
  events: PublicTrackingEvent[];
  items: { name: string; qty: number }[];
};

/** `GET /api/track/:token`, the customer's tracking page (`src/domain/tracking-page.ts`). */
export type PublicTracking = {
  shop: { name: string; brandColor: string | null; logoUrl: string | null };
  order: {
    number: string;
    status: "processing" | "shipped" | "delivered" | "cancelled";
    shippedAt: number | null;
    destination: string | null;
  };
  packages: PublicTrackingPackage[];
  items: { name: string; qty: number }[];
};

export type ReturnLabel = {
  id: string;
  rmaId: string;
  status: "active" | "voided";
  statusLabel: string;
  carrierConnectionId: string | null;
  carrierCompany: string;
  carrierService: string;
  serviceName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  /** The carrier's printable label; null for demo labels, which print from the customer page. */
  labelUrl: string | null;
  postageCents: number | null;
  trackerStatus: string | null;
  trackerUpdatedAt: number | null;
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  weightOz: number | null;
  createdAt: number;
  voidedAt: number | null;
  /** The customer's page, `/r/:token`. */
  path: string;
  url: string;
};

/** What a new return label starts with: the original order's ship-to and service, and the building's return address. */
export type ReturnLabelDraft = {
  fromName: string;
  fromAddress: string | null;
  toName: string;
  toAddress: string | null;
  carrierService: string;
  carrierConnectionId: string | null;
};

export type RmaReturnLabels = { labels: ReturnLabel[]; draft: ReturnLabelDraft };

export type PublicReturnLabel = {
  shop: { name: string; brandColor: string | null; logoUrl: string | null };
  rmaNumber: string;
  status: "active" | "voided";
  statusLabel: string;
  trackerStatus: string | null;
  label: {
    carrier: string;
    service: string;
    trackingNumber: string;
    trackingUrl: string | null;
    labelUrl: string | null;
    from: { name: string; address: string };
    to: { name: string; address: string };
  } | null;
  events: PublicTrackingEvent[];
  items: { name: string; qty: number }[];
  createdAt: number;
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
  hasWebhookSecret?: boolean;
  webhookSecretHint?: string | null;
  /** This account's tracker URL. The hub also keeps the older shared URL. */
  trackerWebhookUrl?: string;
};

export type CarrierHub = {
  catalog: CarrierCatalogProvider[];
  connections: CarrierConnection[];
  enabledServices: CarrierServiceOption[];
  shipFromAddress: string | null;
  warehouseId: string | null;
  /** This building's default service; null when unset or its carrier account no longer offers it. */
  defaultService?: { serviceId: string; connectionId: string | null } | null;
  trackerWebhookUrl?: string;
};

export type CarrierRate = CarrierServiceOption & {
  amountCents: number;
  currency: string;
  transitDays: number;
  liveRateId?: string | null;
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

export type CartonPutawaySuggestion = {
  asnId: string;
  asnNumber: string;
  packageId: string;
  packageNumber: string;
  sscc?: string | null;
  fromLocationId: string;
  fromCode: string;
  fromBarcode: string;
  warehouseId: string;
  lines: {
    itemId: string;
    sku: string;
    itemName: string;
    qty: number;
    lotCode?: string | null;
    toLocationId?: string | null;
    toCode?: string | null;
    toBarcode?: string | null;
  }[];
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
  lowStock: {
    itemId: string;
    sku: string;
    name: string;
    onHand: number;
    reorderPoint: number;
    lastVendorName?: string | null;
    suggestedQty?: number;
    coveredByOpenPo?: boolean;
  }[];
  runwayThisWeek?: {
    itemId: string;
    sku: string;
    name: string;
    sellable: number;
    daysOfCover: number | null;
    stockoutAt: number | null;
    status: string;
    suggestedQty: number;
    coveredByOpenPo: boolean;
    lastVendorName: string | null;
  }[];
  recent: { id: string; type: string; qty: number; createdAt: number; sku: string }[];
  /** Units per local day for the last 7 days, oldest first. */
  trend?: { start: number; received: number; picked: number; shipped: number; built: number; shippedOrders: number }[];
  timeZone?: string;
  hotBays: { locationId: string; locationCode: string; locationName: string; units: number }[];
  replenishSuggestions?: ReplenishSuggestion[];
  putawaySuggestions?: PutawaySuggestion[];
  cartonPutaways?: CartonPutawaySuggestion[];
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
    trackerExceptions?: TrackerException[];
    cartonPutaways?: CartonPutawaySuggestion[];
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
  invite?: "emailed" | "password" | "created";
};

export type AuditEvent = {
  id: string;
  actorUserId: string | null;
  actorEmail: string;
  actorName: string;
  action: string;
  method: string;
  path: string;
  status: number;
  code: string | null;
  summary: string;
  createdAt: number;
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
  createdAt?: number;
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
  refType?: string;
  refId?: string;
  sku: string;
  itemName: string;
  reason: string | null;
  createdAt: number;
  createdBy?: string | null;
  createdByName?: string | null;
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
  imageUrl?: string | null;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
  unitCostCents?: number | null;
};

export type Purchase = {
  id: string;
  number: string;
  vendorName: string;
  vendorId?: string | null;
  vendor?: Vendor | null;
  status: string;
  notes: string | null;
  createdAt: number;
  orderedAt?: number | null;
  locationId: string | null;
  warehouseId?: string;
  asns?: Asn[];
  send?: PurchaseSend | null;
  sends?: PurchaseSend[];
  mintedAsnId?: string | null;
  lines?: PurchaseLine[];
};

export type PurchaseSend = {
  id: string;
  purchaseId: string;
  toAddress: string | null;
  subject: string | null;
  body: string;
  mode: string;
  createdAt: number;
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
  customerId?: string | null;
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
  vendorId?: string | null;
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
  /** Null uses the organization rate. */
  storageCentsPerPiece?: number | null;
  pickCentsPerUnit?: number | null;
  cartonCents?: number | null;
  portalEnabled?: boolean;
};

export type Zone = {
  id: string;
  organizationId?: string;
  warehouseId: string;
  code: string;
  name: string;
  createdAt: number;
  /** The rectangle drawn on the floor; sizes of 0 mean none. */
  posX: number;
  posY: number;
  sizeX: number;
  sizeY: number;
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

export type WavePlanGroup = {
  key: string;
  carrier: string | null;
  cutoffAt: number;
  cutoffLabel: string;
  urgency: "missed" | "now" | "today" | "later";
  minutesLeft: number;
  missedToday: boolean;
  zoneId: string | null;
  zoneName: string | null;
  clientId: string | null;
  clientName: string | null;
  orderIds: string[];
  numbers: string[];
  units: number;
};

export type WavePlan = {
  asOf: number;
  timeZone: string;
  cutoffs: { carrier: string; minutes: number; label: string; set: boolean }[];
  groups: WavePlanGroup[];
  waiting: { orderId: string; number: string; reason: string }[];
  unwaved: number;
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
  qtyCartoned?: number;
  cartonRemaining?: number;
  sku: string;
  itemName: string;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
};

export type AsnPackageLine = {
  id: string;
  packageId: string;
  asnLineId: string;
  itemId: string;
  qty: number;
  sku: string;
  itemName: string;
  lotCode?: string | null;
  serials?: string[];
  weightGrams?: number | null;
  expiresOn?: number | null;
};

export type AsnPackage = {
  id: string;
  number: string;
  seq: number;
  sscc?: string | null;
  receivedAt?: number | null;
  putawayAt?: number | null;
  units?: number;
  lines?: AsnPackageLine[];
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
  containerNumber?: string | null;
  departedAt?: number | null;
  milestone?: string | null;
  lines?: AsnLine[];
  packages?: AsnPackage[];
};

export type TrackerException = {
  id: string;
  orderId: string;
  number: string;
  packageNumber?: string | null;
  trackingNumber?: string | null;
  trackerStatus: string;
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

export type {
  LaborDailyPoint,
  LaborDocumentRow,
  LaborKpiBoard,
  LaborMatrixCell,
  LaborSkuDetail,
  LaborSkuRow,
  LaborStaffDetail,
  LaborStaffRow,
  LaborVerbMix,
} from "@/domain/labor-kpis";

export type LaborClock = {
  id: string;
  organizationId: string;
  warehouseId: string;
  userId: string;
  verb: string;
  refType: string;
  refId: string;
  startedAt: number;
  endedAt: number | null;
  durationSec: number | null;
  elapsedSec?: number;
};

export type LaborBoard = import("@/domain/labor-kpis").LaborKpiBoard & {
  range: { from: number; to: number; preset: string };
  events: LaborEvent[];
  rollup: LaborRollup[];
  openClocks: LaborClock[];
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

export type {
  RunwayBoard,
  RunwayDailyPoint,
  RunwayDraftLine,
  RunwayKpis,
  RunwayRow,
  RunwayStatus,
  RunwayWindow,
} from "@/domain/runway";

export type PackagePreset = {
  id: string;
  name: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  tareOz: number;
  isDefault: boolean;
  innerLengthIn: number | null;
  innerWidthIn: number | null;
  innerHeightIn: number | null;
  maxWeightOz: number | null;
};

export type ShipQueueOrder = {
  id: string;
  number: string;
  status: string;
  source: string;
  customerName: string;
  createdAt: number;
  shippedAt: number | null;
  shipToAddress: string | null;
  shipToCity: string | null;
  shipToRegion: string | null;
  shipToCountry: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  postageCents: number | null;
  lines: { id: string; sku: string; itemName: string; imageUrl: string | null; qty: number; shipWeightOz: number | null }[];
  parcel: { weightOz?: number; lengthIn?: number; widthIn?: number; heightIn?: number };
  missingWeight: string[];
  /** The box quick-ship would use and why; null once shipped or when there are no boxes. */
  box: {
    presetId: string;
    name: string;
    source: "picked" | "rule" | "auto" | "default" | null;
    reason: string | null;
    /** Why no box was picked automatically: `No ship size on CORD`, `Too big for every box`. */
    note: string | null;
    tooBig: boolean;
  } | null;
  serviceId: string | null;
  serviceName: string | null;
  /** `Rule: Small parcels`, `Default service`, `Order's service`, `Cheapest`. */
  serviceReason: string | null;
  serviceLive: boolean;
  /** The chosen service's quote. `arrivesOn` is `YYYY-MM-DD`; `late` means after the delivery promise. */
  quote: { amountCents: number; arrivesOn: string; late: boolean } | null;
  /** The rate choice is made when the order ships, because a live carrier account has not quoted it yet. */
  quotePending: boolean;
  rule: { id: string; name: string } | null;
  /** Written when quick-ship bought the label: `Mailer (Auto) · UPS Ground (Cheapest)`. */
  shipReason: string | null;
  ready: boolean;
  /**
   * `itemId` is set when the fix is on an item, as for `CUSTOMS_REQUIRED`. `suggestion` is the carrier's corrected
   * address on one line, for `ADDRESS_INVALID`.
   */
  blocker: { code: string; error: string; sku: string | null; itemId?: string | null; suggestion?: string | null } | null;
};

/** `POST /api/ship/decide`: one order's box, service, and quote at a given weight, and what would stop quick-ship. */
export type ShipDecisionView = { orderId: string } & Pick<
  ShipQueueOrder,
  "parcel" | "missingWeight" | "box" | "serviceId" | "serviceName" | "serviceReason" | "serviceLive" | "quote" | "quotePending" | "rule" | "ready" | "blocker"
>;

export type ShipServiceChoice = { id: string; name: string; company: string; connectionId: string | null; provider: string };

export type ShipQueue = {
  policy: { mode: "garage" | "warehouse"; quickShip: boolean };
  presets: PackagePreset[];
  services: ShipServiceChoice[];
  defaults: {
    presetId: string | null;
    carrierService: string | null;
    carrierConnectionId: string | null;
    rateStrategy: import("@/domain/ship-rules").RateStrategy;
    deliveryDays: number | null;
  };
  setup: { id: string; label: string; done: boolean; to: string }[];
  orders: ShipQueueOrder[];
};

export type QuickShipOutcome =
  | { orderId: string; ok: true; number: string; trackingNumber: string | null; manualPostBack?: boolean }
  | { orderId: string; ok: false; number?: string; status: number; code?: string; error: string };

export type QuickShipBatch = { shipped: number; failed: number; total: number; outcomes: QuickShipOutcome[] };

export type Vendor = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  makeDays: number | null;
  transitMode: string | null;
  transitDays: number | null;
  bufferDays: number | null;
  currency: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  purchaseCount?: number;
  openPurchaseCount?: number;
  lastPurchaseAt?: number | null;
};

export type VendorCost = {
  itemId: string;
  sku: string;
  itemName: string;
  unitCostCents: number | null;
  qtyOrdered: number;
  purchaseId: string;
  purchaseNumber: string;
  at: number;
};

export type VendorDetail = {
  vendor: Vendor;
  purchases: (Omit<Purchase, "lines"> & { open: boolean; lineCount: number; unitsOrdered: number; unitsReceived: number; totalCents: number | null })[];
  lastCosts: VendorCost[];
  vendorReturns: VendorReturn[];
};

export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  shipToAddress: string | null;
  notes: string | null;
  channelRefs: { channel: string; ref: string }[];
  createdAt: number;
  updatedAt: number;
  orderCount?: number;
  openOrderCount?: number;
  lastOrderAt?: number | null;
  returnCount?: number;
};

export type CustomerDetail = {
  customer: Customer;
  orders: (Omit<Order, "lines"> & { open: boolean; lines: { sku: string; itemName: string; qty: number }[] })[];
  returns: Rma[];
};

export type ShipRuleRow = import("@/domain/ship-rules").ShipRule & {
  createdAt: number;
  updatedAt: number;
  /** Set when no connected carrier account offers the rule's service. */
  problem: string | null;
};

export type ShipRulesPayload = {
  rules: ShipRuleRow[];
  presets: PackagePreset[];
  services: ShipServiceChoice[];
  warehouses: { id: string; name: string }[];
};
