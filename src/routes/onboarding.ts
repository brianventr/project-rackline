import { Hono } from "hono";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "../db/schema";
import type { AppDb } from "../db/stock";
import type { AppEnv } from "../lib/types";
import { conflict, requireString } from "../lib/http";
import { getOrgWarehouse, requireOwner } from "../lib/org";
import { newId } from "../lib/ids";
import { suggestPlacement, type PlaceableLocation } from "../domain/map-layout";
import {
  buildSampleCatalog,
  evaluateOnboarding,
  stockSignal,
  type OnboardingStepId,
} from "../domain/onboarding";

export const onboardingRoute = new Hono<AppEnv>();

async function countRows(query: Promise<{ n: number }[]>): Promise<number> {
  const [row] = await query;
  return Number(row?.n ?? 0);
}

async function exists(query: Promise<unknown[]>): Promise<number> {
  const rows = await query;
  return rows.length ? 1 : 0;
}

/**
 * Org-wide counts behind each step. Deliberately not scoped to one warehouse: opening a second,
 * empty warehouse must not send an org that already ships back to "Getting started".
 */
async function loadOnboardingCounts(db: AppDb, organizationId: string): Promise<Record<OnboardingStepId, number>> {
  const [items, locations, shelfRows, receives, shipped, shopify, carriers, members] = await Promise.all([
    countRows(
      db.select({ n: sql<number>`count(*)` }).from(schema.items).where(eq(schema.items.organizationId, organizationId)),
    ),
    countRows(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.locations)
        .where(eq(schema.locations.organizationId, organizationId)),
    ),
    countRows(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.inventoryBalances)
        .where(and(eq(schema.inventoryBalances.organizationId, organizationId), gt(schema.inventoryBalances.qty, 0))),
    ),
    exists(
      db
        .select({ id: schema.inventoryMovements.id })
        .from(schema.inventoryMovements)
        .where(
          and(
            eq(schema.inventoryMovements.organizationId, organizationId),
            eq(schema.inventoryMovements.type, "receive"),
            ne(schema.inventoryMovements.refType, "seed"),
          ),
        )
        .limit(1),
    ),
    countRows(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.orders)
        .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.status, "shipped"))),
    ),
    countRows(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.shopifyConnections)
        .where(eq(schema.shopifyConnections.organizationId, organizationId)),
    ),
    countRows(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.carrierConnections)
        .where(
          and(
            eq(schema.carrierConnections.organizationId, organizationId),
            ne(schema.carrierConnections.provider, "rackline"),
          ),
        ),
    ),
    countRows(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.memberships)
        .where(eq(schema.memberships.organizationId, organizationId)),
    ),
  ]);
  return {
    sku: items,
    bays: locations,
    stock: stockSignal(shelfRows, receives),
    shipped,
    shopify,
    carrier: carriers,
    teammate: members,
  };
}

/**
 * `GET /api/onboarding?warehouseId=` → `{ steps, sampleAvailable }`.
 * `sampleAvailable` is true only for an owner whose org has no SKUs and no bays yet.
 */
onboardingRoute.get("/onboarding", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId");
  if (warehouseId) await getOrgWarehouse(db, organizationId, warehouseId);
  const counts = await loadOnboardingCounts(db, organizationId);
  return c.json({
    steps: evaluateOnboarding(counts),
    sampleAvailable: c.get("role") === "owner" && counts.sku === 0 && counts.bays === 0,
  });
});

const SAMPLE_EXISTS = "Sample data only loads into an empty workspace, and this one already has SKUs or bays.";

/** True once the org has any SKU or any bay: sample data only loads into an empty catalog. */
async function catalogStarted(db: AppDb, organizationId: string): Promise<boolean> {
  const [itemCount, locationCount] = await Promise.all([
    countRows(
      db.select({ n: sql<number>`count(*)` }).from(schema.items).where(eq(schema.items.organizationId, organizationId)),
    ),
    countRows(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.locations)
        .where(eq(schema.locations.organizationId, organizationId)),
    ),
  ]);
  return itemCount > 0 || locationCount > 0;
}

