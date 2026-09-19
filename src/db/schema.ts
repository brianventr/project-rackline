import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const inventoryMovements = sqliteTable("inventory_movements", {
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
});

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
});

export const receiptLines = sqliteTable("receipt_lines", {
  id: text("id").primaryKey(),
  receiptId: text("receipt_id")
    .notNull()
    .references(() => receipts.id, { onDelete: "cascade" }),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  qty: integer("qty").notNull(),
});

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
  },
  (t) => [uniqueIndex("shopify_orders_org_order").on(t.organizationId, t.shopifyOrderId)],
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
  shopifyLineItemId: text("shopify_line_item_id"),
  shopifyFulfillmentLineItemId: text("shopify_fulfillment_line_item_id"),
});

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
  },
  (t) => [uniqueIndex("rma_lines_rma_item").on(t.rmaId, t.itemId)],
);

export type ItemType = "raw" | "wip" | "finished" | "packaging";
export type LocationType = "receiving" | "storage" | "production" | "shipping";
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
export type MovementType =
  | "receive"
  | "move"
  | "pick"
  | "ship"
  | "adjust"
  | "wo_consume"
  | "wo_produce";
