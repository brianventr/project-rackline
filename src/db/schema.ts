import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
});

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    floorVerbs: text("floor_verbs"),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.organizationId, t.userId)],
);

export const warehouses = sqliteTable("warehouses", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  mapWidth: integer("map_width").notNull().default(42),
  mapDepth: integer("map_depth").notNull().default(28),
  mapHeight: integer("map_height").notNull().default(8),
  shipFromAddress: text("ship_from_address"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  lat: real("lat"),
  lng: real("lng"),
});

export const locations = sqliteTable(
  "locations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    barcode: text("barcode").notNull(),
    area: text("area").notNull().default("floor"),
    aisle: text("aisle"),
    rack: text("rack"),
    bay: text("bay"),
    level: integer("level").notNull().default(1),
    posX: integer("pos_x").notNull().default(0),
    posY: integer("pos_y").notNull().default(0),
    posZ: integer("pos_z").notNull().default(0),
    sizeX: integer("size_x").notNull().default(4),
    sizeY: integer("size_y").notNull().default(3),
    sizeZ: integer("size_z").notNull().default(2),
    slotRole: text("slot_role").notNull().default("none"),
    zoneId: text("zone_id"),
  },
  (t) => [
    uniqueIndex("locations_org_wh_code").on(t.organizationId, t.warehouseId, t.code),
    uniqueIndex("locations_org_barcode").on(t.organizationId, t.barcode),
  ],
);

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    barcode: text("barcode").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    reorderPoint: integer("reorder_point").notNull().default(0),
    baselineShipRate: real("baseline_ship_rate"),
    pickMin: integer("pick_min").notNull().default(0),
    trackLot: integer("track_lot", { mode: "boolean" }).notNull().default(false),
    trackSerial: integer("track_serial", { mode: "boolean" }).notNull().default(false),
    catchWeight: integer("catch_weight", { mode: "boolean" }).notNull().default(false),
    trackExpiry: integer("track_expiry", { mode: "boolean" }).notNull().default(false),
    stockUom: text("stock_uom").notNull().default("ea"),
    altUom: text("alt_uom"),
    altPerStock: integer("alt_per_stock"),
    shopifyInventoryItemGid: text("shopify_inventory_item_gid"),
  },
  (t) => [
    uniqueIndex("items_org_sku").on(t.organizationId, t.sku),
    uniqueIndex("items_org_barcode").on(t.organizationId, t.barcode),
  ],
);

export const inventoryBalances = sqliteTable(
  "inventory_balances",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("balances_org_loc_item").on(t.organizationId, t.locationId, t.itemId)],
);

export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qty: integer("qty").notNull(),
    fromLocationId: text("from_location_id"),
    toLocationId: text("to_location_id"),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    reason: text("reason"),
    createdAt: integer("created_at").notNull(),
    createdBy: text("created_by").notNull(),
    lotCode: text("lot_code"),
    serialsJson: text("serials_json"),
    weightGrams: integer("weight_grams"),
    expiresOn: integer("expires_on"),
    equipmentId: text("equipment_id"),
    assignmentId: text("assignment_id"),
    clientId: text("client_id"),
  },
  (t) => [
    index("movements_org_created").on(t.organizationId, t.createdAt),
    index("movements_org_user_created").on(t.organizationId, t.createdBy, t.createdAt),
    index("movements_org_item_created").on(t.organizationId, t.itemId, t.createdAt),
    index("inventory_movements_equipment").on(t.equipmentId),
    index("inventory_movements_assignment").on(t.assignmentId),
  ],
);

export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  status: text("status").notNull(),
  locationId: text("location_id"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  receivedAt: integer("received_at"),
  clientId: text("client_id"),
});

