import { and, eq, inArray } from "drizzle-orm";
import { uncoveredSuggestions, automationPolicyFromStored, type AutomationPolicy } from "../domain/automation";
import { matchingHoldForMove } from "../domain/holds";
import { planPickReplenishment, type ReplenishSuggestion, type StarvedPickFace } from "../domain/replenishment";
import { docNumber, newId } from "../lib/ids";
import { atpOnHand } from "./allocations";
import { loadOpenHolds } from "./holds";
import { syncDocumentJob } from "./jobs";
import * as schema from "./schema";
import type { AppDb } from "./stock";

export async function loadAutomationPolicy(db: AppDb, organizationId: string): Promise<AutomationPolicy> {
  const [org] = await db
    .select({ automationPolicy: schema.organizations.automationPolicy })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return automationPolicyFromStored(org?.automationPolicy);
}

export type OpenReplenishmentRow = {
  id: string;
  number: string;
  sku: string;
  itemId: string;
  toLocationId: string;
  createdAt: number;
  warehouseId: string;
  status: string;
};

export type ReplenishSnapshot = {
  suggestions: ReplenishSuggestion[];
  starved: StarvedPickFace[];
  open: OpenReplenishmentRow[];
};

export async function loadReplenishSnapshot(
  db: AppDb,
  organizationId: string,
  warehouseId?: string,
): Promise<ReplenishSnapshot> {
  const slotLocations = await db
    .select({
      id: schema.locations.id,
      code: schema.locations.code,
      warehouseId: schema.locations.warehouseId,
      slotRole: schema.locations.slotRole,
      aisle: schema.locations.aisle,
      rack: schema.locations.rack,
    })
    .from(schema.locations)
    .where(
      and(
        eq(schema.locations.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );
  const onHand = await db
    .select({
      locationId: schema.inventoryBalances.locationId,
      itemId: schema.inventoryBalances.itemId,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        warehouseId ? eq(schema.locations.warehouseId, warehouseId) : undefined,
      ),
    );
  const items = await db
    .select({
      id: schema.items.id,
      sku: schema.items.sku,
      name: schema.items.name,
      pickMin: schema.items.pickMin,
    })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));
  const openHolds = await loadOpenHolds(db, organizationId, warehouseId);
  const planned = planPickReplenishment({
    locations: slotLocations,
    onHand: await atpOnHand(db, organizationId, onHand, { warehouseId }),
    items,
  });
  const held = (locationId: string, itemId: string) => matchingHoldForMove(openHolds, locationId, itemId);
  const suggestions = planned.suggestions.filter(
    (row) => !held(row.fromLocationId, row.itemId) && !held(row.toLocationId, row.itemId),
  );
  const starved = planned.starved.filter((row) => !held(row.toLocationId, row.itemId));

  const open = await db
    .select({
      id: schema.replenishments.id,
      number: schema.replenishments.number,
      sku: schema.items.sku,
      itemId: schema.replenishments.itemId,
      toLocationId: schema.replenishments.toLocationId,
      createdAt: schema.replenishments.createdAt,
      warehouseId: schema.replenishments.warehouseId,
      status: schema.replenishments.status,
    })
    .from(schema.replenishments)
    .innerJoin(schema.items, eq(schema.items.id, schema.replenishments.itemId))
    .where(
      and(
        eq(schema.replenishments.organizationId, organizationId),
        inArray(schema.replenishments.status, ["draft", "in_progress"]),
        warehouseId ? eq(schema.replenishments.warehouseId, warehouseId) : undefined,
      ),
    );

  return { suggestions, starved, open };
}

/** Opens a draft replenishment for each uncovered suggestion. A second pass skips faces that already have one. */
export async function queueSuggestedReplenishments(
  db: AppDb,
  organizationId: string,
  warehouseId: string,
  now = Date.now(),
): Promise<number> {
  const snapshot = await loadReplenishSnapshot(db, organizationId, warehouseId);
  const pending = uncoveredSuggestions(snapshot.suggestions, snapshot.open);
  let queued = 0;
  for (const row of pending) {
    const [created] = await db
      .insert(schema.replenishments)
      .values({
        id: newId(),
        organizationId,
        warehouseId: row.warehouseId,
        number: docNumber("RPL"),
        status: "draft",
        itemId: row.itemId,
        qty: row.qty,
        qtyMoved: 0,
        fromLocationId: row.fromLocationId,
        toLocationId: row.toLocationId,
        notes: "Queued automatically because the pick face is below its minimum.",
        createdAt: now,
      })
      .returning();
    await syncDocumentJob(db, {
      organizationId,
      warehouseId: created.warehouseId,
      refType: "replenishment",
      refId: created.id,
      status: created.status,
      number: created.number,
      title: created.notes,
      fromLocationId: created.fromLocationId,
      toLocationId: created.toLocationId,
      itemId: created.itemId,
      qty: created.qty,
      createdAt: created.createdAt,
    });
    queued += 1;
  }
  return queued;
}

export async function runReplenishCron(db: AppDb, now = Date.now()): Promise<{ queued: number }> {
  const orgs = await db
    .select({ id: schema.organizations.id, automationPolicy: schema.organizations.automationPolicy })
    .from(schema.organizations);
  let queued = 0;
  for (const org of orgs) {
    if (automationPolicyFromStored(org.automationPolicy).replenishMode !== "auto_queue") continue;
    const warehouses = await db
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.organizationId, org.id));
    for (const warehouse of warehouses) {
      try {
        queued += await queueSuggestedReplenishments(db, org.id, warehouse.id, now);
      } catch (err) {
        console.error("replenish queue failed", org.id, warehouse.id, err);
      }
    }
  }
  return { queued };
}
