import { eq } from "drizzle-orm";
import {
  buildingPrice,
  licensesForUncovered,
  monthlyLicenseTotal,
  planForOperatingMode,
  type LicensePlan,
} from "../domain/building-license";
import { newId } from "../lib/ids";
import * as schema from "./schema";
import type { AppDb } from "./stock";

export type BuildingLicenseView = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  plan: string;
  price: number;
};

export type BuildingLicenseSummary = {
  plan: LicensePlan;
  /** What the next building costs on the plan the shop is running now. */
  price: number;
  licenses: BuildingLicenseView[];
  monthlyTotal: number;
};

async function operatingMode(db: AppDb, organizationId: string): Promise<string | null> {
  const [org] = await db
    .select({ operatingMode: schema.organizations.operatingMode })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return org?.operatingMode ?? null;
}

/** Every building has a license. Buildings created before licenses existed get one at the current plan price. */
export async function ensureBuildingLicenses(db: AppDb, organizationId: string): Promise<BuildingLicenseSummary> {
  const plan = planForOperatingMode(await operatingMode(db, organizationId));
  const warehouses = await db
    .select({ id: schema.warehouses.id, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId));
  const existing = await db
    .select()
    .from(schema.buildingLicenses)
    .where(eq(schema.buildingLicenses.organizationId, organizationId));
  const missing = licensesForUncovered(
    warehouses.map((row) => row.id),
    new Set(existing.map((row) => row.warehouseId)),
    plan,
  );
  if (missing.length > 0) {
    const now = Date.now();
    await db
      .insert(schema.buildingLicenses)
      .values(
        missing.map((row) => ({
          id: newId(),
          organizationId,
          warehouseId: row.warehouseId,
          plan: row.plan,
          priceDollars: row.priceDollars,
          createdAt: now,
        })),
      )
      .onConflictDoNothing({ target: schema.buildingLicenses.warehouseId });
  }
  const licenses = missing.length > 0 ? await db
    .select()
    .from(schema.buildingLicenses)
    .where(eq(schema.buildingLicenses.organizationId, organizationId)) : existing;
  const nameById = new Map(warehouses.map((row) => [row.id, row.name]));
  const views = licenses.map((row) => ({
    id: row.id,
    warehouseId: row.warehouseId,
    warehouseName: nameById.get(row.warehouseId) ?? "Building",
    plan: row.plan,
    price: row.priceDollars,
  }));
  return {
    plan,
    price: buildingPrice(plan),
    licenses: views,
    monthlyTotal: monthlyLicenseTotal(views.map((row) => row.price)),
  };
}

/** Buy the next building: the warehouse and its license land together. */
export async function buyBuildingLicense(
  db: AppDb,
  organizationId: string,
  name: string,
): Promise<{ warehouse: typeof schema.warehouses.$inferSelect; plan: LicensePlan; price: number }> {
  const plan = planForOperatingMode(await operatingMode(db, organizationId));
  const price = buildingPrice(plan);
  const now = Date.now();
  const warehouseId = newId();
  await db.batch([
    db.insert(schema.warehouses).values({
      id: warehouseId,
      organizationId,
      name,
      createdAt: now,
    }),
    db.insert(schema.buildingLicenses).values({
      id: newId(),
      organizationId,
      warehouseId,
      plan,
      priceDollars: price,
      createdAt: now,
    }),
  ]);
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, warehouseId))
    .limit(1);
  if (!warehouse) throw new Error("Building license did not save");
  return { warehouse, plan, price };
}