export const receiptLines = sqliteTable(
  "receipt_lines",
  {
    id: text("id").primaryKey(),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qty: integer("qty").notNull(),
    qtyReceived: integer("qty_received").notNull().default(0),
  },
  (t) => [uniqueIndex("receipt_lines_receipt_item").on(t.receiptId, t.itemId)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    number: text("number").notNull(),
    customerName: text("customer_name").notNull(),
    status: text("status").notNull(),
    pickLocationId: text("pick_location_id"),
    createdAt: integer("created_at").notNull(),
    pickedAt: integer("picked_at"),
    packedAt: integer("packed_at"),
    shippedAt: integer("shipped_at"),
    source: text("source").notNull().default("manual"),
    shopifyOrderId: text("shopify_order_id"),
    shopifyOrderGid: text("shopify_order_gid"),
    shopifyOrderName: text("shopify_order_name"),
    shopifyFulfillmentOrderId: text("shopify_fulfillment_order_id"),
    shopifyFulfillmentId: text("shopify_fulfillment_id"),
    shopifySyncStatus: text("shopify_sync_status").notNull().default("none"),
    shopifySyncError: text("shopify_sync_error"),
    shopifyFulfilledAt: integer("shopify_fulfilled_at"),
    shopifyShopDomain: text("shopify_shop_domain"),
    trackingNumber: text("tracking_number"),
    trackingCompany: text("tracking_company"),
    trackingUrl: text("tracking_url"),
    shipToAddress: text("ship_to_address"),
    carrierService: text("carrier_service"),
    carrierConnectionId: text("carrier_connection_id"),
    labelStatus: text("label_status").notNull().default("none"),
    waveId: text("wave_id"),
    clientId: text("client_id"),
    shipToCity: text("ship_to_city"),
    shipToRegion: text("ship_to_region"),
    shipToCountry: text("ship_to_country"),
    shipToLat: real("ship_to_lat"),
    shipToLng: real("ship_to_lng"),
    packageWeightOz: integer("package_weight_oz"),
    packageLengthIn: integer("package_length_in"),
    packageWidthIn: integer("package_width_in"),
    packageHeightIn: integer("package_height_in"),
    carrierShipmentId: text("carrier_shipment_id"),
    carrierLabelId: text("carrier_label_id"),
    postageCents: integer("postage_cents"),
    trackerStatus: text("tracker_status"),
    trackerUpdatedAt: integer("tracker_updated_at"),
  },
  (t) => [
    uniqueIndex("shopify_orders_org_order").on(t.organizationId, t.shopifyOrderId),
    index("orders_org_status_shipped").on(t.organizationId, t.status, t.shippedAt),
  ],
);

export const orderLines = sqliteTable("order_lines", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  qty: integer("qty").notNull(),
  qtyPicked: integer("qty_picked").notNull().default(0),
  qtyPacked: integer("qty_packed").notNull().default(0),
  shopifyLineItemId: text("shopify_line_item_id"),
  shopifyFulfillmentLineItemId: text("shopify_fulfillment_line_item_id"),
});

export const orderPackages = sqliteTable(
  "order_packages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    seq: integer("seq").notNull(),
    weightOz: integer("weight_oz"),
    lengthIn: integer("length_in"),
    widthIn: integer("width_in"),
    heightIn: integer("height_in"),
    trackingNumber: text("tracking_number"),
    trackingCompany: text("tracking_company"),
    trackingUrl: text("tracking_url"),
    carrierService: text("carrier_service"),
    carrierConnectionId: text("carrier_connection_id"),
    carrierShipmentId: text("carrier_shipment_id"),
    carrierLabelId: text("carrier_label_id"),
    postageCents: integer("postage_cents"),
    labelStatus: text("label_status").notNull().default("none"),
    trackerStatus: text("tracker_status"),
    trackerUpdatedAt: integer("tracker_updated_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("order_packages_order_number").on(t.orderId, t.number),
    index("order_packages_org_tracking").on(t.organizationId, t.trackingNumber),
  ],
);

