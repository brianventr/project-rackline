import { eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { chainPlans, planReceive } from "../domain/inventory";
import { persistStockPlan } from "./stock";
import { provisionOrganization } from "../lib/org";

export const DEMO_EMAIL = "demo@northwind.makers";
export const DEMO_PASSWORD = "rackline-demo";

export async function seedNorthwind(db: AppDb, userId: string): Promise<{ organizationId: string }> {
  const { organizationId, warehouseId } = await provisionOrganization(db, userId, "Northwind Makers");
  const now = Date.now();

  const loc = {
    recv: newId(),
    storage: newId(),
    prod: newId(),
    ship: newId(),
  };
  await db.batch([
    db.insert(schema.locations).values({
      id: loc.recv,
      organizationId,
      warehouseId,
      code: "RECV",
      name: "Receiving dock",
      type: "receiving",
    }),
    db.insert(schema.locations).values({
      id: loc.storage,
      organizationId,
      warehouseId,
      code: "A-01-01",
      name: "Aisle A / rack 01 / bin 01",
      type: "storage",
    }),
    db.insert(schema.locations).values({
      id: loc.prod,
      organizationId,
      warehouseId,
      code: "PROD",
      name: "Assembly bench",
      type: "production",
    }),
    db.insert(schema.locations).values({
      id: loc.ship,
      organizationId,
      warehouseId,
      code: "SHIP",
      name: "Outbound staging",
      type: "shipping",
    }),
  ]);

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
    { itemId: item.bulb, qty: 40 },
    { itemId: item.shade, qty: 20 },
    { itemId: item.base, qty: 15 },
    { itemId: item.cord, qty: 25 },
    { itemId: item.lamp, qty: 8 },
  ];
  const seedRef = "seed";
  const plan = chainPlans(
    new Map(),
    starting.map((line) => (balances) =>
      planReceive({
        itemId: line.itemId,
        locationId: loc.storage,
        qty: line.qty,
        refId: seedRef,
        balances,
      }),
    ),
  );
  // Rewrite movement ref type for seed stock
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
      sourceLocationId: loc.storage,
      outputLocationId: loc.prod,
      createdAt: now,
    }),
  ]);

  return { organizationId };
}

export async function demoUserExists(db: AppDb): Promise<boolean> {
  const [row] = await db.select().from(schema.user).where(eq(schema.user.email, DEMO_EMAIL)).limit(1);
  return Boolean(row);
}
