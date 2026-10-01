import { Hono } from "hono";
import { and, desc, eq, gt, inArray, ne } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, notFound, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation, getOrgLocationByScan } from "../lib/org";
import { capacityOverride } from "../lib/capacity-override";
import { itemScanValue, parseScan } from "../domain/barcodes";
import { chainPlans, planMove } from "../domain/inventory";
import { allocateFifoLots, parseSerialList } from "../domain/lots";
import { isExpiredLot } from "../domain/expiry";
import {
  assertPlateCan,
  isPlateStatus,
  looseLots,
  looseSerials,
  normalizePlateCode,
  parsePlateType,
  plateMoveLines,
  PlateOverLooseError,
  withPlateShare,
  type PlateOp,
} from "../domain/license-plates";
import { createPlate, loadPlateByCode, loadPlates, plateViews, savePlateOps, type PlateRow } from "../db/license-plates";
import { loadBalanceMap, persistStockPlan, qtyMap, type AppDb } from "../db/stock";
import { resolveItemScan } from "../db/item-packs";
import { completeMatchingSuggestionJobs, guardMatchingSuggestionJobs } from "../db/jobs";

export const platesRoute = new Hono<AppEnv>();

const LIST_LIMIT = 500;

async function plateByRef(db: AppDb, organizationId: string, ref: string): Promise<PlateRow> {
  const code = normalizePlateCode(ref);
  const plate = code
    ? await loadPlateByCode(db, organizationId, code)
    : ((await loadPlates(db, organizationId, { ids: [ref] }))[0] ?? null);
  if (!plate) notFound("No plate matches that code");
  return plate;
}

async function viewOf(db: AppDb, organizationId: string, plateId: string) {
  const plates = await loadPlates(db, organizationId, { ids: [plateId] });
  const [view] = await plateViews(db, organizationId, plates);
  if (!view) notFound("No plate matches that code");
  return view;
}

async function locationFrom(
  db: AppDb,
  organizationId: string,
  locationId: string | undefined,
  barcode: string | undefined,
  missing: string,
) {
  if (locationId?.trim()) return getOrgLocation(db, organizationId, locationId.trim());
  if (barcode?.trim()) {
    const location = await getOrgLocationByScan(db, organizationId, parseScan(barcode).value);
    if (!location) notFound("No location matches that barcode");
    return location;
  }
  badRequest(missing);
}

function requireBay(plate: PlateRow): string {
  if (!plate.locationId) badRequest(`${plate.code} is not in a bay`);
  return plate.locationId;
}

/** What the plate's bay holds of each item, and how much of it is loose. */
async function bayStock(db: AppDb, organizationId: string, locationId: string) {
  const rows = await db
    .select({
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      imageUrl: schema.items.imageUrl,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        eq(schema.inventoryBalances.locationId, locationId),
        gt(schema.inventoryBalances.qty, 0),
      ),
    );
  return withPlateShare(rows, await loadPlates(db, organizationId, { locationIds: [locationId] }), locationId);
}

platesRoute.get("/plates", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const locationId = c.req.query("locationId")?.trim();
  const warehouseId = c.req.query("warehouseId")?.trim();
  const status = c.req.query("status")?.trim();
  if (status && status !== "all" && !isPlateStatus(status)) badRequest("Status must be open, closed, shipped, or all");
  const conditions = [eq(schema.licensePlates.organizationId, organizationId)];
  if (locationId) conditions.push(eq(schema.licensePlates.locationId, locationId));
  if (warehouseId) conditions.push(eq(schema.licensePlates.warehouseId, warehouseId));
  if (status && status !== "all") conditions.push(eq(schema.licensePlates.status, status));
  if (!status) conditions.push(ne(schema.licensePlates.status, "shipped"));
  const rows = await db
    .select({ id: schema.licensePlates.id })
    .from(schema.licensePlates)
    .where(and(...conditions))
    .orderBy(desc(schema.licensePlates.updatedAt))
    .limit(LIST_LIMIT);
  const order = new Map(rows.map((row, index) => [row.id, index]));
  const plates = (await loadPlates(db, organizationId, { ids: rows.map((row) => row.id) })).sort(
    (a, b) => order.get(a.id)! - order.get(b.id)!,
  );
  return c.json(await plateViews(db, organizationId, plates));
});

platesRoute.post("/plates", async (c) => {
  const body = await c.req.json<{ type?: string; locationId?: string; locationBarcode?: string; code?: string | null }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const location = await locationFrom(db, organizationId, body.locationId, body.locationBarcode, "Scan or choose the bay the plate is in");
  const code = body.code?.trim() ? normalizePlateCode(body.code) : null;
  if (body.code?.trim() && !code) badRequest("A plate code looks like LP-000123");
  const id = await createPlate(db, {
    organizationId,
    warehouseId: location.warehouseId,
    locationId: location.id,
    type: parsePlateType(body.type),
    code,
    createdBy: user.id,
    now: Date.now(),
  });
  return c.json(await viewOf(db, organizationId, id), 201);
});