export const orderPackageLines = sqliteTable(
  "order_package_lines",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id")
      .notNull()
      .references(() => orderPackages.id, { onDelete: "cascade" }),
    orderLineId: text("order_line_id")
      .notNull()
      .references(() => orderLines.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qty: integer("qty").notNull(),
  },
  (t) => [uniqueIndex("order_package_lines_pkg_line").on(t.packageId, t.orderLineId)],
);

export const shopifyConnections = sqliteTable(
  "shopify_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    shopDomain: text("shop_domain").notNull(),
    accessToken: text("access_token"),
    webhookSecret: text("webhook_secret").notNull(),
    apiVersion: text("api_version").notNull().default("2026-07"),
    shopifyLocationGid: text("shopify_location_gid"),
    mode: text("mode").notNull().default("demo"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("shopify_connections_org").on(t.organizationId),
    uniqueIndex("shopify_connections_shop").on(t.shopDomain),
  ],
);

export const shopifyWebhookReceipts = sqliteTable("shopify_webhook_receipts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  shopDomain: text("shop_domain").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const shopifyOutboundEvents = sqliteTable("shopify_outbound_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  orderId: text("order_id").references(() => orders.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  requestJson: text("request_json").notNull(),
  responseJson: text("response_json"),
  createdAt: integer("created_at").notNull(),
});

export const carrierConnections = sqliteTable(
  "carrier_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    nickname: text("nickname").notNull(),
    accountNumber: text("account_number"),
    mode: text("mode").notNull().default("demo"),
    status: text("status").notNull().default("connected"),
    apiKey: text("api_key"),
    apiSecret: text("api_secret"),
    meterNumber: text("meter_number"),
    enabledServicesJson: text("enabled_services_json").notNull().default("[]"),
    webhookSecret: text("webhook_secret"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    lastTestedAt: integer("last_tested_at"),
    lastTestStatus: text("last_test_status"),
    lastTestError: text("last_test_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("carrier_connections_org_provider").on(t.organizationId, t.provider)],
);

export const carrierOutboundEvents = sqliteTable("carrier_outbound_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").references(() => carrierConnections.id, { onDelete: "set null" }),
  orderId: text("order_id").references(() => orders.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  requestJson: text("request_json").notNull(),
  responseJson: text("response_json"),
  createdAt: integer("created_at").notNull(),
});

export const trackerWebhookReceipts = sqliteTable(
  "tracker_webhook_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    trackingNumber: text("tracking_number"),
    eventId: text("event_id"),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("tracker_webhook_receipts_event").on(t.organizationId, t.eventId)],
);

export const boms = sqliteTable(
  "boms",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("boms_org_item").on(t.organizationId, t.itemId)],
);

export const bomLines = sqliteTable(
  "bom_lines",
  {
    id: text("id").primaryKey(),
    bomId: text("bom_id")
      .notNull()
      .references(() => boms.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qty: integer("qty").notNull(),
  },
  (t) => [uniqueIndex("bom_lines_bom_item").on(t.bomId, t.itemId)],
);

export const workOrders = sqliteTable("work_orders", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  qty: integer("qty").notNull(),
  qtyCompleted: integer("qty_completed").notNull().default(0),
  status: text("status").notNull(),
  sourceLocationId: text("source_location_id")
    .notNull()
    .references(() => locations.id),
  outputLocationId: text("output_location_id")
    .notNull()
    .references(() => locations.id),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});

export const transfers = sqliteTable("transfers", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  status: text("status").notNull(),
  fromLocationId: text("from_location_id")
    .notNull()
    .references(() => locations.id),
  toLocationId: text("to_location_id")
    .notNull()
    .references(() => locations.id),
  toWarehouseId: text("to_warehouse_id").references(() => warehouses.id),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  postedAt: integer("posted_at"),
});

export const transferLines = sqliteTable("transfer_lines", {
  id: text("id").primaryKey(),
  transferId: text("transfer_id")
    .notNull()
    .references(() => transfers.id, { onDelete: "cascade" }),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  qty: integer("qty").notNull(),
  qtyMoved: integer("qty_moved").notNull().default(0),
});

