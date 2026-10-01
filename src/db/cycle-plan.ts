import { and, eq, gte, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { docNumber, newId } from "../lib/ids";
import { syncDocumentJob } from "./jobs";
import { isGarageMode } from "../domain/operating-mode";
import {
  ABC_WINDOW_DAYS,
  DAY_MS,
  chooseCountBay,
  classifyAbc,
  cycleCountDue,
  type AbcClass,
} from "../domain/abc";

const CHUNK = 40;

export type PlannedCount = {
  id: string;
  number: string;
  locationId: string;
  items: { itemId: string; abcClass: AbcClass }[];
};

export type CyclePlanResult = {
  created: number;
  skippedOpen: number;
  skippedCadence: number;
  skippedNoStock: number;
  counts: PlannedCount[];
};

export async function createCycleCount(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    locationId: string;
    notes: string | null;
    lines: { itemId: string; systemQty: number }[];
    now?: number;
  },
): Promise<{ id: string; number: string; createdAt: number }> {
  const now = input.now ?? Date.now();
  const id = newId();
  const number = docNumber("CC");
  const lines = input.lines.map((line) => ({
    id: newId(),
    cycleCountId: id,
    itemId: line.itemId,
    systemQty: line.systemQty,
    countedQty: 0,
    entered: 0,
  }));
  const statements: BatchItem<"sqlite">[] = [
    db.insert(schema.cycleCounts).values({
      id,
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      number,
      status: "draft",
      locationId: input.locationId,
      notes: input.notes,
      createdAt: now,
    }),
    ...lines.map((line) => db.insert(schema.cycleCountLines).values(line)),
  ];
  await db.batch(statements as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  await syncDocumentJob(db, {
    organizationId: input.organizationId,
    warehouseId: input.warehouseId,
    refType: "cycleCount",
    refId: id,
    status: "draft",
    number,
    title: input.notes || "Bay count",
    fromLocationId: input.locationId,
    createdAt: now,
  });
  return { id, number, createdAt: now };
}

async function batchUpdates(db: AppDb, statements: BatchItem<"sqlite">[]) {
  for (let i = 0; i < statements.length; i += CHUNK) {
    const slice = statements.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    await db.batch(slice as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
}

/** Opens bay counts for items whose class says they are due. A second run does not duplicate them. */
export async function planCycleCounts(
  db: AppDb,
  input: { organizationId: string; warehouseId: string; now?: number },
): Promise<CyclePlanResult> {
  const now = input.now ?? Date.now();
  const since = now - ABC_WINDOW_DAYS * DAY_MS;
  const catalog = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(eq(schema.items.organizationId, input.organizationId));
  const fromLoc = alias(schema.locations, "abc_from_loc");
  const toLoc = alias(schema.locations, "abc_to_loc");
  const moves = await db
    .select({
      itemId: schema.inventoryMovements.itemId,
      qty: schema.inventoryMovements.qty,
      fromWarehouseId: fromLoc.warehouseId,
      toWarehouseId: toLoc.warehouseId,
    })
    .from(schema.inventoryMovements)
    .leftJoin(fromLoc, eq(fromLoc.id, schema.inventoryMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, schema.inventoryMovements.toLocationId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, input.organizationId),
        gte(schema.inventoryMovements.createdAt, since),
        inArray(schema.inventoryMovements.type, ["pick", "ship"]),
      ),
    );
  const units = new Map<string, number>();
  for (const row of moves) {
    if (row.fromWarehouseId !== input.warehouseId && row.toWarehouseId !== input.warehouseId) continue;
    units.set(row.itemId, (units.get(row.itemId) ?? 0) + Math.max(0, row.qty));
  }
  const classes = classifyAbc(catalog.map((item) => ({ itemId: item.id, units: units.get(item.id) ?? 0 })));
  const classWrites: BatchItem<"sqlite">[] = catalog.map((item) =>
    db
      .update(schema.items)
      .set({
        abcClass: classes.get(item.id) ?? "C",
        abcUnits: units.get(item.id) ?? 0,
        abcClassifiedAt: now,
      })
      .where(eq(schema.items.id, item.id)),
  );
  await batchUpdates(db, classWrites);

  const openLines = await db
    .select({ itemId: schema.cycleCountLines.itemId, locationId: schema.cycleCounts.locationId, countId: schema.cycleCounts.id })
    .from(schema.cycleCountLines)
    .innerJoin(schema.cycleCounts, eq(schema.cycleCounts.id, schema.cycleCountLines.cycleCountId))
    .where(
      and(
        eq(schema.cycleCounts.organizationId, input.organizationId),
        eq(schema.cycleCounts.warehouseId, input.warehouseId),
        inArray(schema.cycleCounts.status, ["draft", "counting"]),
      ),
    );
  const openItems = new Set(openLines.map((row) => row.itemId));
  const openByLocation = new Map<string, string>();
  for (const row of openLines) openByLocation.set(row.locationId, row.countId);

  const posted = await db
    .select({ itemId: schema.cycleCountLines.itemId, postedAt: schema.cycleCounts.postedAt })
    .from(schema.cycleCountLines)
    .innerJoin(schema.cycleCounts, eq(schema.cycleCounts.id, schema.cycleCountLines.cycleCountId))
    .where(
      and(
        eq(schema.cycleCounts.organizationId, input.organizationId),
        eq(schema.cycleCounts.warehouseId, input.warehouseId),
        eq(schema.cycleCounts.status, "posted"),
      ),
    );
  const lastPosted = new Map<string, number>();
  for (const row of posted) {
    if (row.postedAt == null) continue;
    lastPosted.set(row.itemId, Math.max(lastPosted.get(row.itemId) ?? 0, row.postedAt));
  }

  const balances = await db
    .select({
      itemId: schema.inventoryBalances.itemId,
      locationId: schema.inventoryBalances.locationId,
      qty: schema.inventoryBalances.qty,
      slotRole: schema.locations.slotRole,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, input.organizationId),
        eq(schema.locations.warehouseId, input.warehouseId),
      ),
    );
  const baysByItem = new Map<string, { locationId: string; qty: number; slotRole: string | null }[]>();
  for (const row of balances) {
    const list = baysByItem.get(row.itemId) ?? [];
    list.push({ locationId: row.locationId, qty: row.qty, slotRole: row.slotRole });
    baysByItem.set(row.itemId, list);
  }

  let skippedOpen = 0;
  let skippedCadence = 0;
  let skippedNoStock = 0;
  const dueByLocation = new Map<string, { itemId: string; qty: number; abcClass: AbcClass }[]>();
  for (const item of catalog) {
    const abcClass = classes.get(item.id) ?? "C";
    const open = openItems.has(item.id);
    if (open) {
      skippedOpen += 1;
      continue;
    }
    if (!cycleCountDue({ abcClass, lastPostedAt: lastPosted.get(item.id) ?? null, open: false, now })) {
      skippedCadence += 1;
      continue;
    }
    const locationId = chooseCountBay(baysByItem.get(item.id) ?? []);
    if (!locationId) {
      skippedNoStock += 1;
      continue;
    }
    const qty = (baysByItem.get(item.id) ?? []).find((bay) => bay.locationId === locationId)?.qty ?? 0;
    const list = dueByLocation.get(locationId) ?? [];
    list.push({ itemId: item.id, qty, abcClass });
    dueByLocation.set(locationId, list);
  }

  const counts: PlannedCount[] = [];
  for (const [locationId, lines] of dueByLocation) {
    const classesHere = [...new Set(lines.map((line) => line.abcClass))].sort();
    const notes = `ABC ${classesHere.join("/")}`;
    const existingId = openByLocation.get(locationId);
    if (existingId) {
      const inserts = lines.map((line) =>
        db.insert(schema.cycleCountLines).values({
          id: newId(),
          cycleCountId: existingId,
          itemId: line.itemId,
          systemQty: line.qty,
          countedQty: 0,
          entered: 0,
        }),
      );
      await batchUpdates(db, inserts);
      const [row] = await db
        .select({ number: schema.cycleCounts.number })
        .from(schema.cycleCounts)
        .where(eq(schema.cycleCounts.id, existingId))
        .limit(1);
      counts.push({
        id: existingId,
        number: row?.number ?? existingId,
        locationId,
        items: lines.map((line) => ({ itemId: line.itemId, abcClass: line.abcClass })),
      });
      continue;
    }
    const created = await createCycleCount(db, {
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      locationId,
      notes,
      lines: lines.map((line) => ({ itemId: line.itemId, systemQty: line.qty })),
      now,
    });
    counts.push({
      id: created.id,
      number: created.number,
      locationId,
      items: lines.map((line) => ({ itemId: line.itemId, abcClass: line.abcClass })),
    });
  }

  return {
    created: counts.length,
    skippedOpen,
    skippedCadence,
    skippedNoStock,
    counts,
  };
}

/** Manufacturer buildings only. A garage org is skipped. Failures in one building do not stop the next. */
export async function planAllCycleCounts(db: AppDb, now = Date.now()): Promise<{ planned: number; failed: number }> {
  const orgs = await db
    .select({ id: schema.organizations.id, operatingMode: schema.organizations.operatingMode })
    .from(schema.organizations);
  let planned = 0;
  let failed = 0;
  for (const org of orgs) {
    if (isGarageMode(org.operatingMode)) continue;
    const warehouses = await db
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.organizationId, org.id));
    for (const warehouse of warehouses) {
      try {
        await planCycleCounts(db, { organizationId: org.id, warehouseId: warehouse.id, now });
        planned += 1;
      } catch (err) {
        failed += 1;
        console.error("cycle count plan failed", org.id, warehouse.id, err);
      }
    }
  }
  return { planned, failed };
}