platesRoute.get("/plates/:ref", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const plate = await plateByRef(db, organizationId, c.req.param("ref"));
  const view = await viewOf(db, organizationId, plate.id);
  return c.json({ ...view, bayStock: plate.locationId ? await bayStock(db, organizationId, plate.locationId) : [] });
});

type BuildBody = {
  itemId?: string;
  scan?: string;
  qty?: number | string | null;
  lotCode?: string | null;
  serials?: string[] | string | null;
};

/** Build: put loose stock already in the plate's bay onto the plate. No stock moves. */
platesRoute.post("/plates/:ref/lines", async (c) => {
  const body = await c.req.json<BuildBody>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const plate = await plateByRef(db, organizationId, c.req.param("ref"));
  assertPlateCan(plate, "build");
  const bayId = requireBay(plate);
  const bay = await getOrgLocation(db, organizationId, bayId);

  let item: typeof schema.items.$inferSelect;
  let perUnit = 1;
  let lotCode = body.lotCode?.trim() || null;
  let serials = parseSerialList(body.serials);
  if (body.itemId?.trim()) {
    item = await getOrgItem(db, organizationId, body.itemId.trim());
  } else {
    const parsed = parseScan(requireString(body.scan, "scan"));
    if (parsed.kind === "serial" && !itemScanValue(parsed)) {
      const [row] = await db
        .select({ itemId: schema.serials.itemId })
        .from(schema.serials)
        .where(
          and(
            eq(schema.serials.organizationId, organizationId),
            eq(schema.serials.serialCode, parsed.value),
            eq(schema.serials.status, "on_hand"),
          ),
        )
        .limit(1);
      if (!row) notFound(`Serial ${parsed.value} is not on hand`);
      item = await getOrgItem(db, organizationId, row.itemId);
      serials = [parsed.value];
    } else {
      const code = itemScanValue(parsed);
      if (!code) badRequest("Scan an item, case, or serial barcode to put it on the plate");
      const scanned = await resolveItemScan(db, organizationId, code);
      if (!scanned) notFound("No item matches that barcode");
      item = scanned.item;
      perUnit = scanned.pack?.qty ?? 1;
      lotCode ??= parsed.gs1?.lot ?? null;
      if (parsed.gs1?.serial && serials.length === 0) serials = [parsed.gs1.serial.toUpperCase()];
    }
  }

  const count = body.qty == null || body.qty === "" ? (serials.length || 1) : Number(body.qty);
  if (!Number.isInteger(count) || count <= 0) badRequest("Qty must be a whole number of 1 or more");
  const qty = serials.length ? count : count * perUnit;
  if (serials.length && !item.trackSerial) badRequest(`${item.sku} does not track serial numbers`);
  if (!item.trackLot) lotCode = null;
  if (item.trackLot && item.trackSerial && !lotCode) badRequest(`${item.sku} tracks lots and serials, so enter the lot too`);

  const neighbours = await loadPlates(db, organizationId, { locationIds: [bayId] });
  const [balance] = await db
    .select({ qty: schema.inventoryBalances.qty })
    .from(schema.inventoryBalances)
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        eq(schema.inventoryBalances.locationId, bayId),
        eq(schema.inventoryBalances.itemId, item.id),
      ),
    )
    .limit(1);
  const onHand = balance?.qty ?? 0;
  const tooFew = (loose: number) =>
    new PlateOverLooseError(plate.code, item.sku, bay.code, onHand, loose, qty, lotCode);

  const ops: PlateOp[] = [];
  if (item.trackSerial) {
    const onHandSerials = (
      await db
        .select({ serialCode: schema.serials.serialCode })
        .from(schema.serials)
        .where(
          and(
            eq(schema.serials.organizationId, organizationId),
            eq(schema.serials.itemId, item.id),
            eq(schema.serials.locationId, bayId),
            eq(schema.serials.status, "on_hand"),
          ),
        )
    ).map((row) => row.serialCode);
    if (serials.length) {
      const missing = serials.find((serial) => !onHandSerials.includes(serial));
      if (missing) badRequest(`Serial ${missing} is not in ${bay.code}`);
    } else {
      const loose = looseSerials(onHandSerials, neighbours, item.id).sort((a, b) => a.localeCompare(b));
      if (loose.length < qty) throw tooFew(loose.length);
      serials = loose.slice(0, qty);
    }
  }
  if (item.trackLot && !lotCode) {
    const lots = await db
      .select({ lotCode: schema.lotBalances.lotCode, qty: schema.lotBalances.qty, expiresOn: schema.lotBalances.expiresOn })
      .from(schema.lotBalances)
      .where(
        and(
          eq(schema.lotBalances.organizationId, organizationId),
          eq(schema.lotBalances.locationId, bayId),
          eq(schema.lotBalances.itemId, item.id),
          gt(schema.lotBalances.qty, 0),
        ),
      );
    const loose = looseLots(lots, neighbours, bayId, item.id);
    const live = loose.filter((row) => row.qty > 0 && !isExpiredLot(row.expiresOn)).reduce((sum, row) => sum + row.qty, 0);
    if (live < qty) throw tooFew(live);
    for (const piece of allocateFifoLots(loose, qty, item.sku)) {
      ops.push({ kind: "add", plateId: plate.id, itemId: item.id, qty: piece.qty, lotCode: piece.lotCode });
    }
  } else {
    ops.push({ kind: "add", plateId: plate.id, itemId: item.id, qty, lotCode, serials: serials.length ? serials : null });
  }

  await savePlateOps(db, { organizationId, now: Date.now(), ops });
  return c.json(await viewOf(db, organizationId, plate.id));
});