export const cycleCounts = sqliteTable("cycle_counts", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  status: text("status").notNull(),
  locationId: text("location_id")
    .notNull()
    .references(() => locations.id),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  postedAt: integer("posted_at"),
});

export const cycleCountLines = sqliteTable("cycle_count_lines", {
  id: text("id").primaryKey(),
  cycleCountId: text("cycle_count_id")
    .notNull()
    .references(() => cycleCounts.id, { onDelete: "cascade" }),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  systemQty: integer("system_qty").notNull(),
  countedQty: integer("counted_qty").notNull(),
  entered: integer("entered").notNull().default(0),
  weightGrams: integer("weight_grams"),
});

export const purchases = sqliteTable("purchases", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  vendorName: text("vendor_name").notNull(),
  status: text("status").notNull(),
  locationId: text("location_id").references(() => locations.id),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  orderedAt: integer("ordered_at"),
  receivedAt: integer("received_at"),
  clientId: text("client_id"),
});

export const purchaseLines = sqliteTable(
  "purchase_lines",
  {
    id: text("id").primaryKey(),
    purchaseId: text("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qtyOrdered: integer("qty_ordered").notNull(),
    qtyReceived: integer("qty_received").notNull().default(0),
  },
  (t) => [uniqueIndex("purchase_lines_purchase_item").on(t.purchaseId, t.itemId)],
);

export const purchaseSends = sqliteTable("purchase_sends", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  purchaseId: text("purchase_id")
    .notNull()
    .references(() => purchases.id, { onDelete: "cascade" }),
  toAddress: text("to_address"),
  subject: text("subject"),
  body: text("body").notNull(),
  mode: text("mode").notNull().default("demo"),
  createdAt: integer("created_at").notNull(),
});

export const rmas = sqliteTable("rmas", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  customerName: text("customer_name").notNull(),
  status: text("status").notNull(),
  orderId: text("order_id").references(() => orders.id),
  locationId: text("location_id").references(() => locations.id),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  receivedAt: integer("received_at"),
});

export const rmaLines = sqliteTable(
  "rma_lines",
  {
    id: text("id").primaryKey(),
    rmaId: text("rma_id")
      .notNull()
      .references(() => rmas.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qtyExpected: integer("qty_expected").notNull(),
    qtyReceived: integer("qty_received").notNull().default(0),
    disposition: text("disposition").notNull().default("restock"),
  },
  (t) => [uniqueIndex("rma_lines_rma_item").on(t.rmaId, t.itemId)],
);

export const vendorReturns = sqliteTable("vendor_returns", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  vendorName: text("vendor_name").notNull(),
  status: text("status").notNull(),
  purchaseId: text("purchase_id").references(() => purchases.id),
  locationId: text("location_id").references(() => locations.id),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  returnedAt: integer("returned_at"),
});

export const vendorReturnLines = sqliteTable(
  "vendor_return_lines",
  {
    id: text("id").primaryKey(),
    vendorReturnId: text("vendor_return_id")
      .notNull()
      .references(() => vendorReturns.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qtyExpected: integer("qty_expected").notNull(),
    qtyReturned: integer("qty_returned").notNull().default(0),
  },
  (t) => [uniqueIndex("vendor_return_lines_rtv_item").on(t.vendorReturnId, t.itemId)],
);

export const lotBalances = sqliteTable(
  "lot_balances",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    lotCode: text("lot_code").notNull(),
    qty: integer("qty").notNull(),
    expiresOn: integer("expires_on"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("lot_balances_org_loc_item_lot").on(t.organizationId, t.locationId, t.itemId, t.lotCode)],
);

export const serials = sqliteTable(
  "serials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    serialCode: text("serial_code").notNull(),
    locationId: text("location_id").references(() => locations.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("serials_org_item_code").on(t.organizationId, t.itemId, t.serialCode)],
);

export const replenishments = sqliteTable("replenishments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  status: text("status").notNull(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  qty: integer("qty").notNull(),
  qtyMoved: integer("qty_moved").notNull().default(0),
  fromLocationId: text("from_location_id")
    .notNull()
    .references(() => locations.id),
  toLocationId: text("to_location_id")
    .notNull()
    .references(() => locations.id),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  postedAt: integer("posted_at"),
});