/**
 * `POST /api/onboarding/sample` `{ warehouseId }`: owner only. Writes the sample catalog with the same
 * row shapes as `POST /locations`, `POST /items`, and `POST /boms` (plus recipe steps as the seed writes them).
 */
onboardingRoute.post("/onboarding/sample", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ warehouseId?: string }>().catch(() => ({}) as { warehouseId?: string });
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouse = await getOrgWarehouse(db, organizationId, warehouseId);

  if (await catalogStarted(db, organizationId)) conflict(SAMPLE_EXISTS, "SAMPLE_EXISTS");

  const catalog = buildSampleCatalog();
  const now = Date.now();

  const placed: PlaceableLocation[] = [];
  const locationRows = catalog.locations.map((row) => {
    const placement = suggestPlacement(
      placed,
      { type: row.type, aisle: row.aisle, rack: row.rack, bay: row.bay, level: row.level },
      warehouse,
    );
    placed.push({ type: row.type, ...placement });
    return {
      id: newId(),
      organizationId,
      warehouseId,
      code: row.code,
      name: row.name,
      type: row.type,
      barcode: row.code,
      area: placement.area,
      aisle: placement.aisle,
      rack: placement.rack,
      bay: placement.bay,
      level: placement.level,
      posX: placement.posX,
      posY: placement.posY,
      posZ: placement.posZ,
      sizeX: placement.sizeX,
      sizeY: placement.sizeY,
      sizeZ: placement.sizeZ,
      slotRole: row.slotRole,
    };
  });

  const itemIds = new Map(catalog.items.map((row) => [row.key, newId()]));
  const itemRows = catalog.items.map((row) => ({
    id: itemIds.get(row.key)!,
    organizationId,
    sku: row.sku,
    name: row.name,
    type: row.type,
    barcode: row.sku,
    createdAt: now,
    reorderPoint: row.reorderPoint,
    baselineShipRate: null,
    pickMin: 0,
    trackLot: false,
    trackSerial: false,
    catchWeight: false,
    trackExpiry: false,
    imageUrl: null,
  }));

  const bomId = newId();
  const bomLineRows = catalog.bom.lines.map((line) => ({
    id: newId(),
    bomId,
    itemId: itemIds.get(line.itemKey)!,
    qty: line.qty,
  }));
  const bomStepRows = catalog.bom.steps.map((step) => ({
    id: newId(),
    bomId,
    seq: step.seq,
    title: step.title,
    body: step.body,
    imageUrl: null,
    componentItemId: step.componentKey ? itemIds.get(step.componentKey)! : null,
  }));

  const writes = [
    ...locationRows.map((row) => db.insert(schema.locations).values(row)),
    ...itemRows.map((row) => db.insert(schema.items).values(row)),
    db.insert(schema.boms).values({ id: bomId, organizationId, itemId: itemIds.get(catalog.bom.parentKey)!, createdAt: now }),
    ...bomLineRows.map((row) => db.insert(schema.bomLines).values(row)),
    ...bomStepRows.map((row) => db.insert(schema.bomSteps).values(row)),
  ];
  try {
    await db.batch(writes as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (err) {
    // Two tabs loading at once: the batch is atomic, so the loser writes nothing and hits a unique
    // index, and by now the winner's rows are there. Any other failure (a timeout, an overloaded
    // database) leaves the workspace empty, so it must not be reported as "already has data".
    if (await catalogStarted(db, organizationId).catch(() => false)) conflict(SAMPLE_EXISTS, "SAMPLE_EXISTS");
    console.error("sample data load failed", err);
    throw err;
  }

  return c.json(
    {
      warehouseId,
      bomId,
      locations: locationRows.map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.type })),
      items: itemRows.map((row) => ({ id: row.id, sku: row.sku, name: row.name, type: row.type })),
    },
    201,
  );
});
