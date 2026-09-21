import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { chainPlans, planMove, planPick, planReceive, planShip, planUnpick } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "./stock";
import { seedAssignedJobs } from "./jobs";
import { provisionOrganization } from "../lib/org";
import { demoFulfillmentOrderId } from "../domain/shopify";
import { areaForType, gridPosition } from "../domain/map-layout";
import { addUtcDays, utcYyyymmdd } from "../domain/expiry";
import { checklistForClass, equipmentBarcode } from "../domain/equipment";
import { destPatchFromAddress, originColumns, resolveOrigin } from "../domain/geo";
import { demoInventoryItemGid, demoShopifyLocationGid } from "../domain/shopify-sellable";
import { syncShopifySellable } from "./shopify-sellable";

export const DEMO_EMAIL = "demo@northwind.makers";
export const DEMO_PASSWORD = "rackline-demo";

function lampSerials(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `LAMP-${start + index}`);
}

type LocSeed = {
  key: string;
  code: string;
  name: string;
  type: "receiving" | "storage" | "production" | "shipping";
  slotRole?: "pick" | "bulk" | "none";
  aisle?: string;
  rack?: string;
  bay?: string;
  level?: number;
  posX?: number;
  posY?: number;
  posZ?: number;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
};

const DEMO_LOCATIONS: LocSeed[] = [
  {
    key: "recv",
    code: "RECV",
    name: "Receiving dock",
    type: "receiving",
    posX: 2,
    posY: 1,
    posZ: 0,
    sizeX: 16,
    sizeY: 4,
    sizeZ: 3,
  },
  { key: "a0101", code: "A-01-01", name: "Aisle A / rack 01 / bay 01", type: "storage", aisle: "A", rack: "01", bay: "01", level: 1, slotRole: "bulk" },
  { key: "a0102", code: "A-01-02", name: "Aisle A / rack 01 / bay 02", type: "storage", aisle: "A", rack: "01", bay: "02", level: 1, slotRole: "pick" },
  { key: "a0103", code: "A-01-03", name: "Aisle A / rack 01 / bay 03", type: "storage", aisle: "A", rack: "01", bay: "03", level: 1 },
  { key: "a0101l2", code: "A-01-01-2", name: "Aisle A / rack 01 / bay 01 / level 2", type: "storage", aisle: "A", rack: "01", bay: "01", level: 2 },
  { key: "a0102l2", code: "A-01-02-2", name: "Aisle A / rack 01 / bay 02 / level 2", type: "storage", aisle: "A", rack: "01", bay: "02", level: 2 },
  { key: "a0103l2", code: "A-01-03-2", name: "Aisle A / rack 01 / bay 03 / level 2", type: "storage", aisle: "A", rack: "01", bay: "03", level: 2 },
  { key: "a0201", code: "A-02-01", name: "Aisle A / rack 02 / bay 01", type: "storage", aisle: "A", rack: "02", bay: "01", level: 1 },
  { key: "a0202", code: "A-02-02", name: "Aisle A / rack 02 / bay 02", type: "storage", aisle: "A", rack: "02", bay: "02", level: 1 },
  { key: "a0203", code: "A-02-03", name: "Aisle A / rack 02 / bay 03", type: "storage", aisle: "A", rack: "02", bay: "03", level: 1 },
  { key: "b0101", code: "B-01-01", name: "Aisle B / rack 01 / bay 01", type: "storage", aisle: "B", rack: "01", bay: "01", level: 1, slotRole: "pick" },
  { key: "b0102", code: "B-01-02", name: "Aisle B / rack 01 / bay 02", type: "storage", aisle: "B", rack: "01", bay: "02", level: 1 },
  { key: "b0101l2", code: "B-01-01-2", name: "Aisle B / rack 01 / bay 01 / level 2", type: "storage", aisle: "B", rack: "01", bay: "01", level: 2, slotRole: "bulk" },
  {
    key: "prod",
    code: "PROD",
    name: "Assembly bench",
    type: "production",
    posX: 32,
    posY: 7,
    posZ: 0,
    sizeX: 8,
    sizeY: 10,
    sizeZ: 3,
  },
  {
    key: "ship",
    code: "SHIP",
    name: "Outbound staging",
    type: "shipping",
    posX: 22,
    posY: 22,
    posZ: 0,
    sizeX: 18,
    sizeY: 4,
    sizeZ: 3,
  },
];

