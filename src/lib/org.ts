import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppDb } from "../db/stock";
import { newId } from "./ids";
import { forbidden, notFound } from "./http";
import type { Role } from "../db/schema";

export async function provisionOrganization(
  db: AppDb,
  userId: string,
  name: string,
): Promise<{ organizationId: string; warehouseId: string }> {
  const now = Date.now();
  const organizationId = newId();
  const warehouseId = newId();
  await db.batch([
    db.insert(schema.organizations).values({ id: organizationId, name, createdAt: now }),
    db.insert(schema.memberships).values({
      id: newId(),
      organizationId,
      userId,
      role: "owner",
    }),
    db.insert(schema.warehouses).values({
      id: warehouseId,
      organizationId,
      name: "Main warehouse",
      createdAt: now,
    }),
  ]);
  return { organizationId, warehouseId };
}

export async function getMembership(db: AppDb, userId: string) {
  const [row] = await db
    .select({
      organizationId: schema.memberships.organizationId,
      role: schema.memberships.role,
      organizationName: schema.organizations.name,
    })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, userId))
    .limit(1);
  return row ?? null;
}

export function requireOwner(role: Role | undefined): void {
  if (role !== "owner") forbidden("Owner role required");
}

export async function getOrgItem(db: AppDb, organizationId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.id, itemId), eq(schema.items.organizationId, organizationId)))
    .limit(1);
  if (!item) notFound("Item not found");
  return item;
}

export async function getOrgLocation(db: AppDb, organizationId: string, locationId: string) {
  const [location] = await db
    .select()
    .from(schema.locations)
    .where(
      and(eq(schema.locations.id, locationId), eq(schema.locations.organizationId, organizationId)),
    )
    .limit(1);
  if (!location) notFound("Location not found");
  return location;
}

export async function getOrgLocationByScan(db: AppDb, organizationId: string, code: string) {
  const [byBarcode] = await db
    .select()
    .from(schema.locations)
    .where(and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.barcode, code)))
    .limit(1);
  if (byBarcode) return byBarcode;
  const [byCode] = await db
    .select()
    .from(schema.locations)
    .where(and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.code, code)))
    .limit(1);
  return byCode ?? null;
}

export const ITEM_TYPES = ["raw", "wip", "finished", "packaging"] as const;
export const LOCATION_TYPES = ["receiving", "storage", "production", "shipping"] as const;

export function isItemType(value: string): value is (typeof ITEM_TYPES)[number] {
  return (ITEM_TYPES as readonly string[]).includes(value);
}

export function isLocationType(value: string): value is (typeof LOCATION_TYPES)[number] {
  return (LOCATION_TYPES as readonly string[]).includes(value);
}

export type LineInput = { itemId: string; qty: number };