export const kitBuilds = sqliteTable("kit_builds", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  status: text("status").notNull(),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  qty: integer("qty").notNull(),
  qtyCompleted: integer("qty_completed").notNull().default(0),
  sourceLocationId: text("source_location_id")
    .notNull()
    .references(() => locations.id),
  outputLocationId: text("output_location_id")
    .notNull()
    .references(() => locations.id),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});

export const asBuilt = sqliteTable(
  "as_built",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    parentItemId: text("parent_item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    parentLotCode: text("parent_lot_code"),
    parentSerial: text("parent_serial"),
    componentItemId: text("component_item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    componentLotCode: text("component_lot_code"),
    componentSerial: text("component_serial"),
    qty: integer("qty").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("as_built_org_ref").on(t.organizationId, t.refId),
    index("as_built_org_parent_serial").on(t.organizationId, t.parentSerial),
    index("as_built_org_component_lot").on(t.organizationId, t.componentItemId, t.componentLotCode),
  ],
);

export const inventoryHolds = sqliteTable("inventory_holds", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  number: text("number").notNull(),
  status: text("status").notNull(),
  locationId: text("location_id")
    .notNull()
    .references(() => locations.id),
  itemId: text("item_id").references(() => items.id),
  lotCode: text("lot_code"),
  reason: text("reason").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  releasedAt: integer("released_at"),
});

export const inventoryAllocations = sqliteTable("inventory_allocations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehouses.id),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  orderLineId: text("order_line_id")
    .notNull()
    .references(() => orderLines.id, { onDelete: "cascade" }),
  locationId: text("location_id")
    .notNull()
    .references(() => locations.id),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  qty: integer("qty").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  releasedAt: integer("released_at"),
});

export type ItemType = "raw" | "wip" | "finished" | "packaging";
export type LocationType = "receiving" | "storage" | "production" | "shipping";
export type SlotRole = "pick" | "bulk" | "none";
export type Role = "owner" | "operator";
export type ReceiptStatus = "draft" | "receiving" | "received";
export type OrderStatus = "open" | "picking" | "picked" | "packing" | "packed" | "shipped" | "cancelled";
export type OrderSource = "manual" | "shopify";
export type ShopifyMode = "live" | "demo";
export type ShopifySyncStatus = "none" | "inbound" | "pending_fulfill" | "synced" | "failed";
export type WorkOrderStatus = "draft" | "in_progress" | "completed";
export type TransferStatus = "draft" | "in_progress" | "posted";
export type CycleCountStatus = "draft" | "counting" | "posted";
export type PurchaseStatus = "draft" | "ordered" | "receiving" | "received";
export type RmaStatus = "open" | "receiving" | "received";
export type VendorReturnStatus = "open" | "returning" | "returned";
export type ReplenishmentStatus = "draft" | "in_progress" | "posted";
export type KitBuildStatus = "draft" | "in_progress" | "completed" | "dekitted";
export type HoldStatus = "open" | "released";
export type AllocationStatus = "open" | "released";
export type SerialStatus = "on_hand" | "shipped" | "consumed";
export type MovementType =
  | "receive"
  | "move"
  | "pick"
  | "ship"
  | "adjust"
  | "wo_consume"
  | "wo_produce"
  | "kit_consume"
  | "kit_produce"
  | "scrap"
  | "rtv"
  | "unpick";
export type ReturnDisposition = "restock" | "scrap" | "hold";

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("clients_org_code").on(t.organizationId, t.code)],
);

