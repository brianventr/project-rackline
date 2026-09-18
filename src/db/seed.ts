import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { chainPlans, planReceive } from "../domain/inventory";
import { persistStockPlan } from "./stock";
import { provisionOrganization } from "../lib/org";
import { areaForType, gridPosition } from "../domain/map-layout";

export const DEMO_EMAIL = "demo@northwind.makers";
export const DEMO_PASSWORD = "rackline-demo";

type LocSeed = {
  key: string;
  code: string;
  name: string;
  type: "receiving" | "storage" | "production" | "shipping";
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
  { key: "a0101", code: "A-01-01", name: "Aisle A / rack 01 / bay 01", type: "storage", aisle: "A", rack: "01", bay: "01", level: 1 },
  { key: "a0102", code: "A-01-02", name: "Aisle A / rack 01 / bay 02", type: "storage", aisle: "A", rack: "01", bay: "02", level: 1 },
  { key: "a0103", code: "A-01-03", name: "Aisle A / rack 01 / bay 03", type: "storage", aisle: "A", rack: "01", bay: "03", level: 1 },
  { key: "a0101l2", code: "A-01-01-2", name: "Aisle A / rack 01 / bay 01 / level 2", type: "storage", aisle: "A", rack: "01", bay: "01", level: 2 },
  { key: "a0102l2", code: "A-01-02-2", name: "Aisle A / rack 01 / bay 02 / level 2", type: "storage", aisle: "A", rack: "01", bay: "02", level: 2 },
  { key: "a0103l2", code: "A-01-03-2", name: "Aisle A / rack 01 / bay 03 / level 2", type: "storage", aisle: "A", rack: "01", bay: "03", level: 2 },
  { key: "a0201", code: "A-02-01", name: "Aisle A / rack 02 / bay 01", type: "storage", aisle: "A", rack: "02", bay: "01", level: 1 },
  { key: "a0202", code: "A-02-02", name: "Aisle A / rack 02 / bay 02", type: "storage", aisle: "A", rack: "02", bay: "02", level: 1 },
  { key: "a0203", code: "A-02-03", name: "Aisle A / rack 02 / bay 03", type: "storage", aisle: "A", rack: "02", bay: "03", level: 1 },
  { key: "b0101", code: "B-01-01", name: "Aisle B / rack 01 / bay 01", type: "storage", aisle: "B", rack: "01", bay: "01", level: 1 },
  { key: "b0102", code: "B-01-02", name: "Aisle B / rack 01 / bay 02", type: "storage", aisle: "B", rack: "01", bay: "02", level: 1 },
  { key: "b0101l2", code: "B-01-01-2", name: "Aisle B / rack 01 / bay 01 / level 2", type: "storage", aisle: "B", rack: "01", bay: "01", level: 2 },
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
    });
  });
  await db.batch(locationInserts as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

  const item = {
    bulb: newId(),
    shade: newId(),
    base: newId(),
    cord: newId(),
    lamp: newId(),
  };
  await db.batch([
    db.insert(schema.items).values({
      id: item.bulb,
      organizationId,
      sku: "LED-BULB",
      name: "LED bulb",
      type: "raw",
      createdAt: now,
    }),
    db.insert(schema.items).values({
      id: item.shade,
      organizationId,
      sku: "SHADE",
      name: "Lamp shade",
      type: "raw",
      createdAt: now,
    }),
    db.insert(schema.items).values({
      id: item.base,
      organizationId,
      sku: "BASE",
      name: "Cast iron base",
      type: "raw",
      createdAt: now,
    }),
    db.insert(schema.items).values({
      id: item.cord,
      organizationId,
      sku: "CORD",
      name: "Power cord",
      type: "raw",
      createdAt: now,
    }),
    db.insert(schema.items).values({
      id: item.lamp,
      organizationId,
      sku: "LAMP",
      name: "Desk lamp",
      type: "finished",
      createdAt: now,
    }),
  ]);

  const starting = [
    { itemId: item.bulb, locationId: locIds.a0101!, qty: 40 },
    { itemId: item.shade, locationId: locIds.a0101!, qty: 20 },
    { itemId: item.base, locationId: locIds.a0101!, qty: 15 },
    { itemId: item.cord, locationId: locIds.a0101!, qty: 25 },
    { itemId: item.lamp, locationId: locIds.b0101!, qty: 8 },
    { itemId: item.bulb, locationId: locIds.a0102!, qty: 6 },
    { itemId: item.shade, locationId: locIds.a0201!, qty: 4 },
  ];
  const seedRef = "seed";
  const plan = chainPlans(
    new Map(),
    starting.map(
      (line) => (balances) =>
        planReceive({
          itemId: line.itemId,
          locationId: line.locationId,
          qty: line.qty,
          refId: seedRef,
          balances,
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
  const orderId = newId();
  const woId = newId();
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
    db.insert(schema.receiptLines).values({ id: newId(), receiptId, itemId: item.bulb, qty: 12 }),
    db.insert(schema.receiptLines).values({ id: newId(), receiptId, itemId: item.shade, qty: 6 }),
    db.insert(schema.orders).values({
      id: orderId,
      organizationId,
      warehouseId,
      number: "ORD-DEMO1",
      customerName: "Harbor Workshop",
      status: "draft",
      createdAt: now,
    }),
    db.insert(schema.orderLines).values({ id: newId(), orderId, itemId: item.lamp, qty: 2 }),
    db.insert(schema.workOrders).values({
      id: woId,
      organizationId,
      warehouseId,
      number: "WO-DEMO1",
      itemId: item.lamp,
      qty: 4,
      status: "draft",
      sourceLocationId: locIds.a0101!,
      outputLocationId: locIds.prod!,
      createdAt: now,
    }),
  ]);

  return { organizationId };
}

export async function demoUserExists(db: AppDb): Promise<boolean> {
  const [row] = await db.select().from(schema.user).where(eq(schema.user.email, DEMO_EMAIL)).limit(1);
  return Boolean(row);
}