/** Move: every line goes through a normal ledger move, so holds, ATP, and bin capacity all apply. */
platesRoute.post("/plates/:ref/move", async (c) => {
  const body = await c.req.json<{ toLocationId?: string; toBarcode?: string; overrideCapacity?: boolean }>();
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const override = capacityOverride(c, body.overrideCapacity);
  const plate = await plateByRef(db, organizationId, c.req.param("ref"));
  assertPlateCan(plate, "move");
  const fromId = requireBay(plate);
  const to = await locationFrom(db, organizationId, body.toLocationId, body.toBarcode, "Scan or choose where the plate is going");
  if (to.id === fromId) badRequest(`${plate.code} is already in ${to.code}`);
  const now = Date.now();
  const relocate: PlateOp = { kind: "relocate", plateId: plate.id, locationId: to.id };
  const moves = plateMoveLines(plate.lines);
  if (moves.length === 0) {
    await savePlateOps(db, { organizationId, now, ops: [relocate] });
    return c.json(await viewOf(db, organizationId, plate.id));
  }

  const itemIds = [...new Set(moves.map((line) => line.itemId))];
  const items = await db
    .select({ id: schema.items.id, sku: schema.items.sku })
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, itemIds)));
  const skuOf = new Map(items.map((row) => [row.id, row.sku]));
  const from = await getOrgLocation(db, organizationId, fromId);
  await guardMatchingSuggestionJobs(db, {
    organizationId,
    warehouseId: from.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    fromLocationId: fromId,
    toLocationId: to.id,
    itemIds,
  });
  const loaded = await loadBalanceMap(
    db,
    organizationId,
    itemIds.flatMap((itemId) => [
      { locationId: fromId, itemId },
      { locationId: to.id, itemId },
    ]),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    moves.map(
      (line) => (balances) =>
        planMove({
          itemId: line.itemId,
          sku: skuOf.get(line.itemId) ?? line.itemId,
          fromLocationId: fromId,
          toLocationId: to.id,
          qty: line.qty,
          refId: plate.id,
          refType: "plate",
          balances,
          lotCode: line.lotCode,
          serials: line.serials,
        }),
    ),
  );
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    capacityOverride: override,
    plateOps: [relocate],
  });
  await completeMatchingSuggestionJobs(db, {
    organizationId,
    warehouseId: from.warehouseId,
    fromLocationId: fromId,
    toLocationId: to.id,
    itemIds,
  });
  return c.json(await viewOf(db, organizationId, plate.id));
});

/** Break: everything on the plate becomes loose stock in its bay, and the plate is open and empty. */
platesRoute.post("/plates/:ref/break", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const plate = await plateByRef(db, organizationId, c.req.param("ref"));
  assertPlateCan(plate, "break");
  const ops: PlateOp[] = [{ kind: "empty", plateId: plate.id }];
  if (plate.status !== "open") ops.push({ kind: "status", plateId: plate.id, status: "open" });
  await savePlateOps(db, { organizationId, now: Date.now(), ops });
  return c.json(await viewOf(db, organizationId, plate.id));
});

platesRoute.post("/plates/:ref/close", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const plate = await plateByRef(db, organizationId, c.req.param("ref"));
  assertPlateCan(plate, "close");
  if (plate.lines.length === 0) badRequest(`${plate.code} is empty. Put stock on it before closing it.`);
  await savePlateOps(db, { organizationId, now: Date.now(), ops: [{ kind: "status", plateId: plate.id, status: "closed" }] });
  return c.json(await viewOf(db, organizationId, plate.id));
});

platesRoute.post("/plates/:ref/reopen", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const plate = await plateByRef(db, organizationId, c.req.param("ref"));
  assertPlateCan(plate, "reopen");
  await savePlateOps(db, { organizationId, now: Date.now(), ops: [{ kind: "status", plateId: plate.id, status: "open" }] });
  return c.json(await viewOf(db, organizationId, plate.id));
});
