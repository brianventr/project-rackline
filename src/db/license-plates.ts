import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { badRequest, conflict, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { isUniqueViolation } from "../lib/db-errors";
import { balanceKey, type MovementDraft } from "../domain/inventory";
import {
  applyPlateOps,
  assertPlateCan,
  isPlateStatus,
  lotKey,
  nextPlateCode,
  normalizePlateCode,
  plateUnits,
  serialKey,
  settlePlates,
  type Plate,
  type PlateNames,
  type PlateOp,
  type PlateType,
} from "../domain/license-plates";

const ID_CHUNK = 90;

function chunked<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += ID_CHUNK) out.push(list.slice(i, i + ID_CHUNK));
  return out;
}

export type PlateRow = Plate & { type: PlateType; warehouseId: string; createdAt: number; updatedAt: number };

/** Plates by id, or every plate still in the given bays, each with its lines oldest first. */
export async function loadPlates(
  db: AppDb,
  organizationId: string,
  where: { ids?: string[]; locationIds?: string[] },
): Promise<PlateRow[]> {
  const rows: (typeof schema.licensePlates.$inferSelect)[] = [];
  for (const ids of chunked([...new Set(where.ids ?? [])])) {
    rows.push(
      ...(await db
        .select()
        .from(schema.licensePlates)
        .where(and(eq(schema.licensePlates.organizationId, organizationId), inArray(schema.licensePlates.id, ids)))),
    );
  }
  for (const ids of chunked([...new Set(where.locationIds ?? [])])) {
    rows.push(
      ...(await db
        .select()
        .from(schema.licensePlates)
        .where(
          and(
            eq(schema.licensePlates.organizationId, organizationId),
            inArray(schema.licensePlates.locationId, ids),
            ne(schema.licensePlates.status, "shipped"),
          ),
        )),
    );
  }
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  const lines = new Map<string, Plate["lines"]>();
  for (const ids of chunked(unique.map((row) => row.id))) {
    const found = await db
      .select()
      .from(schema.licensePlateLines)
      .where(
        and(eq(schema.licensePlateLines.organizationId, organizationId), inArray(schema.licensePlateLines.plateId, ids)),
      )
      .orderBy(asc(schema.licensePlateLines.createdAt), sql`rowid`);
    for (const line of found) {
      const list = lines.get(line.plateId) ?? [];
      list.push({ id: line.id, itemId: line.itemId, qty: line.qty, lotCode: line.lotCode, serial: line.serial });
      lines.set(line.plateId, list);
    }
  }
  return unique.map((row) => ({
    id: row.id,
    code: row.code,
    type: row.type as PlateType,
    status: isPlateStatus(row.status) ? row.status : "open",
    locationId: row.locationId,
    warehouseId: row.warehouseId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lines: lines.get(row.id) ?? [],
  }));
}

export async function loadPlateByCode(db: AppDb, organizationId: string, code: string): Promise<PlateRow | null> {
  const [row] = await db
    .select({ id: schema.licensePlates.id })
    .from(schema.licensePlates)
    .where(and(eq(schema.licensePlates.organizationId, organizationId), eq(schema.licensePlates.code, code)))
    .limit(1);
  if (!row) return null;
  return (await loadPlates(db, organizationId, { ids: [row.id] }))[0] ?? null;
}

/** The plate a pick scanned, once it is known to be in the pick's bay and open to picking. */
export async function plateForPick(
  db: AppDb,
  organizationId: string,
  code: string,
  bay: { id: string; code: string },
): Promise<PlateRow> {
  const plate = await loadPlateByCode(db, organizationId, code);
  if (!plate) notFound("No plate matches that code");
  assertPlateCan(plate, "pick");
  if (plate.locationId !== bay.id) conflict(`${plate.code} is not in ${bay.code}. Scan the bay it is in, or pick loose.`);
  return plate;
}

/**
 * The plate a receive goes onto, or null without one. A plate holding stock must already be in the
 * receiving bay; an empty one moves there with the receive.
 */