export const clientBalances = sqliteTable(
  "client_balances",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("client_balances_org_loc_item_client").on(
      t.organizationId,
      t.locationId,
      t.itemId,
      t.clientId,
    ),
  ],
);

export const zones = sqliteTable(
  "zones",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("zones_org_wh_code").on(t.organizationId, t.warehouseId, t.code)],
);

export const waves = sqliteTable(
  "waves",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    number: text("number").notNull(),
    status: text("status").notNull(),
    mode: text("mode").notNull().default("wave"),
    zoneId: text("zone_id").references(() => zones.id, { onDelete: "set null" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    releasedAt: integer("released_at"),
    completedAt: integer("completed_at"),
  },
  (t) => [uniqueIndex("waves_org_number").on(t.organizationId, t.number)],
);

export const waveOrders = sqliteTable(
  "wave_orders",
  {
    id: text("id").primaryKey(),
    waveId: text("wave_id")
      .notNull()
      .references(() => waves.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("wave_orders_wave_order").on(t.waveId, t.orderId)],
);

export const waveBatchLines = sqliteTable(
  "wave_batch_lines",
  {
    id: text("id").primaryKey(),
    waveId: text("wave_id")
      .notNull()
      .references(() => waves.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qty: integer("qty").notNull(),
    qtyPicked: integer("qty_picked").notNull().default(0),
  },
  (t) => [uniqueIndex("wave_batch_lines_wave_item").on(t.waveId, t.itemId)],
);

export const asns = sqliteTable(
  "asns",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    number: text("number").notNull(),
    vendorName: text("vendor_name").notNull(),
    status: text("status").notNull(),
    purchaseId: text("purchase_id").references(() => purchases.id, { onDelete: "set null" }),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    locationId: text("location_id").references(() => locations.id),
    eta: integer("eta"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    expectedAt: integer("expected_at"),
    receivedAt: integer("received_at"),
  },
  (t) => [uniqueIndex("asns_org_number").on(t.organizationId, t.number)],
);

export const asnLines = sqliteTable(
  "asn_lines",
  {
    id: text("id").primaryKey(),
    asnId: text("asn_id")
      .notNull()
      .references(() => asns.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qtyExpected: integer("qty_expected").notNull(),
    qtyReceived: integer("qty_received").notNull().default(0),
  },
  (t) => [uniqueIndex("asn_lines_asn_item").on(t.asnId, t.itemId)],
);

export const asnPackages = sqliteTable(
  "asn_packages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    asnId: text("asn_id")
      .notNull()
      .references(() => asns.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    seq: integer("seq").notNull(),
    sscc: text("sscc"),
    receivedAt: integer("received_at"),
    putawayAt: integer("putaway_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("asn_packages_asn_number").on(t.asnId, t.number),
    uniqueIndex("asn_packages_org_sscc").on(t.organizationId, t.sscc),
  ],
);

export const asnPackageLines = sqliteTable(
  "asn_package_lines",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id")
      .notNull()
      .references(() => asnPackages.id, { onDelete: "cascade" }),
    asnLineId: text("asn_line_id")
      .notNull()
      .references(() => asnLines.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qty: integer("qty").notNull(),
    lotCode: text("lot_code"),
    serialsJson: text("serials_json"),
    weightGrams: integer("weight_grams"),
    expiresOn: integer("expires_on"),
  },
  (t) => [uniqueIndex("asn_package_lines_pkg_line").on(t.packageId, t.asnLineId)],
);

export const yardVisits = sqliteTable(
  "yard_visits",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    number: text("number").notNull(),
    status: text("status").notNull(),
    carrierName: text("carrier_name").notNull(),
    trailerNumber: text("trailer_number"),
    dockLocationId: text("dock_location_id").references(() => locations.id, { onDelete: "set null" }),
    asnId: text("asn_id").references(() => asns.id, { onDelete: "set null" }),
    purchaseId: text("purchase_id").references(() => purchases.id, { onDelete: "set null" }),
    eta: integer("eta"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    checkedInAt: integer("checked_in_at"),
    checkedOutAt: integer("checked_out_at"),
  },
  (t) => [uniqueIndex("yard_visits_org_number").on(t.organizationId, t.number)],
);

export const laborClocks = sqliteTable(
  "labor_clocks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verb: text("verb").notNull(),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    durationSec: integer("duration_sec"),
  },
  (t) => [index("labor_clocks_org_user_open").on(t.organizationId, t.userId, t.endedAt)],
);

export const carrierAccounts = sqliteTable(
  "carrier_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    carrier: text("carrier").notNull(),
    accountNumber: text("account_number").notNull(),
    mode: text("mode").notNull().default("demo"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("carrier_accounts_org_carrier").on(t.organizationId, t.carrier)],
);

export const ediInbox = sqliteTable(
  "edi_inbox",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull(),
    createdAsnId: text("created_asn_id").references(() => asns.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    error: text("error"),
  },
  (t) => [index("edi_inbox_org_created").on(t.organizationId, t.createdAt)],
);

export const billingAccounts = sqliteTable("billing_accounts", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at").notNull(),
});

export const printers = sqliteTable(
  "printers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    connection: text("connection").notNull().default("browser"),
    media: text("media").notNull().default("letter"),
    dpi: integer("dpi").notNull().default(203),
    qzPrinterName: text("qz_printer_name"),
    isDefault: integer("is_default").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("printers_org").on(t.organizationId)],
);

export const printStations = sqliteTable(
  "print_stations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    warehouseId: text("warehouse_id").references(() => warehouses.id, { onDelete: "set null" }),
    defaultPrinterId: text("default_printer_id").references(() => printers.id, { onDelete: "set null" }),
    bayPrinterId: text("bay_printer_id").references(() => printers.id, { onDelete: "set null" }),
    shippingPrinterId: text("shipping_printer_id").references(() => printers.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("print_stations_org").on(t.organizationId)],
);

export const printJobs = sqliteTable(
  "print_jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    printerId: text("printer_id").references(() => printers.id, { onDelete: "set null" }),
    stationId: text("station_id").references(() => printStations.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    payloadFormat: text("payload_format").notNull(),
    status: text("status").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (t) => [index("print_jobs_org_created").on(t.organizationId, t.createdAt)],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    periodStart: integer("period_start").notNull(),
    periodEnd: integer("period_end").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("invoices_org_number").on(t.organizationId, t.number)],
);

export const laborEvents = sqliteTable(
  "labor_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verb: text("verb").notNull(),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    qty: integer("qty"),
    durationSec: integer("duration_sec"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("labor_events_org_created").on(t.organizationId, t.createdAt),
    index("labor_events_org_user").on(t.organizationId, t.userId),
  ],
);

export const packEvents = sqliteTable(
  "pack_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qty: integer("qty").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("pack_events_org_created").on(t.organizationId, t.createdAt),
    index("pack_events_org_user").on(t.organizationId, t.userId),
    index("pack_events_org_item").on(t.organizationId, t.itemId, t.createdAt),
  ],
);

export type WaveStatus = "draft" | "released" | "picking" | "completed" | "cancelled";
export type WaveMode = "wave" | "batch";
export type AsnStatus = "draft" | "expected" | "receiving" | "received" | "cancelled";
export type YardStatus = "expected" | "checked_in" | "at_dock" | "checked_out" | "cancelled";
export type LaborVerb =
  | "receive"
  | "pick"
  | "pack"
  | "ship"
  | "count"
  | "move"
  | "putaway"
  | "replenish"
  | "hold"
  | "kit"
  | "assemble"
  | "yard"
  | "batch_pick";
export type CarrierProvider =
  | "rackline"
  | "ups"
  | "fedex"
  | "usps"
  | "dhl"
  | "easypost"
  | "shipengine";
export type CarrierMode = "live" | "demo";
export type CarrierConnectionStatus = "connected" | "error";
export type CarrierLabelStatus = "none" | "purchased" | "voided";
export type CarrierOutboundKind = "test" | "rates" | "buy" | "void";


export const equipment = sqliteTable(
  "equipment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    class: text("class").notNull(),
    barcode: text("barcode").notNull(),
    status: text("status").notNull(),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("equipment_org_wh_code").on(t.organizationId, t.warehouseId, t.code),
    uniqueIndex("equipment_org_barcode").on(t.organizationId, t.barcode),
  ],
);

