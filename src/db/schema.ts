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
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("items_org_sku").on(t.organizationId, t.sku)],
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

export const orders = sqliteTable("orders", {
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
  shippedAt: integer("shipped_at"),
});

export const orderLines = sqliteTable("order_lines", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  itemId: text("item_id")
    .notNull()
    .references(() => items.id),
  qty: integer("qty").notNull(),
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

export type ItemType = "raw" | "wip" | "finished" | "packaging";
export type LocationType = "receiving" | "storage" | "production" | "shipping";
export type Role = "owner" | "operator";
export type ReceiptStatus = "draft" | "received";
export type OrderStatus = "draft" | "picked" | "shipped";
export type WorkOrderStatus = "draft" | "completed";
export type MovementType =
  | "receive"
  | "move"
  | "pick"
  | "ship"
  | "adjust"
  | "wo_consume"
  | "wo_produce";