export async function plateForReceive(
  db: AppDb,
  organizationId: string,
  raw: string | null | undefined,
  bay: { id: string; code: string },
): Promise<PlateRow | null> {
  if (!raw?.trim()) return null;
  const code = normalizePlateCode(raw);
  if (!code) badRequest("A plate code looks like LP-000123");
  const plate = await loadPlateByCode(db, organizationId, code);
  if (!plate) notFound("No plate matches that code");
  assertPlateCan(plate, "receive");
  if (plate.locationId && plate.locationId !== bay.id && plate.lines.length > 0) {
    const [where] = await db
      .select({ code: schema.locations.code })
      .from(schema.locations)
      .where(eq(schema.locations.id, plate.locationId))
      .limit(1);
    const there = where?.code ?? "another bay";
    conflict(`${plate.code} is in ${there} with stock on it. Receive into ${there}, or use an empty plate.`);
  }
  return plate;
}

async function balancesAt(db: AppDb, organizationId: string, locationIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const ids of chunked([...new Set(locationIds)])) {
    const rows = await db
      .select({
        locationId: schema.inventoryBalances.locationId,
        itemId: schema.inventoryBalances.itemId,
        qty: schema.inventoryBalances.qty,
      })
      .from(schema.inventoryBalances)
      .where(
        and(eq(schema.inventoryBalances.organizationId, organizationId), inArray(schema.inventoryBalances.locationId, ids)),
      );
    for (const row of rows) map.set(balanceKey(row.locationId, row.itemId), row.qty);
  }
  return map;
}

async function lotsAt(db: AppDb, organizationId: string, locationIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const ids of chunked([...new Set(locationIds)])) {
    const rows = await db
      .select({
        locationId: schema.lotBalances.locationId,
        itemId: schema.lotBalances.itemId,
        lotCode: schema.lotBalances.lotCode,
        qty: schema.lotBalances.qty,
      })
      .from(schema.lotBalances)
      .where(and(eq(schema.lotBalances.organizationId, organizationId), inArray(schema.lotBalances.locationId, ids)));
    for (const row of rows) map.set(lotKey(row.locationId, row.itemId, row.lotCode), row.qty);
  }
  return map;
}

async function plateNames(db: AppDb, organizationId: string, plates: Plate[]): Promise<PlateNames> {
  const itemIds = [...new Set(plates.flatMap((plate) => plate.lines.map((line) => line.itemId)))];
  const locationIds = [...new Set(plates.flatMap((plate) => (plate.locationId ? [plate.locationId] : [])))];
  const skus = new Map<string, string>();
  const bays = new Map<string, string>();
  for (const ids of chunked(itemIds)) {
    const rows = await db
      .select({ id: schema.items.id, sku: schema.items.sku })
      .from(schema.items)
      .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, ids)));
    for (const row of rows) skus.set(row.id, row.sku);
  }
  for (const ids of chunked(locationIds)) {
    const rows = await db
      .select({ id: schema.locations.id, code: schema.locations.code })
      .from(schema.locations)
      .where(and(eq(schema.locations.organizationId, organizationId), inArray(schema.locations.id, ids)));
    for (const row of rows) bays.set(row.id, row.code);
  }
  return { skus, bays };
}

function holdingLines(plates: Plate[]): { locationId: string; itemId: string; lotCode: string | null }[] {
  return plates.flatMap((plate) =>
    plate.locationId && plate.status !== "shipped"
      ? plate.lines.map((line) => ({ locationId: plate.locationId!, itemId: line.itemId, lotCode: line.lotCode }))
      : [],
  );
}

/**
 * Plate writes for a stock plan: `ops` applied, then the plates at every bay the plan takes stock
 * from reconciled with the balances it leaves, so they never claim more than a bay holds.
 * `movements` are the expanded drafts, with the lots and serials the plan really moves.
 */