export const operatorCertifications = sqliteTable(
  "operator_certifications",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    class: text("class").notNull(),
    expiresOn: integer("expires_on").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("operator_certs_org_user_class").on(t.organizationId, t.userId, t.class)],
);

export const equipmentAssignments = sqliteTable(
  "equipment_assignments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    number: text("number").notNull(),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
    operatorUserId: text("operator_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    shift: text("shift"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    startedBy: text("started_by").notNull(),
    endedBy: text("ended_by"),
  },
  (t) => [
    uniqueIndex("equipment_assignments_org_number").on(t.organizationId, t.number),
    index("equipment_assignments_org_equipment").on(t.organizationId, t.equipmentId, t.startedAt),
    index("equipment_assignments_org_operator").on(t.organizationId, t.operatorUserId, t.startedAt),
  ],
);

export const equipmentInspections = sqliteTable(
  "equipment_inspections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id").references(() => equipmentAssignments.id, { onDelete: "set null" }),
    result: text("result").notNull(),
    itemsJson: text("items_json").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("equipment_inspections_org_equipment").on(t.organizationId, t.equipmentId, t.createdAt)],
);

export const equipmentEvents = sqliteTable(
  "equipment_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
    assignmentId: text("assignment_id"),
    type: text("type").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    payloadJson: text("payload_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("equipment_events_org_equipment").on(t.organizationId, t.equipmentId, t.createdAt)],
);

export type EquipmentClass = "sit_down" | "reach" | "pallet_jack" | "order_picker" | "other";
export type EquipmentStatus = "available" | "checked_out" | "out_of_service";
export type EquipmentAssignmentStatus = "open" | "closed";
export type EquipmentInspectionResult = "pass" | "fail";
export type EquipmentEventType =
  | "checked_out"
  | "checked_in"
  | "inspected"
  | "task_attached"
  | "transferred"
  | "out_of_service"
  | "returned_to_service";

export type FloorVerb =
  | "receive"
  | "putaway"
  | "replenish"
  | "pick"
  | "pack"
  | "ship"
  | "return"
  | "rtv"
  | "count"
  | "assemble"
  | "kit"
  | "hold";
export type JobRefType =
  | "order"
  | "receipt"
  | "purchase"
  | "transfer"
  | "replenishment"
  | "rma"
  | "vendorReturn"
  | "cycleCount"
  | "workOrder"
  | "kit"
  | "hold"
  | "putawaySuggestion"
  | "replenishSuggestion";
export type JobStatus = "open" | "claimed" | "done" | "cancelled";

export const floorJobs = sqliteTable(
  "floor_jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    verb: text("verb").notNull(),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    status: text("status").notNull(),
    number: text("number"),
    title: text("title"),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    claimedAt: integer("claimed_at"),
    releasedAt: integer("released_at"),
    doneAt: integer("done_at"),
    notBefore: integer("not_before"),
    dueAt: integer("due_at"),
    pinned: integer("pinned").notNull().default(0),
    fromLocationId: text("from_location_id").references(() => locations.id, { onDelete: "set null" }),
    toLocationId: text("to_location_id").references(() => locations.id, { onDelete: "set null" }),
    itemId: text("item_id").references(() => items.id, { onDelete: "set null" }),
    qty: integer("qty"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("floor_jobs_org_wh_status").on(t.organizationId, t.warehouseId, t.status),
    index("floor_jobs_org_ref").on(t.organizationId, t.refType, t.refId),
  ],
);
