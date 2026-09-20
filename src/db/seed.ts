import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { chainPlans, planReceive } from "../domain/inventory";
import { persistStockPlan } from "./stock";
import { provisionOrganization } from "../lib/org";
import { demoFulfillmentOrderId } from "../domain/shopify";
import { areaForType, gridPosition } from "../domain/map-layout";
import { addUtcDays, utcYyyymmdd } from "../domain/expiry";

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
  await db
    .update(schema.warehouses)
    .set({ shipFromAddress: "14 Dock St, Portland, OR 97209" })
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
    }),
    db.insert(schema.items).values({
      id: item.cord,
      organizationId,
      sku: "CORD",
      name: "Power cord",
      type: "raw",
      barcode: "CORD",
      createdAt: now,
      reorderPoint: 10,
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
    db.insert(schema.orders).values({
      id: orderId,
      organizationId,
      warehouseId,
      number: "ORD-DEMO1",
      customerName: "Harbor Workshop",
      status: "open",
      createdAt: now,
      source: "manual",
      shipToAddress: "14 Dock Street\nPortland, OR 97201",
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
      shipToAddress: "88 Harbor Ave\nSeattle, WA 98101",
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
  ]);

  return { organizationId };
}

export async function demoUserExists(db: AppDb): Promise<boolean> {
  const [row] = await db.select().from(schema.user).where(eq(schema.user.email, DEMO_EMAIL)).limit(1);
  return Boolean(row);
}