export async function plateStatements(
  db: AppDb,
  input: {
    organizationId: string;
    now: number;
    movements: MovementDraft[];
    /** The final qty of every balance the plan writes, by `location:item`. */
    balances: Map<string, number>;
    ops?: PlateOp[];
  },
): Promise<BatchItem<"sqlite">[]> {
  const ops = input.ops ?? [];
  const stock = input.movements.filter((movement) => movement.type !== "ship");
  const takenFrom = stock.flatMap((movement) => (movement.fromLocationId ? [movement.fromLocationId] : []));
  if (ops.length === 0 && takenFrom.length === 0) return [];

  const named = ops.length ? await loadPlates(db, input.organizationId, { ids: ops.map((op) => op.plateId) }) : [];
  const relocatedTo = ops.flatMap((op) => (op.kind === "relocate" ? [op.locationId] : []));
  const bays = [...takenFrom, ...relocatedTo, ...named.flatMap((plate) => (plate.locationId ? [plate.locationId] : []))];
  const nearby = await loadPlates(db, input.organizationId, { locationIds: bays });
  const plates = [...new Map([...named, ...nearby].map((plate) => [plate.id, plate])).values()];
  if (plates.length === 0 && ops.length === 0) return [];

  const applied = applyPlateOps(plates, ops);
  const lines = holdingLines([...plates, ...applied]);
  const balances = await balancesAt(
    db,
    input.organizationId,
    lines.map((line) => line.locationId),
  );
  for (const [key, qty] of input.balances) balances.set(key, qty);

  let lots: Map<string, number> | undefined;
  if (lines.some((line) => line.lotCode)) {
    lots = await lotsAt(
      db,
      input.organizationId,
      lines.filter((line) => line.lotCode).map((line) => line.locationId),
    );
    for (const movement of stock) {
      const lotCode = movement.lotCode?.trim().toUpperCase();
      if (!lotCode) continue;
      if (movement.fromLocationId) {
        const key = lotKey(movement.fromLocationId, movement.itemId, lotCode);
        lots.set(key, (lots.get(key) ?? 0) - movement.qty);
      }
      if (movement.toLocationId) {
        const key = lotKey(movement.toLocationId, movement.itemId, lotCode);
        lots.set(key, (lots.get(key) ?? 0) + movement.qty);
      }
    }
  }

  const serials = new Map<string, string | null>();
  for (const movement of stock) {
    for (const serial of movement.serials ?? []) {
      serials.set(serialKey(movement.itemId, serial.trim().toUpperCase()), movement.toLocationId ?? null);
    }
  }
  const pickedFrom = new Set(
    stock.flatMap((movement) => (movement.type === "pick" && movement.fromLocationId ? [movement.fromLocationId] : [])),
  );
  const names = ops.some((op) => op.kind === "add" || op.kind === "relocate")
    ? await plateNames(db, input.organizationId, applied)
    : {};
  const settled = settlePlates(plates, ops, { balances, lots, serials, pickedFrom }, names);

  const warehouseOf = new Map<string, string>();
  for (const ids of chunked([...new Set(relocatedTo)])) {
    const rows = await db
      .select({ id: schema.locations.id, warehouseId: schema.locations.warehouseId })
      .from(schema.locations)
      .where(and(eq(schema.locations.organizationId, input.organizationId), inArray(schema.locations.id, ids)));
    for (const row of rows) warehouseOf.set(row.id, row.warehouseId);
  }

  const statements: BatchItem<"sqlite">[] = [];
  settled.forEach((after, index) => {
    const before = plates[index]!;
    const kept = new Map(before.lines.map((line) => [line.id!, line]));
    const stillThere = new Set<string>();
    let changed = before.status !== after.status || before.locationId !== after.locationId;
    for (const line of after.lines) {
      const prior = line.id ? kept.get(line.id) : undefined;
      if (prior) {
        stillThere.add(prior.id!);
        if (prior.qty === line.qty) continue;
        statements.push(
          db
            .update(schema.licensePlateLines)
            .set({ qty: line.qty, updatedAt: input.now })
            .where(eq(schema.licensePlateLines.id, prior.id!)),
        );
      } else {
        statements.push(
          db.insert(schema.licensePlateLines).values({
            id: newId(),
            organizationId: input.organizationId,
            plateId: after.id,
            itemId: line.itemId,
            qty: line.qty,
            lotCode: line.lotCode,
            serial: line.serial,
            createdAt: input.now,
            updatedAt: input.now,
          }),
        );
      }
      changed = true;
    }
    const dropped = before.lines.flatMap((line) => (line.id && !stillThere.has(line.id) ? [line.id] : []));
    for (const ids of chunked(dropped)) {
      statements.push(db.delete(schema.licensePlateLines).where(inArray(schema.licensePlateLines.id, ids)));
      changed = true;
    }
    if (!changed) return;
    const warehouseId = after.locationId ? warehouseOf.get(after.locationId) : undefined;
    statements.push(
      db
        .update(schema.licensePlates)
        .set({
          status: after.status,
          locationId: after.locationId,
          ...(warehouseId ? { warehouseId } : {}),
          updatedAt: input.now,
        })
        .where(eq(schema.licensePlates.id, after.id)),
    );
  });
  return statements;
}