export async function seedNorthwind(db: AppDb, userId: string): Promise<{ organizationId: string }> {
  const { organizationId, warehouseId } = await provisionOrganization(db, userId, "Northwind Makers");
  const now = Date.now();
  const mainOrigin = originColumns(resolveOrigin({ city: "Portland", region: "OR", country: "US" }));
  await db
    .update(schema.warehouses)
    .set({ shipFromAddress: "14 Dock St, Portland, OR 97209", ...mainOrigin })
    .where(eq(schema.warehouses.id, warehouseId));

  const locIds = Object.fromEntries(DEMO_LOCATIONS.map((row) => [row.key, newId()])) as Record<string, string>;

  const locationInserts = DEMO_LOCATIONS.map((row) => {
    const grid =
      row.aisle && row.rack && row.bay ? gridPosition(row.aisle, row.rack, row.bay, row.level ?? 1) : null;
    return db.insert(schema.locations).values({
      id: locIds[row.key]!,
      organizationId,
      warehouseId,
      code: row.code,
      name: row.name,
      type: row.type,
      barcode: row.code,
      area: areaForType(row.type, row.aisle),
      aisle: row.aisle ?? null,
      rack: row.rack ?? null,
      bay: row.bay ?? null,
      level: row.level ?? 1,
      posX: row.posX ?? grid?.posX ?? 0,
      posY: row.posY ?? grid?.posY ?? 0,
      posZ: row.posZ ?? grid?.posZ ?? 0,
      sizeX: row.sizeX ?? grid?.sizeX ?? 4,
      sizeY: row.sizeY ?? grid?.sizeY ?? 3,
      sizeZ: row.sizeZ ?? grid?.sizeZ ?? 2,
      slotRole: row.slotRole ?? "none",
    });
  });
  await db.batch(locationInserts as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

  const item = {
    bulb: newId(),
    shade: newId(),
    base: newId(),
    cord: newId(),
    lamp: newId(),
    resin: newId(),
    glue: newId(),
  };
  await db.batch([
    db.insert(schema.items).values({
      id: item.bulb,
      organizationId,
      sku: "LED-BULB",
      name: "LED bulb",
      type: "raw",
      barcode: "LED-BULB",
      createdAt: now,
      reorderPoint: 24,
      pickMin: 20,
      trackLot: true,
      shopifyInventoryItemGid: demoInventoryItemGid("LED-BULB"),
    }),
    db.insert(schema.items).values({
      id: item.shade,
      organizationId,
      sku: "SHADE",
      name: "Lamp shade",
      type: "raw",
      barcode: "SHADE",
      createdAt: now,
      reorderPoint: 10,
      shopifyInventoryItemGid: demoInventoryItemGid("SHADE"),
    }),
    db.insert(schema.items).values({
      id: item.base,
      organizationId,
      sku: "BASE",
      name: "Cast iron base",
      type: "raw",
      barcode: "BASE",
      createdAt: now,
      reorderPoint: 8,
      shopifyInventoryItemGid: demoInventoryItemGid("BASE"),
    }),
    db.insert(schema.items).values({
      id: item.cord,
      organizationId,
      sku: "CORD",
      name: "Power cord",
      type: "raw",
      barcode: "CORD",
      createdAt: now,
      reorderPoint: 40,
      shopifyInventoryItemGid: demoInventoryItemGid("CORD"),
    }),
    db.insert(schema.items).values({
      id: item.lamp,
      organizationId,
      sku: "LAMP",
      name: "Desk lamp",
      type: "finished",
      barcode: "LAMP",
      createdAt: now,
      reorderPoint: 4,
      pickMin: 12,
      trackSerial: true,
      shopifyInventoryItemGid: demoInventoryItemGid("LAMP"),
    }),
    db.insert(schema.items).values({
      id: item.resin,
      organizationId,
      sku: "RESIN",
      name: "Casting resin",
      type: "raw",
      barcode: "RESIN",
      createdAt: now,
      reorderPoint: 4,
      catchWeight: true,
      altUom: "case",
      altPerStock: 6,
      shopifyInventoryItemGid: demoInventoryItemGid("RESIN"),
    }),
    db.insert(schema.items).values({
      id: item.glue,
      organizationId,
      sku: "GLUE",
      name: "Cyanoacrylate",
      type: "raw",
      barcode: "GLUE",
      createdAt: now,
      reorderPoint: 4,
      pickMin: 4,
      trackLot: true,
      trackExpiry: true,
      shopifyInventoryItemGid: demoInventoryItemGid("GLUE"),
    }),
  ]);

  const starting = [
    { itemId: item.bulb, locationId: locIds.a0101!, qty: 25, lotCode: "LOT-2026-A" },
    { itemId: item.bulb, locationId: locIds.a0101!, qty: 15, lotCode: "LOT-2026-B" },
    { itemId: item.shade, locationId: locIds.a0101!, qty: 20 },
    { itemId: item.base, locationId: locIds.a0101!, qty: 15 },
    { itemId: item.cord, locationId: locIds.a0101!, qty: 25 },
    { itemId: item.lamp, locationId: locIds.b0101!, qty: 8, serials: lampSerials(1001, 8) },
    { itemId: item.lamp, locationId: locIds.b0101l2!, qty: 6, serials: lampSerials(1009, 6) },
    { itemId: item.bulb, locationId: locIds.a0102!, qty: 6, lotCode: "LOT-2026-A" },
    { itemId: item.shade, locationId: locIds.a0201!, qty: 4 },
    { itemId: item.resin, locationId: locIds.a0101!, qty: 6, weightGrams: 3000 },
    { itemId: item.glue, locationId: locIds.a0101!, qty: 4, lotCode: "LOT-OLD", expiresOn: addUtcDays(utcYyyymmdd(), 3) },
    { itemId: item.glue, locationId: locIds.a0101!, qty: 8, lotCode: "LOT-NEW", expiresOn: addUtcDays(utcYyyymmdd(), 180) },
    { itemId: item.glue, locationId: locIds.a0103!, qty: 2, lotCode: "LOT-DEAD", expiresOn: addUtcDays(utcYyyymmdd(), -10) },
  ];
  const seedRef = "seed";
  const plan = chainPlans(
    new Map(),
    starting.map((line) => (balances) =>
      planReceive({
        itemId: line.itemId,
        locationId: line.locationId,
        qty: line.qty,
        refId: seedRef,
        balances,
        lotCode: line.lotCode,
        serials: line.serials,
        weightGrams: line.weightGrams,
        expiresOn: line.expiresOn,
      }),
    ),
  );
  for (const movement of plan.movements) {
    movement.refType = "seed";
  }
  await persistStockPlan(db, {
    organizationId,
    createdBy: userId,
    now,
    loaded: new Map(),
    plan,
    skipShopifySync: true,
  });

  const bomId = newId();
  await db.batch([
    db.insert(schema.boms).values({
      id: bomId,
      organizationId,
      itemId: item.lamp,
      createdAt: now,
    }),
    db.insert(schema.bomLines).values({ id: newId(), bomId, itemId: item.bulb, qty: 1 }),
    db.insert(schema.bomLines).values({ id: newId(), bomId, itemId: item.shade, qty: 1 }),
    db.insert(schema.bomLines).values({ id: newId(), bomId, itemId: item.base, qty: 1 }),
    db.insert(schema.bomLines).values({ id: newId(), bomId, itemId: item.cord, qty: 1 }),
  ]);

  const receiptId = newId();
  const purchaseId = newId();
  const cordPoId = newId();
  const rmaId = newId();
  const rtvId = newId();
  const orderId = newId();
  const woId = newId();
  const kitId = newId();
  const transferId = newId();
  const rplId = newId();
  const shopifyOrderRowId = newId();
  const shopifyLineId = "8801";
  await db.batch([
    db.insert(schema.receipts).values({
      id: receiptId,
      organizationId,
      warehouseId,
      number: "RCP-DEMO1",
      status: "draft",
      notes: "Vendor shipment — bulbs and shades",
      createdAt: now,
    }),
    db.insert(schema.receiptLines).values({ id: newId(), receiptId, itemId: item.bulb, qty: 12, qtyReceived: 0 }),
    db.insert(schema.receiptLines).values({ id: newId(), receiptId, itemId: item.shade, qty: 6, qtyReceived: 0 }),
    db.insert(schema.purchases).values({
      id: purchaseId,
      organizationId,
      warehouseId,
      number: "PO-DEMO1",
      vendorName: "Harbor Components",
      status: "ordered",
      notes: "Restock bulbs and shades",
      createdAt: now,
      orderedAt: now,
    }),
    db.insert(schema.purchaseLines).values({
      id: newId(),
      purchaseId,
      itemId: item.bulb,
      qtyOrdered: 20,
      qtyReceived: 0,
    }),
    db.insert(schema.purchaseLines).values({
      id: newId(),
      purchaseId,
      itemId: item.shade,
      qtyOrdered: 8,
      qtyReceived: 0,
    }),
    db.insert(schema.purchaseSends).values({
      id: newId(),
      organizationId,
      purchaseId,
      toAddress: "Harbor Components",
      subject: "PO-DEMO1",
      body: "Please fulfill PO-DEMO1: LED-BULB × 20, SHADE × 8.",
      mode: "demo",
      createdAt: now,
    }),
    db.insert(schema.purchases).values({
      id: cordPoId,
      organizationId,
      warehouseId,
      number: "PO-CORD",
      vendorName: "Harbor Components",
      status: "draft",
      notes: "Draft CORD restock — send to mint an expected ASN",
      createdAt: now,
    }),
    db.insert(schema.purchaseLines).values({
      id: newId(),
      purchaseId: cordPoId,
      itemId: item.cord,
      qtyOrdered: 15,
      qtyReceived: 0,
    }),
    db.insert(schema.orders).values({
      id: orderId,
      organizationId,
      warehouseId,
      number: "ORD-DEMO1",
      customerName: "Harbor Workshop",
      status: "open",
      createdAt: now,
      source: "manual",
      ...destPatchFromAddress("14 Dock Street\nPortland, OR 97201"),
    }),
    db.insert(schema.orderLines).values({ id: newId(), orderId, itemId: item.lamp, qty: 2 }),
    db.insert(schema.rmas).values({
      id: rmaId,
      organizationId,
      warehouseId,
      number: "RMA-DEMO1",
      customerName: "Harbor Workshop",
      status: "open",
      orderId,
      notes: "Wrong shade color — restock to dock",
      createdAt: now,
    }),
    db.insert(schema.rmaLines).values({
      id: newId(),
      rmaId,
      itemId: item.lamp,
      qtyExpected: 1,
      qtyReceived: 0,
      disposition: "restock",
    }),
    db.insert(schema.vendorReturns).values({
      id: rtvId,
      organizationId,
      warehouseId,
      number: "RTV-DEMO1",
      vendorName: "Harbor Components",
      status: "open",
      purchaseId,
      notes: "Wrong lot on bulbs — ship back from A-01-01",
      createdAt: now,
    }),
    db.insert(schema.vendorReturnLines).values({
      id: newId(),
      vendorReturnId: rtvId,
      itemId: item.bulb,
      qtyExpected: 2,
      qtyReturned: 0,
    }),
    db.insert(schema.workOrders).values({
      id: woId,
      organizationId,
      warehouseId,
      number: "WO-DEMO1",
      itemId: item.lamp,
      qty: 4,
      qtyCompleted: 0,
      status: "draft",
      sourceLocationId: locIds.a0101!,
      outputLocationId: locIds.prod!,
      createdAt: now,
    }),
    db.insert(schema.kitBuilds).values({
      id: kitId,
      organizationId,
      warehouseId,
      number: "KIT-DEMO1",
      itemId: item.lamp,
      qty: 2,
      qtyCompleted: 0,
      status: "draft",
      sourceLocationId: locIds.a0101!,
      outputLocationId: locIds.b0101!,
      createdAt: now,
    }),
    db.insert(schema.transfers).values({
      id: transferId,
      organizationId,
      warehouseId,
      number: "XFR-DEMO1",
      status: "draft",
      fromLocationId: locIds.a0101!,
      toLocationId: locIds.a0202!,
      notes: "Consolidate shades and bases onto A-02-02",
      createdAt: now,
    }),
    db.insert(schema.transferLines).values({
      id: newId(),
      transferId,
      itemId: item.shade,
      qty: 8,
      qtyMoved: 0,
    }),
    db.insert(schema.transferLines).values({
      id: newId(),
      transferId,
      itemId: item.base,
      qty: 6,
      qtyMoved: 0,
    }),
    db.insert(schema.replenishments).values({
      id: rplId,
      organizationId,
      warehouseId,
      number: "RPL-DEMO1",
      status: "draft",
      itemId: item.bulb,
      qty: 14,
      qtyMoved: 0,
      fromLocationId: locIds.a0101!,
      toLocationId: locIds.a0102!,
      notes: "Pick face A-01-02 is below min — pull bulbs from bulk",
      createdAt: now,
    }),
    db.insert(schema.shopifyConnections).values({
      id: newId(),
      organizationId,
      shopDomain: "northwind-makers.myshopify.com",
      accessToken: null,
      webhookSecret: "rackline-demo-shopify-secret",
      apiVersion: "2026-07",
      shopifyLocationGid: demoShopifyLocationGid(),
      mode: "demo",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.carrierConnections).values({
      id: newId(),
      organizationId,
      provider: "rackline",
      nickname: "Rackline Ground",
      accountNumber: null,
      mode: "demo",
      status: "connected",
      enabledServicesJson: JSON.stringify(["rackline_ground"]),
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.carrierConnections).values({
      id: newId(),
      organizationId,
      provider: "ups",
      nickname: "Northwind UPS",
      accountNumber: "A1B2C3",
      mode: "demo",
      status: "connected",
      enabledServicesJson: JSON.stringify(["ups_ground"]),
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.carrierConnections).values({
      id: newId(),
      organizationId,
      provider: "usps",
      nickname: "Northwind USPS",
      accountNumber: "123456789",
      mode: "demo",
      status: "connected",
      enabledServicesJson: JSON.stringify(["usps_priority"]),
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.orders).values({
      id: shopifyOrderRowId,
      organizationId,
      warehouseId,
      number: "#1004",
      customerName: "Maya Chen",
      status: "open",
      createdAt: now,
      source: "shopify",
      shopifyOrderId: "1004",
      shopifyOrderGid: "gid://shopify/Order/1004",
      shopifyOrderName: "#1004",
      shopifyFulfillmentOrderId: demoFulfillmentOrderId("1004"),
      shopifySyncStatus: "inbound",
      shopifyShopDomain: "northwind-makers.myshopify.com",
      ...destPatchFromAddress("88 Harbor Ave\nSeattle, WA 98101"),
    }),
    db.insert(schema.orderLines).values({
      id: newId(),
      orderId: shopifyOrderRowId,
      itemId: item.lamp,
      qty: 1,
      shopifyLineItemId: shopifyLineId,
      shopifyFulfillmentLineItemId: "gid://shopify/FulfillmentOrderLineItem/demo-8801",
    }),
  ]);

  await db.batch([
    db.insert(schema.asBuilt).values({
      id: newId(),
      organizationId,
      refType: "seed",
      refId: seedRef,
      parentItemId: item.lamp,
      parentLotCode: null,
      parentSerial: "LAMP-1001",
      componentItemId: item.bulb,
      componentLotCode: "LOT-2026-A",
      componentSerial: null,
      qty: 1,
      createdAt: now,
    }),
    db.insert(schema.asBuilt).values({
      id: newId(),
      organizationId,
      refType: "seed",
      refId: seedRef,
      parentItemId: item.lamp,
      parentLotCode: null,
      parentSerial: "LAMP-1001",
      componentItemId: item.shade,
      componentLotCode: null,
      componentSerial: null,
      qty: 1,
      createdAt: now,
    }),
    db.insert(schema.asBuilt).values({
      id: newId(),
      organizationId,
      refType: "seed",
      refId: seedRef,
      parentItemId: item.lamp,
      parentLotCode: null,
      parentSerial: "LAMP-1001",
      componentItemId: item.base,
      componentLotCode: null,
      componentSerial: null,
      qty: 1,
      createdAt: now,
    }),
    db.insert(schema.asBuilt).values({
      id: newId(),
      organizationId,
      refType: "seed",
      refId: seedRef,
      parentItemId: item.lamp,
      parentLotCode: null,
      parentSerial: "LAMP-1001",
      componentItemId: item.cord,
      componentLotCode: null,
      componentSerial: null,
      qty: 1,
      createdAt: now,
    }),
  ]);


  const clientId = newId();
  const zoneA = newId();
  const zoneB = newId();
  const westWh = newId();
  const westRecv = newId();
  const westBay = newId();
  const asnId = newId();
  const yardId = newId();
  const waveId = newId();
  const waveOrderA = newId();
  const waveOrderB = newId();
  const crossXfrId = newId();

  await db.batch([
    db.insert(schema.clients).values({
      id: clientId,
      organizationId,
      code: "ACME",
      name: "Acme Retail",
      createdAt: now,
    }),
    db.insert(schema.zones).values({
      id: zoneA,
      organizationId,
      warehouseId,
      code: "A",
      name: "Aisle A",
      createdAt: now,
    }),
    db.insert(schema.zones).values({
      id: zoneB,
      organizationId,
      warehouseId,
      code: "B",
      name: "Aisle B",
      createdAt: now,
    }),
    db.update(schema.locations).set({ zoneId: zoneA }).where(eq(schema.locations.id, locIds.a0101!)),
    db.update(schema.locations).set({ zoneId: zoneA }).where(eq(schema.locations.id, locIds.a0102!)),
    db.update(schema.locations).set({ zoneId: zoneB }).where(eq(schema.locations.id, locIds.b0101!)),
    db.insert(schema.warehouses).values({
      id: westWh,
      organizationId,
      name: "West shop",
      createdAt: now,
      mapWidth: 24,
      mapDepth: 18,
      mapHeight: 8,
      ...originColumns(resolveOrigin({ city: "Vancouver", region: "WA", country: "US" })),
    }),
    db.insert(schema.locations).values({
      id: westRecv,
      organizationId,
      warehouseId: westWh,
      code: "W-RECV",
      name: "West receiving",
      type: "receiving",
      barcode: "W-RECV",
      area: "dock",
      level: 1,
      posX: 2,
      posY: 1,
      posZ: 0,
      sizeX: 10,
      sizeY: 4,
      sizeZ: 3,
      slotRole: "none",
    }),
    db.insert(schema.locations).values({
      id: westBay,
      organizationId,
      warehouseId: westWh,
      code: "W-01-01",
      name: "West bulk bay",
      type: "storage",
      barcode: "W-01-01",
      area: "floor",
      aisle: "W",
      rack: "01",
      bay: "01",
      level: 1,
      posX: 4,
      posY: 8,
      posZ: 0,
      sizeX: 4,
      sizeY: 3,
      sizeZ: 2,
      slotRole: "bulk",
    }),
    db.insert(schema.asns).values({
      id: asnId,
      organizationId,
      warehouseId,
      number: "ASN-DEMO1",
      vendorName: "Harbor Components",
      status: "expected",
      purchaseId,
      clientId,
      eta: now + 86_400_000,
      notes: "Advance notice for PO-DEMO1 bulbs and shades",
      createdAt: now,
      expectedAt: now,
    }),
    db.insert(schema.asnLines).values({
      id: newId(),
      asnId,
      itemId: item.bulb,
      qtyExpected: 20,
      qtyReceived: 0,
    }),
    db.insert(schema.asnLines).values({
      id: newId(),
      asnId,
      itemId: item.shade,
      qtyExpected: 8,
      qtyReceived: 0,
    }),
    db.insert(schema.yardVisits).values({
      id: yardId,
      organizationId,
      warehouseId,
      number: "YRD-DEMO1",
      status: "expected",
      carrierName: "UPS Freight",
      trailerNumber: "TRL-4421",
      asnId,
      purchaseId,
      eta: now + 86_400_000,
      notes: "Drop ASN-DEMO1 at RECV",
      createdAt: now,
    }),
    db.insert(schema.orders).values({
      id: waveOrderA,
      organizationId,
      warehouseId,
      number: "ORD-WAVE1",
      customerName: "Acme Retail — store 12",
      status: "open",
      createdAt: now,
      source: "manual",
      clientId,
      shipToAddress: "12 Market St\nSeattle, WA 98101",
    }),
    db.insert(schema.orderLines).values({ id: newId(), orderId: waveOrderA, itemId: item.shade, qty: 3 }),
    db.insert(schema.orderLines).values({ id: newId(), orderId: waveOrderA, itemId: item.base, qty: 2 }),
    db.insert(schema.orders).values({
      id: waveOrderB,
      organizationId,
      warehouseId,
      number: "ORD-WAVE2",
      customerName: "Acme Retail — store 18",
      status: "open",
      createdAt: now,
      source: "manual",
      clientId,
      shipToAddress: "18 Pine St\nSeattle, WA 98101",
    }),
    db.insert(schema.orderLines).values({ id: newId(), orderId: waveOrderB, itemId: item.shade, qty: 2 }),
    db.insert(schema.orderLines).values({ id: newId(), orderId: waveOrderB, itemId: item.lamp, qty: 1 }),
    db.insert(schema.waves).values({
      id: waveId,
      organizationId,
      warehouseId,
      number: "WAV-DEMO1",
      status: "draft",
      mode: "batch",
      zoneId: zoneA,
      clientId,
      notes: "Batch pick Acme stores — consolidate SHADE",
      createdAt: now,
    }),
    db.insert(schema.waveOrders).values({ id: newId(), waveId, orderId: waveOrderA }),
    db.insert(schema.waveOrders).values({ id: newId(), waveId, orderId: waveOrderB }),
    db.update(schema.orders).set({ waveId }).where(eq(schema.orders.id, waveOrderA)),
    db.update(schema.orders).set({ waveId }).where(eq(schema.orders.id, waveOrderB)),
    db.insert(schema.transfers).values({
      id: crossXfrId,
      organizationId,
      warehouseId,
      number: "XFR-WEST1",
      status: "draft",
      fromLocationId: locIds.a0101!,
      toLocationId: westBay,
      toWarehouseId: westWh,
      notes: "Ship 4× SHADE to West shop",
      createdAt: now,
    }),
    db.insert(schema.transferLines).values({
      id: newId(),
      transferId: crossXfrId,
      itemId: item.shade,
      qty: 4,
      qtyMoved: 0,
    }),
    db.insert(schema.billingAccounts).values({
      organizationId,
      plan: "3pl",
      status: "active",
      createdAt: now,
    }),
    db.insert(schema.invoices).values({
      id: newId(),
      organizationId,
      number: "INV-DEMO1",
      periodStart: now - 30 * 86_400_000,
      periodEnd: now,
      amountCents: 500,
      status: "draft",
      createdAt: now,
    }),
  ]);

  const browserPrinterId = newId();
  const downloadPrinterId = newId();
  const stationId = newId();
  await db.batch([
    db.insert(schema.printers).values({
      id: browserPrinterId,
      organizationId,
      name: "Browser (HTML)",
      connection: "browser",
      media: "letter",
      dpi: 203,
      isDefault: 1,
      createdAt: now,
    }),
    db.insert(schema.printers).values({
      id: downloadPrinterId,
      organizationId,
      name: "ZPL download",
      connection: "download",
      media: "4x6",
      dpi: 203,
      isDefault: 0,
      createdAt: now,
    }),
    db.insert(schema.printStations).values({
      id: stationId,
      organizationId,
      name: "Front desk",
      warehouseId,
      defaultPrinterId: browserPrinterId,
      bayPrinterId: browserPrinterId,
      shippingPrinterId: downloadPrinterId,
      createdAt: now,
    }),
  ]);

  const fl01 = newId();
  const fl02 = newId();
  const pj01 = newId();
  const openAsnId = newId();
  const closedAsnId = newId();
  const yesterdayStart = now - 26 * 60 * 60 * 1000;
  const yesterdayEnd = now - 2 * 60 * 60 * 1000;
  const sitDownItems = checklistForClass("sit_down").map((item) => ({
    code: item.code,
    result: item.code === "horn" || item.code === "hydraulics" ? "fail" : "pass",
  }));
  const sitDownPass = checklistForClass("sit_down").map((item) => ({ code: item.code, result: "pass" }));
  const jackPass = checklistForClass("pallet_jack").map((item) => ({ code: item.code, result: "pass" }));

  await db.batch([
    db.insert(schema.equipment).values({
      id: fl01,
      organizationId,
      warehouseId,
      code: "FL-01",
      name: "Crown sit-down",
      class: "sit_down",
      barcode: equipmentBarcode("FL-01"),
      status: "checked_out",
      notes: "Main aisle truck",
      createdAt: now,
    }),
    db.insert(schema.equipment).values({
      id: pj01,
      organizationId,
      warehouseId,
      code: "PJ-01",
      name: "Electric pallet jack",
      class: "pallet_jack",
      barcode: equipmentBarcode("PJ-01"),
      status: "available",
      createdAt: now,
    }),
    db.insert(schema.equipment).values({
      id: fl02,
      organizationId,
      warehouseId,
      code: "FL-02",
      name: "Toyota sit-down",
      class: "sit_down",
      barcode: equipmentBarcode("FL-02"),
      status: "out_of_service",
      notes: "Horn and leak on last pre-use",
      createdAt: now,
    }),
    db.insert(schema.operatorCertifications).values({
      id: newId(),
      organizationId,
      userId,
      class: "sit_down",
      expiresOn: addUtcDays(utcYyyymmdd(), 365),
      createdAt: now,
    }),
    db.insert(schema.operatorCertifications).values({
      id: newId(),
      organizationId,
      userId,
      class: "pallet_jack",
      expiresOn: addUtcDays(utcYyyymmdd(), 20),
      createdAt: now,
    }),
    db.insert(schema.equipmentAssignments).values({
      id: closedAsnId,
      organizationId,
      warehouseId,
      number: "CST-DEMO0",
      equipmentId: pj01,
      operatorUserId: userId,
      status: "closed",
      shift: "days",
      startedAt: yesterdayStart,
      endedAt: yesterdayEnd,
      startedBy: userId,
      endedBy: userId,
    }),
    db.insert(schema.equipmentAssignments).values({
      id: openAsnId,
      organizationId,
      warehouseId,
      number: "CST-DEMO1",
      equipmentId: fl01,
      operatorUserId: userId,
      status: "open",
      shift: "days",
      refType: "transfer",
      refId: transferId,
      startedAt: now,
      startedBy: userId,
    }),
    db.insert(schema.equipmentInspections).values({
      id: newId(),
      organizationId,
      equipmentId: pj01,
      assignmentId: closedAsnId,
      result: "pass",
      itemsJson: JSON.stringify(jackPass),
      createdBy: userId,
      createdAt: yesterdayStart,
    }),
    db.insert(schema.equipmentInspections).values({
      id: newId(),
      organizationId,
      equipmentId: fl01,
      assignmentId: openAsnId,
      result: "pass",
      itemsJson: JSON.stringify(sitDownPass),
      createdBy: userId,
      createdAt: now,
    }),
    db.insert(schema.equipmentInspections).values({
      id: newId(),
      organizationId,
      equipmentId: fl02,
      assignmentId: null,
      result: "fail",
      itemsJson: JSON.stringify(sitDownItems),
      createdBy: userId,
      createdAt: now,
    }),
    db.insert(schema.equipmentEvents).values({
      id: newId(),
      organizationId,
      equipmentId: pj01,
      assignmentId: closedAsnId,
      type: "checked_out",
      actorUserId: userId,
      payloadJson: JSON.stringify({ shift: "days" }),
      createdAt: yesterdayStart,
    }),
    db.insert(schema.equipmentEvents).values({
      id: newId(),
      organizationId,
      equipmentId: pj01,
      assignmentId: closedAsnId,
      type: "checked_in",
      actorUserId: userId,
      createdAt: yesterdayEnd,
    }),
    db.insert(schema.equipmentEvents).values({
      id: newId(),
      organizationId,
      equipmentId: fl01,
      assignmentId: openAsnId,
      type: "checked_out",
      actorUserId: userId,
      payloadJson: JSON.stringify({ shift: "days", refType: "transfer", refId: transferId, taskNumber: "XFR-DEMO1" }),
      createdAt: now,
    }),
    db.insert(schema.equipmentEvents).values({
      id: newId(),
      organizationId,
      equipmentId: fl02,
      type: "out_of_service",
      actorUserId: userId,
      payloadJson: JSON.stringify({ failed: ["horn", "hydraulics"] }),
      createdAt: now,
    }),
  ]);

  await db
    .update(schema.inventoryMovements)
    .set({ equipmentId: fl01, assignmentId: openAsnId })
    .where(
      and(eq(schema.inventoryMovements.organizationId, organizationId), eq(schema.inventoryMovements.createdBy, userId)),
    );

  const hour = 3_600_000;
  const sku = { lamp: item.lamp, bulb: item.bulb, shade: item.shade };
  const traffic = [
    { number: "ORD-LAX1", customer: "Echo Park Shop", address: "120 Spring St\nLos Angeles, CA 90012", sku: "lamp" as const, qty: 2, hoursAgo: 8, carrier: "ups_ground", tracking: "RL-LAX001" },
    { number: "ORD-SFO1", customer: "Mission Light", address: "18 Valencia St\nSan Francisco, CA 94110", sku: "shade" as const, qty: 3, hoursAgo: 5, carrier: "usps_priority", tracking: "RL-SFO001" },
    { number: "ORD-DEN1", customer: "High Plains Co", address: "1401 Blake St\nDenver, CO 80202", sku: "lamp" as const, qty: 1, hoursAgo: 20, carrier: "rackline_ground", tracking: "RL-DEN001" },
    { number: "ORD-AUS1", customer: "South Congress", address: "1400 S Congress Ave\nAustin, TX 78704", sku: "lamp" as const, qty: 2, hoursAgo: 14, carrier: "ups_ground", tracking: "RL-AUS001" },
    { number: "ORD-CHI1", customer: "Wicker Park", address: "1608 N Milwaukee Ave\nChicago, IL 60647", sku: "bulb" as const, qty: 6, hoursAgo: 30, carrier: "usps_priority", tracking: "RL-CHI001", tracker: "delivered" },
    { number: "ORD-NYC1", customer: "Brooklyn Studio", address: "85 N 3rd St\nBrooklyn, NY 11249", sku: "lamp" as const, qty: 1, hoursAgo: 10, carrier: "ups_ground", tracking: "RL-NYC001", tracker: "in_transit" },
    { number: "ORD-BOS1", customer: "Fort Point", address: "12 Farnsworth St\nBoston, MA 02210", sku: "lamp" as const, qty: 1, hoursAgo: 120, carrier: "ups_ground", tracking: "RL-BOS001" },
    { number: "ORD-MIA1", customer: "Wynwood Lab", address: "2301 NW 2nd Ave\nMiami, FL 33127", sku: "shade" as const, qty: 2, hoursAgo: 16, carrier: "usps_priority", tracking: "RL-MIA001" },
    { number: "ORD-ATL1", customer: "Old Fourth Ward", address: "675 Ponce De Leon Ave\nAtlanta, GA 30308", sku: "lamp" as const, qty: 2, hoursAgo: 4, carrier: "rackline_ground", tracking: "RL-ATL001" },
    { number: "ORD-PHX1", customer: "Roosevelt Row", address: "918 N 2nd St\nPhoenix, AZ 85004", sku: "bulb" as const, qty: 4, hoursAgo: 22, carrier: "ups_ground", tracking: "RL-PHX001" },
    { number: "ORD-MSP1", customer: "North Loop", address: "1101 S 10th St\nMinneapolis, MN 55415", sku: "lamp" as const, qty: 1, hoursAgo: 12, carrier: "usps_priority", tracking: "RL-MSP001" },
    { number: "ORD-YYZ1", customer: "King West", address: "12 King Street West\nToronto, ON M5H 1A1", sku: "lamp" as const, qty: 1, hoursAgo: 18, carrier: "ups_ground", tracking: "RL-YYZ001" },
    { number: "ORD-LON1", customer: "Shoreditch Works", address: "221B Baker Street\nLondon, UK", sku: "lamp" as const, qty: 1, hoursAgo: 36, carrier: "usps_priority", tracking: "RL-LON001" },
  ];
  const packedId = newId();
  const packedLineId = newId();
  const box1Id = newId();
  const box2Id = newId();
  const willCallId = newId();
  const trafficInserts = traffic.flatMap((row) => {
    const id = newId();
    const shippedAt = now - row.hoursAgo * hour;
    return [
      db.insert(schema.orders).values({
        id,
        organizationId,
        warehouseId,
        number: row.number,
        customerName: row.customer,
        status: "shipped",
        createdAt: shippedAt - 6 * hour,
        packedAt: shippedAt - hour,
        shippedAt,
        source: "manual",
        trackingNumber: row.tracking,
        trackingCompany: row.carrier === "usps_priority" ? "USPS" : row.carrier === "ups_ground" ? "UPS" : "Rackline",
        carrierService: row.carrier,
        trackerStatus: "tracker" in row ? (row as { tracker?: string }).tracker ?? null : null,
        trackerUpdatedAt: "tracker" in row && (row as { tracker?: string }).tracker ? shippedAt : null,
        ...destPatchFromAddress(row.address),
      }),
      db.insert(schema.orderLines).values({
        id: newId(),
        orderId: id,
        itemId: sku[row.sku],
        qty: row.qty,
        qtyPicked: row.qty,
        qtyPacked: row.qty,
      }),
    ];
  });
  await db.batch([
    db.insert(schema.orders).values({
      id: packedId,
      organizationId,
      warehouseId,
      number: "ORD-DFW1",
      customerName: "Deep Ellum",
      status: "packed",
      createdAt: now - 8 * hour,
      packedAt: now - hour,
      source: "manual",
      trackingNumber: "RL-DFW001",
      carrierService: "ups_ground",
      ...destPatchFromAddress("2803 Main St\nDallas, TX 75226"),
    }),
    db.insert(schema.orderLines).values({
      id: packedLineId,
      orderId: packedId,
      itemId: item.lamp,
      qty: 2,
      qtyPicked: 2,
      qtyPacked: 2,
    }),
    db.insert(schema.orderPackages).values({
      id: box1Id,
      organizationId,
      orderId: packedId,
      number: "BOX-1",
      seq: 1,
      weightOz: 16,
      lengthIn: 12,
      widthIn: 9,
      heightIn: 6,
      trackingNumber: "RL-DFW001",
      trackingCompany: "UPS",
      carrierService: "ups_ground",
      labelStatus: "purchased",
      createdAt: now - hour,
    }),
    db.insert(schema.orderPackageLines).values({
      id: newId(),
      packageId: box1Id,
      orderLineId: packedLineId,
      itemId: item.lamp,
      qty: 1,
    }),
    db.insert(schema.orderPackages).values({
      id: box2Id,
      organizationId,
      orderId: packedId,
      number: "BOX-2",
      seq: 2,
      weightOz: 12,
      lengthIn: 10,
      widthIn: 8,
      heightIn: 6,
      trackingNumber: "RL-DFW002",
      trackingCompany: "UPS",
      carrierService: "ups_ground",
      labelStatus: "purchased",
      createdAt: now - hour,
    }),
    db.insert(schema.orderPackageLines).values({
      id: newId(),
      packageId: box2Id,
      orderLineId: packedLineId,
      itemId: item.lamp,
      qty: 1,
    }),
    db.insert(schema.orders).values({
      id: willCallId,
      organizationId,
      warehouseId,
      number: "ORD-CALL1",
      customerName: "Will Call",
      status: "shipped",
      createdAt: now - 5 * hour,
      packedAt: now - 3 * hour,
      shippedAt: now - 2 * hour,
      source: "manual",
      trackingNumber: "RL-CALL01",
      carrierService: "rackline_ground",
      shipToAddress: "Will call",
    }),
    db.insert(schema.orderLines).values({
      id: newId(),
      orderId: willCallId,
      itemId: item.shade,
      qty: 1,
      qtyPicked: 1,
      qtyPacked: 1,
    }),
    ...(trafficInserts as typeof trafficInserts),
  ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

  await db.insert(schema.trackerWebhookReceipts).values([
    {
      id: newId(),
      organizationId,
      provider: "demo",
      trackingNumber: "RL-NYC001",
      eventId: "demo-nyc-in-transit",
      payloadJson: JSON.stringify({ trackingNumber: "RL-NYC001", status: "in_transit" }),
      createdAt: now - 8 * hour,
    },
    {
      id: newId(),
      organizationId,
      provider: "demo",
      trackingNumber: "RL-CHI001",
      eventId: "demo-chi-delivered",
      payloadJson: JSON.stringify({ trackingNumber: "RL-CHI001", status: "delivered" }),
      createdAt: now - 6 * hour,
    },
  ]);

  await seedLaborHistory(db, {
    organizationId,
    warehouseId,
    locIds,
    item,
    now,
    ownerUserId: userId,
  });
  await seedAssignedJobs(db, organizationId, userId, orderId, woId);
  await syncShopifySellable(db, organizationId);

  return { organizationId };
}

async function applyLabor(
  db: AppDb,
  organizationId: string,
  userId: string,
  when: number,
  pairs: { locationId: string; itemId: string }[],
  build: (balances: Map<string, number>) => ReturnType<typeof planReceive> | ReturnType<typeof planShip>,
) {
  const loaded = await loadBalanceMap(db, organizationId, pairs);
  const plan = build(qtyMap(loaded));
  await persistStockPlan(db, { organizationId, createdBy: userId, now: when, loaded, plan, skipShopifySync: true });
}

async function seedLaborHistory(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    locIds: Record<string, string>;
    item: Record<string, string>;
    now: number;
    ownerUserId: string;
  },
) {
  const { organizationId, warehouseId, locIds, item, now, ownerUserId } = input;
  const mayaId = newId();
  const jordanId = newId();
  const createdAt = new Date(now);
  await db.insert(schema.user).values([
    {
      id: mayaId,
      name: "Maya Chen",
      email: "maya@northwind.makers",
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: jordanId,
      name: "Jordan Dock",
      email: "jordan@northwind.makers",
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    },
  ]);
  await db.insert(schema.memberships).values([
    { id: newId(), organizationId, userId: mayaId, role: "operator" },
    { id: newId(), organizationId, userId: jordanId, role: "operator" },
  ]);
  const [ownerAccount] = await db.select().from(schema.account).where(eq(schema.account.userId, ownerUserId)).limit(1);
  if (ownerAccount?.password) {
    await db.insert(schema.account).values([
      {
        id: newId(),
        accountId: mayaId,
        providerId: "credential",
        userId: mayaId,
        password: ownerAccount.password,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: newId(),
        accountId: jordanId,
        providerId: "credential",
        userId: jordanId,
        password: ownerAccount.password,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
  }

  const twoDays = now - 2 * 24 * 60 * 60 * 1000;
  const yesterday = now - 20 * 60 * 60 * 1000;
  const recv = locIds.recv!;
  const a0101 = locIds.a0101!;
  const a0203 = locIds.a0203!;
  const b0101 = locIds.b0101!;

  await applyLabor(db, organizationId, jordanId, twoDays, [{ locationId: recv, itemId: item.base }], (balances) =>
    planReceive({ itemId: item.base, locationId: recv, qty: 10, refId: "rcp-labor-base", refType: "receipt", balances }),
  );
  await applyLabor(
    db,
    organizationId,
    jordanId,
    twoDays + 45_000,
    [
      { locationId: recv, itemId: item.base },
      { locationId: a0203, itemId: item.base },
    ],
    (balances) =>
      planMove({
        itemId: item.base,
        sku: "BASE",
        fromLocationId: recv,
        toLocationId: a0203,
        qty: 10,
        refId: "xfr-labor-base",
        refType: "transfer",
        balances,
      }),
  );
  await applyLabor(db, organizationId, jordanId, now - 6 * 60 * 60 * 1000, [{ locationId: recv, itemId: item.resin }], (balances) =>
    planReceive({
      itemId: item.resin,
      locationId: recv,
      qty: 3,
      refId: "rcp-labor-resin",
      refType: "receipt",
      balances,
      weightGrams: 1500,
    }),
  );

  const kpiOrder = newId();
  await db.insert(schema.orders).values({
    id: kpiOrder,
    organizationId,
    warehouseId,
    number: "ORD-KPI1",
    customerName: "KPI studio",
    status: "shipped",
    createdAt: yesterday,
    pickedAt: yesterday + 90_000,
    packedAt: yesterday + 150_000,
    shippedAt: yesterday + 180_000,
    source: "manual",
  });
  await db.insert(schema.orderLines).values([
    { id: newId(), orderId: kpiOrder, itemId: item.base, qty: 4, qtyPicked: 4, qtyPacked: 4 },
    { id: newId(), orderId: kpiOrder, itemId: item.glue, qty: 2, qtyPicked: 1, qtyPacked: 1 },
    { id: newId(), orderId: kpiOrder, itemId: item.lamp, qty: 1, qtyPicked: 1, qtyPacked: 1 },
  ]);

  const glueExpiry = addUtcDays(utcYyyymmdd(), 180);
  await applyLabor(db, organizationId, mayaId, yesterday, [{ locationId: a0101, itemId: item.base }], (balances) =>
    planPick({ itemId: item.base, sku: "BASE", locationId: a0101, qty: 4, refId: kpiOrder, balances }),
  );
  await applyLabor(db, organizationId, mayaId, yesterday + 45_000, [{ locationId: a0101, itemId: item.glue }], (balances) =>
    planPick({
      itemId: item.glue,
      sku: "GLUE",
      locationId: a0101,
      qty: 2,
      refId: kpiOrder,
      balances,
      lotCode: "LOT-NEW",
      expiresOn: glueExpiry,
    }),
  );
  await applyLabor(db, organizationId, mayaId, yesterday + 90_000, [{ locationId: b0101, itemId: item.lamp }], (balances) =>
    planPick({
      itemId: item.lamp,
      sku: "LAMP",
      locationId: b0101,
      qty: 1,
      refId: kpiOrder,
      balances,
      serials: ["LAMP-1008"],
    }),
  );
  await applyLabor(db, organizationId, mayaId, yesterday + 110_000, [{ locationId: a0101, itemId: item.glue }], (balances) =>
    planUnpick({
      itemId: item.glue,
      sku: "GLUE",
      locationId: a0101,
      qty: 1,
      refId: kpiOrder,
      balances,
      lotCode: "LOT-NEW",
      expiresOn: glueExpiry,
    }),
  );
  await db.insert(schema.packEvents).values([
    {
      id: newId(),
      organizationId,
      warehouseId,
      userId: mayaId,
      orderId: kpiOrder,
      itemId: item.base,
      qty: 4,
      createdAt: yesterday + 150_000,
    },
    {
      id: newId(),
      organizationId,
      warehouseId,
      userId: mayaId,
      orderId: kpiOrder,
      itemId: item.glue,
      qty: 1,
      createdAt: yesterday + 150_000,
    },
    {
      id: newId(),
      organizationId,
      warehouseId,
      userId: mayaId,
      orderId: kpiOrder,
      itemId: item.lamp,
      qty: 1,
      createdAt: yesterday + 155_000,
    },
  ]);
  await applyLabor(db, organizationId, mayaId, yesterday + 180_000, [{ locationId: b0101, itemId: item.lamp }], () =>
    planShip({ itemId: item.lamp, locationId: b0101, qty: 1, refId: kpiOrder }),
  );
  await applyLabor(db, organizationId, mayaId, yesterday + 180_000, [{ locationId: a0101, itemId: item.base }], () =>
    planShip({ itemId: item.base, locationId: a0101, qty: 4, refId: kpiOrder }),
  );
  await applyLabor(db, organizationId, mayaId, yesterday + 180_000, [{ locationId: a0101, itemId: item.glue }], () =>
    planShip({ itemId: item.glue, locationId: a0101, qty: 1, refId: kpiOrder }),
  );
}

export async function demoUserExists(db: AppDb): Promise<boolean> {
  const [row] = await db.select().from(schema.user).where(eq(schema.user.email, DEMO_EMAIL)).limit(1);
  return Boolean(row);
}