/** Plate ops that move no stock: building from loose units, closing, reopening, breaking. */
export async function savePlateOps(db: AppDb, input: { organizationId: string; now: number; ops: PlateOp[] }): Promise<void> {
  const statements = await plateStatements(db, { ...input, movements: [], balances: new Map() });
  if (statements.length === 0) return;
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

async function highestPlateNumber(db: AppDb, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ top: sql<number | null>`max(cast(substr(${schema.licensePlates.code}, 4) as integer))` })
    .from(schema.licensePlates)
    .where(eq(schema.licensePlates.organizationId, organizationId));
  return row?.top ?? 0;
}

/** A new empty plate at a bay. Without a code it takes the next LP- number. */
export async function createPlate(
  db: AppDb,
  input: {
    organizationId: string;
    warehouseId: string;
    locationId: string;
    type: PlateType;
    code?: string | null;
    createdBy: string;
    now: number;
  },
): Promise<string> {
  if (input.code) {
    const taken = await loadPlateByCode(db, input.organizationId, input.code);
    if (taken) conflict(`${input.code} is already in use. Scan it to open that plate.`);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = newId();
    const code = input.code ?? nextPlateCode(await highestPlateNumber(db, input.organizationId));
    try {
      await db.insert(schema.licensePlates).values({
        id,
        organizationId: input.organizationId,
        warehouseId: input.warehouseId,
        code,
        type: input.type,
        locationId: input.locationId,
        status: "open",
        createdBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
      });
      return id;
    } catch (err) {
      if (input.code || !isUniqueViolation(err)) throw err;
    }
  }
  conflict("Another plate took that number. Try again.");
}

export type PlateView = Omit<PlateRow, "lines"> & {
  locationCode: string | null;
  locationName: string | null;
  units: number;
  lines: {
    id: string;
    itemId: string;
    sku: string;
    itemName: string;
    imageUrl: string | null;
    qty: number;
    lotCode: string | null;
    serial: string | null;
  }[];
};

/** Plates with their bay and each line's SKU, for the API. */
export async function plateViews(db: AppDb, organizationId: string, plates: PlateRow[]): Promise<PlateView[]> {
  const itemIds = [...new Set(plates.flatMap((plate) => plate.lines.map((line) => line.itemId)))];
  const locationIds = [...new Set(plates.flatMap((plate) => (plate.locationId ? [plate.locationId] : [])))];
  const items = new Map<string, { sku: string; name: string; imageUrl: string | null }>();
  for (const ids of chunked(itemIds)) {
    const rows = await db
      .select({ id: schema.items.id, sku: schema.items.sku, name: schema.items.name, imageUrl: schema.items.imageUrl })
      .from(schema.items)
      .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, ids)));
    for (const row of rows) items.set(row.id, row);
  }
  const bays = new Map<string, { code: string; name: string | null }>();
  for (const ids of chunked(locationIds)) {
    const rows = await db
      .select({ id: schema.locations.id, code: schema.locations.code, name: schema.locations.name })
      .from(schema.locations)
      .where(and(eq(schema.locations.organizationId, organizationId), inArray(schema.locations.id, ids)));
    for (const row of rows) bays.set(row.id, row);
  }
  return plates.map((plate) => {
    const bay = plate.locationId ? bays.get(plate.locationId) : undefined;
    return {
      ...plate,
      locationCode: bay?.code ?? null,
      locationName: bay?.name ?? null,
      units: plateUnits(plate),
      lines: plate.lines.map((line) => {
        const item = items.get(line.itemId);
        return {
          id: line.id!,
          itemId: line.itemId,
          sku: item?.sku ?? "Unknown SKU",
          itemName: item?.name ?? "",
          imageUrl: item?.imageUrl ?? null,
          qty: line.qty,
          lotCode: line.lotCode,
          serial: line.serial,
        };
      }),
    };
  });
}
