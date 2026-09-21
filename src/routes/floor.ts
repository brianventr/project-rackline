import { Hono } from "hono";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation, getOrgLocationByScan, getOrgItemByScan } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { countCatchWeight } from "../lib/catch-weight";
import { chainPlans, planCycleCount, planMove } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { parseScan } from "../domain/barcodes";
import { canPostCount, canPostTransfer } from "../domain/status";
import {
  applyPartialMove,
  hasUnmoved,
  isFullyMoved,
  remainingToMove,
  OverMoveError,
  type MoveLine,
} from "../domain/partial-transfer";
import { shouldSuggestPutaway, suggestPutawayJobs } from "../domain/directed-putaway";
import { loadPutawayBaysByItem } from "../db/putaway-bays";
import { allLinesEntered, applyCountEntries, countHasItem, revealSystemQty } from "../domain/blind-count";
import { applyHoldsToOnHand, HeldStockError, matchingHoldForMove } from "../domain/holds";
import { loadHeldLotQuantities, loadOpenHolds } from "../db/holds";
import { allocatedQtyAt, applyAllocationsToOnHand, InsufficientAtpError } from "../domain/allocations";
import { loadOpenAllocations } from "../db/allocations";
import {
  findLotRows,
  findSerialRow,
  loadAsBuiltForComponent,
  loadAsBuiltForLotCode,
  loadAsBuiltForParentSerial,
} from "../db/as-built";
import { completeMatchingSuggestionJobs, guardFloorJob, guardMatchingSuggestionJobs, syncDocumentJob } from "../db/jobs";
import { loadDocumentNumber, loadOpenAssignmentForEquipment } from "../db/equipment";
import { loadPackagesForAsns, loadUnputawayReceivedCartons } from "../db/asn-packages";
import { asnCartonPutawayGate } from "../domain/cartons";

export const floorRoute = new Hono<AppEnv>();

const transferLineSelect = {
  id: schema.transferLines.id,
  itemId: schema.transferLines.itemId,
  qty: schema.transferLines.qty,
  qtyMoved: schema.transferLines.qtyMoved,
  sku: schema.items.sku,
  itemName: schema.items.name,
};

function asMoveLine(line: { id: string; sku: string; qty: number; qtyMoved: number }): MoveLine {
  return {
    lineId: line.id,
    sku: line.sku,
    qtyExpected: line.qty,
    qtyMoved: line.qtyMoved,
  };
}

function withMoveRemaining<T extends { id: string; sku: string; qty: number; qtyMoved: number }>(line: T) {
  return { ...line, remaining: remainingToMove(asMoveLine(line)) };
}

function resolveIncomingMove(
  lines: { id: string; itemId: string; remaining: number }[],
  bodyLines?: { lineId?: string; itemId?: string; qty?: number }[],
): { lineId: string; qty: number }[] {
  if (Array.isArray(bodyLines) && bodyLines.length > 0) {
    const byId = new Map(lines.map((line) => [line.id, line]));
    const byItem = new Map(lines.map((line) => [line.itemId, line]));
    return bodyLines.map((row) => {
      const line =
        (row.lineId ? byId.get(row.lineId) : undefined) ?? (row.itemId ? byItem.get(row.itemId) : undefined);
      if (!line) badRequest("Line is not on this transfer");
      const qty = row.qty === undefined || row.qty === null ? line.remaining : requireInt(row.qty, "qty");
      return { lineId: line.id, qty };
    });
  }
  return lines.filter((line) => line.remaining > 0).map((line) => ({ lineId: line.id, qty: line.remaining }));
}

async function transferWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const fromLoc = alias(schema.locations, "from_loc");
  const toLoc = alias(schema.locations, "to_loc");
  const [row] = await db
    .select({
      id: schema.transfers.id,
      organizationId: schema.transfers.organizationId,
      warehouseId: schema.transfers.warehouseId,
      number: schema.transfers.number,
      status: schema.transfers.status,
      fromLocationId: schema.transfers.fromLocationId,
      toLocationId: schema.transfers.toLocationId,
      notes: schema.transfers.notes,
      createdAt: schema.transfers.createdAt,
      postedAt: schema.transfers.postedAt,
      fromCode: fromLoc.code,
      toCode: toLoc.code,
      fromBarcode: fromLoc.barcode,
      toBarcode: toLoc.barcode,
    })
    .from(schema.transfers)
    .innerJoin(fromLoc, eq(fromLoc.id, schema.transfers.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, schema.transfers.toLocationId))
    .where(and(eq(schema.transfers.id, id), eq(schema.transfers.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Transfer not found");
  const lines = await db
    .select(transferLineSelect)
    .from(schema.transferLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.transferLines.itemId))
    .where(eq(schema.transferLines.transferId, id));
  return { ...row, lines: lines.map(withMoveRemaining) };
}

floorRoute.get("/transfers", async (c) => {
  const db = c.get("db");
  const fromLoc = alias(schema.locations, "from_loc");
  const toLoc = alias(schema.locations, "to_loc");
  const rows = await db
    .select({
      id: schema.transfers.id,
      number: schema.transfers.number,
      status: schema.transfers.status,
      fromLocationId: schema.transfers.fromLocationId,
      toLocationId: schema.transfers.toLocationId,
      notes: schema.transfers.notes,
      createdAt: schema.transfers.createdAt,
      warehouseId: schema.transfers.warehouseId,
      fromCode: fromLoc.code,
      toCode: toLoc.code,
      fromBarcode: fromLoc.barcode,
      toBarcode: toLoc.barcode,
    })
    .from(schema.transfers)
    .innerJoin(fromLoc, eq(fromLoc.id, schema.transfers.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, schema.transfers.toLocationId))
    .where(eq(schema.transfers.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.transfers.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      ...transferLineSelect,
      transferId: schema.transferLines.transferId,
    })
    .from(schema.transferLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.transferLines.itemId))
    .where(
      inArray(
        schema.transferLines.transferId,
        rows.map((row) => row.id),
      ),
    );
  const byTransfer = new Map<string, ReturnType<typeof withMoveRemaining<(typeof lines)[number]>>[]>();
  for (const line of lines) {
    const list = byTransfer.get(line.transferId) ?? [];
    list.push(withMoveRemaining(line));
    byTransfer.set(line.transferId, list);
  }
  return c.json(rows.map((row) => ({ ...row, lines: byTransfer.get(row.id) ?? [] })));
});

floorRoute.get("/transfers/:id", async (c) => {
  return c.json(await transferWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

floorRoute.post("/transfers", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    notes?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const fromLocationId = requireString(body.fromLocationId, "fromLocationId");
  const toLocationId = requireString(body.toLocationId, "toLocationId");
  if (fromLocationId === toLocationId) badRequest("From and to locations must differ");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one transfer line is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const from = await getOrgLocation(db, organizationId, fromLocationId);
  const to = await getOrgLocation(db, organizationId, toLocationId);
  if (from.warehouseId !== warehouseId) badRequest("From location must be in the selected warehouse");

  const id = newId();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), transferId: id, itemId, qty, qtyMoved: 0 });
  }

  await db.batch([
    db.insert(schema.transfers).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("XFR"),
      status: "draft",
      fromLocationId,
      toLocationId,
      toWarehouseId: from.warehouseId !== to.warehouseId ? to.warehouseId : null,
      notes: body.notes?.trim() || null,
      createdAt: Date.now(),
    }),
    ...lines.map((line) => db.insert(schema.transferLines).values(line)),
  ]);

  const created = await transferWithLines(db, organizationId, id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: created.warehouseId,
    refType: "transfer",
    refId: created.id,
    status: created.status,
    number: created.number,
    title: created.notes,
    fromLocationId: created.fromLocationId,
    toLocationId: created.toLocationId,
    createdAt: created.createdAt,
  });
  return c.json(created, 201);
});

floorRoute.post("/transfers/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const transfer = await transferWithLines(db, organizationId, c.req.param("id"));
  if (transfer.status !== "draft") conflict("Transfer is not a draft");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: transfer.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "transfer",
    refId: transfer.id,
    verb: "putaway",
    number: transfer.number,
    title: transfer.notes,
    fromLocationId: transfer.fromLocationId,
    toLocationId: transfer.toLocationId,
    createdAt: transfer.createdAt,
  });
  await db.update(schema.transfers).set({ status: "in_progress" }).where(eq(schema.transfers.id, transfer.id));
  const started = await transferWithLines(db, organizationId, transfer.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: started.warehouseId,
    refType: "transfer",
    refId: started.id,
    status: started.status,
    number: started.number,
    title: started.notes,
    fromLocationId: started.fromLocationId,
    toLocationId: started.toLocationId,
    createdAt: started.createdAt,
  });
  return c.json(started);
});

floorRoute.post("/transfers/:id/post", async (c) => {
  const body = await c.req
    .json<{ lines?: { lineId?: string; itemId?: string; qty?: number }[] }>()
    .catch(() => ({}) as { lines?: { lineId?: string; itemId?: string; qty?: number }[] });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const transfer = await transferWithLines(db, organizationId, c.req.param("id"));
  if (!canPostTransfer(transfer.status)) conflict("Transfer already posted");
  const waiting = await loadUnputawayReceivedCartons(db, organizationId, { locationId: transfer.fromLocationId });
  const cartonGate = asnCartonPutawayGate(waiting.length);
  if (!cartonGate.ok) conflict(cartonGate.error, cartonGate.code);
  await guardFloorJob(db, {
    organizationId,
    warehouseId: transfer.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "transfer",
    refId: transfer.id,
    verb: "putaway",
    number: transfer.number,
    title: transfer.notes,
    fromLocationId: transfer.fromLocationId,
    toLocationId: transfer.toLocationId,
    createdAt: transfer.createdAt,
  });
  if (!hasUnmoved(transfer.lines.map(asMoveLine))) conflict("Transfer has nothing remaining to move");

  const incoming = resolveIncomingMove(transfer.lines, body.lines).filter((line) => line.qty > 0);
  let applied;
  try {
    applied = applyPartialMove(transfer.lines.map(asMoveLine), incoming);
  } catch (err) {
    if (err instanceof OverMoveError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid transfer");
  }

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    applied.posted.flatMap((row) => {
      const line = transfer.lines.find((item) => item.id === row.lineId)!;
      return [
        { locationId: transfer.fromLocationId, itemId: line.itemId },
        { locationId: transfer.toLocationId, itemId: line.itemId },
      ];
    }),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    applied.posted.map((row) => {
      const line = transfer.lines.find((item) => item.id === row.lineId)!;
      return (balances: Map<string, number>) =>
        planMove({
          itemId: line.itemId,
          sku: line.sku,
          fromLocationId: transfer.fromLocationId,
          toLocationId: transfer.toLocationId,
          qty: row.qty,
          refId: transfer.id,
          balances,
          refType: "transfer",
        });
    }),
  );

  const now = Date.now();
  const fully = isFullyMoved(applied.next);
  const qtyMovedByLine = new Map(applied.next.map((line) => [line.lineId, line.qtyMoved]));

  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.transfers)
        .set({
          status: fully ? "posted" : "in_progress",
          postedAt: fully ? now : transfer.postedAt,
        })
        .where(eq(schema.transfers.id, transfer.id)),
      ...transfer.lines.map((line) =>
        db
          .update(schema.transferLines)
          .set({ qtyMoved: qtyMovedByLine.get(line.id) ?? line.qtyMoved })
          .where(eq(schema.transferLines.id, line.id)),
      ),
    ],
  });

  const posted = await transferWithLines(db, organizationId, transfer.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: posted.warehouseId,
    refType: "transfer",
    refId: posted.id,
    status: posted.status,
    number: posted.number,
    title: posted.notes,
    fromLocationId: posted.fromLocationId,
    toLocationId: posted.toLocationId,
    createdAt: posted.createdAt,
  });
  return c.json(posted);
});

async function countWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [row] = await db
    .select({
      id: schema.cycleCounts.id,
      organizationId: schema.cycleCounts.organizationId,
      warehouseId: schema.cycleCounts.warehouseId,
      number: schema.cycleCounts.number,
      status: schema.cycleCounts.status,
      locationId: schema.cycleCounts.locationId,
      notes: schema.cycleCounts.notes,
      createdAt: schema.cycleCounts.createdAt,
      postedAt: schema.cycleCounts.postedAt,
      locationCode: schema.locations.code,
      locationBarcode: schema.locations.barcode,
    })
    .from(schema.cycleCounts)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.cycleCounts.locationId))
    .where(and(eq(schema.cycleCounts.id, id), eq(schema.cycleCounts.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Cycle count not found");
  const lines = await db
    .select({
      id: schema.cycleCountLines.id,
      itemId: schema.cycleCountLines.itemId,
      systemQty: schema.cycleCountLines.systemQty,
      countedQty: schema.cycleCountLines.countedQty,
      entered: schema.cycleCountLines.entered,
      weightGrams: schema.cycleCountLines.weightGrams,
      sku: schema.items.sku,
      itemName: schema.items.name,
      catchWeight: schema.items.catchWeight,
    })
    .from(schema.cycleCountLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.cycleCountLines.itemId))
    .where(eq(schema.cycleCountLines.cycleCountId, id));
  return {
    ...row,
    lines: lines.map((line) => ({
      ...line,
      entered: Boolean(line.entered),
      systemQty: revealSystemQty(row.status, line.systemQty),
    })),
  };
}

floorRoute.get("/cycle-counts", async (c) => {
  const rows = await c
    .get("db")
    .select({
      id: schema.cycleCounts.id,
      number: schema.cycleCounts.number,
      status: schema.cycleCounts.status,
      locationId: schema.cycleCounts.locationId,
      notes: schema.cycleCounts.notes,
      createdAt: schema.cycleCounts.createdAt,
      warehouseId: schema.cycleCounts.warehouseId,
      locationCode: schema.locations.code,
    })
    .from(schema.cycleCounts)
    .innerJoin(schema.locations, eq(schema.locations.id, schema.cycleCounts.locationId))
    .where(eq(schema.cycleCounts.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.cycleCounts.createdAt));
  return c.json(rows);
});

floorRoute.get("/cycle-counts/:id", async (c) => {
  return c.json(await countWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

floorRoute.post("/cycle-counts", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    locationId?: string;
    notes?: string;
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await getOrgLocation(db, organizationId, locationId);

  const onHand = await db
    .select({
      itemId: schema.inventoryBalances.itemId,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        eq(schema.inventoryBalances.locationId, locationId),
        gt(schema.inventoryBalances.qty, 0),
      ),
    );

  const id = newId();
  const lines = onHand.map((row) => ({
    id: newId(),
    cycleCountId: id,
    itemId: row.itemId,
    systemQty: row.qty,
    countedQty: 0,
    entered: 0,
  }));

  await db.batch([
    db.insert(schema.cycleCounts).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("CC"),
      status: "draft",
      locationId,
      notes: body.notes?.trim() || null,
      createdAt: Date.now(),
    }),
    ...lines.map((line) => db.insert(schema.cycleCountLines).values(line)),
  ]);

  const createdCount = await countWithLines(db, organizationId, id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: createdCount.warehouseId,
    refType: "cycleCount",
    refId: createdCount.id,
    status: createdCount.status,
    number: createdCount.number,
    title: createdCount.notes || "Bay count",
    fromLocationId: createdCount.locationId,
    createdAt: createdCount.createdAt,
  });
  return c.json(createdCount, 201);
});

floorRoute.post("/cycle-counts/:id/lines", async (c) => {
  const body = await c.req.json<{ itemId?: string }>();
  const itemId = requireString(body.itemId, "itemId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const count = await countWithLines(db, organizationId, c.req.param("id"));
  if (!canPostCount(count.status)) conflict("Cycle count already posted");
  const item = await getOrgItem(db, organizationId, itemId);
  if (countHasItem(count.lines, item.id)) conflict(`${item.sku} is already on this count`);

  const [balance] = await db
    .select({ qty: schema.inventoryBalances.qty })
    .from(schema.inventoryBalances)
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        eq(schema.inventoryBalances.locationId, count.locationId),
        eq(schema.inventoryBalances.itemId, item.id),
      ),
    )
    .limit(1);

  await db.insert(schema.cycleCountLines).values({
    id: newId(),
    cycleCountId: count.id,
    itemId: item.id,
    systemQty: balance?.qty ?? 0,
    countedQty: 0,
    entered: 0,
  });
  if (count.status === "draft") {
    await db.update(schema.cycleCounts).set({ status: "counting" }).where(eq(schema.cycleCounts.id, count.id));
  }
  return c.json(await countWithLines(db, organizationId, count.id), 201);
});

floorRoute.post("/cycle-counts/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const count = await countWithLines(db, organizationId, c.req.param("id"));
  if (count.status !== "draft") conflict("Cycle count is not a draft");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: count.warehouseId,
    userId: c.get("user")!.id,
    role: c.get("role")!,
    refType: "cycleCount",
    refId: count.id,
    verb: "count",
    number: count.number,
    title: count.notes,
    fromLocationId: count.locationId,
    createdAt: count.createdAt,
  });
  await db.update(schema.cycleCounts).set({ status: "counting" }).where(eq(schema.cycleCounts.id, count.id));
  const startedCount = await countWithLines(db, organizationId, count.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: startedCount.warehouseId,
    refType: "cycleCount",
    refId: startedCount.id,
    status: startedCount.status,
    number: startedCount.number,
    title: startedCount.notes,
    fromLocationId: startedCount.locationId,
    createdAt: startedCount.createdAt,
  });
  return c.json(startedCount);
});

floorRoute.post("/cycle-counts/:id/post", async (c) => {
  const body = await c.req.json<{ lines?: { id?: string; countedQty?: number; weightGrams?: number }[] }>().catch(() => ({
    lines: [] as { id?: string; countedQty?: number; weightGrams?: number }[],
  }));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const count = await countWithLines(db, organizationId, c.req.param("id"));
  if (!canPostCount(count.status)) conflict("Cycle count already posted");
  await guardFloorJob(db, {
    organizationId,
    warehouseId: count.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    refType: "cycleCount",
    refId: count.id,
    verb: "count",
    number: count.number,
    title: count.notes,
    fromLocationId: count.locationId,
    createdAt: count.createdAt,
  });

  const incoming: { id: string; countedQty: number; weightGrams: number | null }[] = [];
  for (const line of body.lines ?? []) {
    if (!line.id) continue;
    const countedQty = requireInt(line.countedQty, "countedQty");
    if (countedQty < 0) badRequest("countedQty must be a non-negative integer");
    const stored = count.lines.find((row) => row.id === line.id);
    incoming.push({
      id: line.id,
      countedQty,
      weightGrams: countCatchWeight(stored?.catchWeight, stored?.sku ?? "SKU", countedQty, line.weightGrams),
    });
  }

  const resolved = applyCountEntries(
    count.lines.map((line) => ({ id: line.id, countedQty: line.countedQty, entered: line.entered })),
    incoming,
  );
  if (!allLinesEntered(resolved)) {
    conflict("Enter a count for every SKU before posting");
  }

  const countedById = new Map(resolved.map((line) => [line.id, line.countedQty]));
  const weightById = new Map(incoming.map((line) => [line.id, line.weightGrams]));
  const postedLines = count.lines.map((line) => {
    const countedQty = countedById.get(line.id) ?? line.countedQty;
    return {
      ...line,
      countedQty,
      entered: true,
      weightGrams: weightById.has(line.id)
        ? weightById.get(line.id)!
        : countCatchWeight(line.catchWeight, line.sku, countedQty, line.weightGrams),
    };
  });

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    postedLines.map((line) => ({ locationId: count.locationId, itemId: line.itemId })),
  );
  const current = qtyMap(loaded);
  const plan = planCycleCount({
    refId: count.id,
    locationId: count.locationId,
    balances: current,
    lines: postedLines.map((line) => ({
      itemId: line.itemId,
      sku: line.sku,
      systemQty: current.get(`${count.locationId}:${line.itemId}`) ?? 0,
      countedQty: line.countedQty,
      weightGrams: line.weightGrams,
    })),
  });

  const now = Date.now();
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      ...postedLines.map((line) =>
        db
          .update(schema.cycleCountLines)
          .set({
            countedQty: line.countedQty,
            systemQty: current.get(`${count.locationId}:${line.itemId}`) ?? 0,
            entered: 1,
            weightGrams: line.weightGrams,
          })
          .where(eq(schema.cycleCountLines.id, line.id)),
      ),
      db
        .update(schema.cycleCounts)
        .set({ status: "posted", postedAt: now })
        .where(eq(schema.cycleCounts.id, count.id)),
    ],
  });

  const postedCount = await countWithLines(db, organizationId, count.id);
  await syncDocumentJob(db, {
    organizationId,
    warehouseId: postedCount.warehouseId,
    refType: "cycleCount",
    refId: postedCount.id,
    status: postedCount.status,
    number: postedCount.number,
    title: postedCount.notes,
    fromLocationId: postedCount.locationId,
    createdAt: postedCount.createdAt,
  });
  return c.json(postedCount);
});

floorRoute.get("/map", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = c.req.query("warehouseId");

  const warehouses = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId));
  const warehouse = warehouseId
    ? warehouses.find((row) => row.id === warehouseId)
    : warehouses[0];
  if (!warehouse) notFound("Warehouse not found");

  const locationRows = await db
    .select()
    .from(schema.locations)
    .where(
      and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.warehouseId, warehouse.id)),
    )
    .orderBy(schema.locations.code);

  const balances = await db
    .select({
      locationId: schema.inventoryBalances.locationId,
      qty: schema.inventoryBalances.qty,
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      itemType: schema.items.type,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .where(and(eq(schema.inventoryBalances.organizationId, organizationId), gt(schema.inventoryBalances.qty, 0)));

  const byLocation = new Map<string, typeof balances>();
  for (const row of balances) {
    const list = byLocation.get(row.locationId) ?? [];
    list.push(row);
    byLocation.set(row.locationId, list);
  }

  return c.json({
    warehouse: {
      id: warehouse.id,
      name: warehouse.name,
      mapWidth: warehouse.mapWidth,
      mapDepth: warehouse.mapDepth,
      mapHeight: warehouse.mapHeight,
    },
    warehouses: warehouses.map((row) => ({
      id: row.id,
      name: row.name,
      mapWidth: row.mapWidth,
      mapDepth: row.mapDepth,
      mapHeight: row.mapHeight,
    })),
    locations: locationRows.map((location) => {
      const contents = byLocation.get(location.id) ?? [];
      return {
        ...location,
        unitsOnHand: contents.reduce((sum, row) => sum + row.qty, 0),
        skuCount: contents.length,
        contents: contents.map((row) => ({
          itemId: row.itemId,
          sku: row.sku,
          itemName: row.itemName,
          itemType: row.itemType,
          qty: row.qty,
        })),
      };
    }),
  });
});

floorRoute.get("/scan", async (c) => {
  const raw = requireString(c.req.query("code"), "code");
  const parsed = parseScan(raw);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;

  async function locationHit(code: string) {
    const location = await getOrgLocationByScan(db, organizationId, code);
    if (!location) return null;
    const contents = await db
      .select({
        itemId: schema.items.id,
        sku: schema.items.sku,
        itemName: schema.items.name,
        itemType: schema.items.type,
        qty: schema.inventoryBalances.qty,
      })
      .from(schema.inventoryBalances)
      .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
      .where(
        and(
          eq(schema.inventoryBalances.organizationId, organizationId),
          eq(schema.inventoryBalances.locationId, location.id),
          gt(schema.inventoryBalances.qty, 0),
        ),
      );
    const holds = await loadOpenHolds(db, organizationId, location.warehouseId);
    const lotQtys = await loadHeldLotQuantities(db, organizationId, holds);
    const allocations = await loadOpenAllocations(db, organizationId, { warehouseId: location.warehouseId });
    const withLocation = contents.map((row) => ({ ...row, locationId: location.id }));
    const available = applyAllocationsToOnHand(applyHoldsToOnHand(withLocation, holds, lotQtys), allocations);
    const availableByItem = new Map(available.map((row) => [row.itemId, row.qty]));
    const annotated = contents.map((row) => {
      const hit = matchingHoldForMove(holds, location.id, row.itemId);
      const allocated = allocatedQtyAt(allocations, location.id, row.itemId);
      return {
        ...row,
        held: Boolean(hit),
        holdNumber: hit?.number ?? null,
        holdReason: hit?.reason ?? null,
        allocated,
        availableQty: availableByItem.get(row.itemId) ?? row.qty,
      };
    });
    const locationHolds = holds.filter((hold) => hold.locationId === location.id);
    if (!shouldSuggestPutaway(location.type) || contents.length === 0) {
      return { kind: "location" as const, location, contents: annotated, holds: locationHolds };
    }
    const movable = available.filter((row) => row.qty > 0);
    const baysByItem = await loadPutawayBaysByItem(
      db,
      organizationId,
      location.warehouseId,
      [...new Set(movable.map((row) => row.itemId))],
    );
    const jobs = suggestPutawayJobs(
      { id: location.id, code: location.code, barcode: location.barcode, type: location.type },
      movable,
      baysByItem,
    );
    const suggestedByItem = new Map(jobs.map((job) => [job.itemId, job.suggested]));
    return {
      kind: "location" as const,
      location,
      holds: locationHolds,
      contents: annotated.map((row) => {
        const suggested = suggestedByItem.get(row.itemId);
        return {
          ...row,
          suggestedLocation: suggested
            ? {
                locationId: suggested.locationId,
                locationCode: suggested.locationCode,
                locationName: suggested.locationName,
                barcode: suggested.barcode,
                qty: suggested.qty,
              }
            : null,
        };
      }),
    };
  }

  async function itemHit(code: string) {
    const item = await getOrgItemByScan(db, organizationId, code);
    if (!item) return null;
    const onHand = await db
      .select({
        locationId: schema.locations.id,
        locationCode: schema.locations.code,
        locationName: schema.locations.name,
        barcode: schema.locations.barcode,
        qty: schema.inventoryBalances.qty,
        itemId: schema.inventoryBalances.itemId,
      })
      .from(schema.inventoryBalances)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
      .where(
        and(
          eq(schema.inventoryBalances.organizationId, organizationId),
          eq(schema.inventoryBalances.itemId, item.id),
          gt(schema.inventoryBalances.qty, 0),
        ),
      );
    const holds = await loadOpenHolds(db, organizationId);
    const lotQtys = await loadHeldLotQuantities(db, organizationId, holds);
    const allocations = await loadOpenAllocations(db, organizationId);
    const holdAdjusted = applyHoldsToOnHand(onHand, holds, lotQtys);
    const available = applyAllocationsToOnHand(holdAdjusted, allocations);
    const annotated = available.map((row) => {
      const physical = onHand.find((entry) => entry.locationId === row.locationId)?.qty ?? row.qty;
      const hit = matchingHoldForMove(holds, row.locationId, item.id);
      const allocated = allocatedQtyAt(allocations, row.locationId, item.id);
      return {
        ...row,
        qty: physical,
        held: Boolean(hit) || (holdAdjusted.find((entry) => entry.locationId === row.locationId)?.qty ?? physical) < physical,
        holdNumber: hit?.number ?? null,
        holdReason: hit?.reason ?? null,
        allocated,
        availableQty: row.qty,
      };
    });
    return { kind: "item" as const, item, onHand: annotated };
  }

  async function findByNumber<T extends { number: string }>(
    rows: T[],
    value: string,
  ): Promise<T | undefined> {
    const needle = value.replace(/^[#]/, "").toUpperCase();
    return rows.find((row) => {
      const number = row.number.toUpperCase();
      return number === value.toUpperCase() || number === needle || number.endsWith(`-${needle}`) || number === `#${needle}`;
    });
  }

  if (parsed.kind === "location" || parsed.kind === "unknown") {
    const hit = await locationHit(parsed.value);
    if (hit) return c.json(hit);
    if (parsed.kind === "location") notFound("No location matches that barcode");
  }

  if (parsed.kind === "item" || parsed.kind === "unknown") {
    const hit = await itemHit(parsed.value);
    if (hit) return c.json(hit);
    if (parsed.kind === "item") notFound("No item matches that barcode");
  }

  if (parsed.kind === "order" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.orders).where(eq(schema.orders.organizationId, organizationId));
    const order = await findByNumber(rows, parsed.value);
    if (order) return c.json({ kind: "order" as const, order: await (async () => {
      const lines = await db
        .select({
          id: schema.orderLines.id,
          itemId: schema.orderLines.itemId,
          qty: schema.orderLines.qty,
          qtyPicked: schema.orderLines.qtyPicked,
          qtyPacked: schema.orderLines.qtyPacked,
          sku: schema.items.sku,
          itemName: schema.items.name,
        })
        .from(schema.orderLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
        .where(eq(schema.orderLines.orderId, order.id));
      return {
        ...order,
        lines: lines.map((line) => ({
          ...line,
          remaining: line.qty - line.qtyPicked,
          packRemaining: line.qtyPicked - line.qtyPacked,
        })),
      };
    })() });
    if (parsed.kind === "order") notFound("No order matches that barcode");
  }

  if (parsed.kind === "receipt" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.receipts).where(eq(schema.receipts.organizationId, organizationId));
    const receipt = await findByNumber(rows, parsed.value);
    if (receipt) {
      const lines = await db
        .select({
          id: schema.receiptLines.id,
          itemId: schema.receiptLines.itemId,
          qty: schema.receiptLines.qty,
          qtyReceived: schema.receiptLines.qtyReceived,
          sku: schema.items.sku,
          itemName: schema.items.name,
        })
        .from(schema.receiptLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.receiptLines.itemId))
        .where(eq(schema.receiptLines.receiptId, receipt.id));
      return c.json({
        kind: "receipt" as const,
        receipt: {
          ...receipt,
          lines: lines.map((line) => ({
            ...line,
            remaining: line.qty - line.qtyReceived,
          })),
        },
      });
    }
    if (parsed.kind === "receipt") notFound("No receipt matches that barcode");
  }

  if (parsed.kind === "transfer" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.transfers).where(eq(schema.transfers.organizationId, organizationId));
    const transfer = await findByNumber(rows, parsed.value);
    if (transfer) return c.json({ kind: "transfer" as const, transfer: await transferWithLines(db, organizationId, transfer.id) });
    if (parsed.kind === "transfer") notFound("No transfer matches that barcode");
  }

  if (parsed.kind === "workOrder" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.workOrders).where(eq(schema.workOrders.organizationId, organizationId));
    const workOrder = await findByNumber(rows, parsed.value);
    if (workOrder) return c.json({ kind: "workOrder" as const, workOrder });
    if (parsed.kind === "workOrder") notFound("No work order matches that barcode");
  }

  if (parsed.kind === "cycleCount" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.cycleCounts).where(eq(schema.cycleCounts.organizationId, organizationId));
    const cycleCount = await findByNumber(rows, parsed.value);
    if (cycleCount) return c.json({ kind: "cycleCount" as const, cycleCount });
    if (parsed.kind === "cycleCount") notFound("No cycle count matches that barcode");
  }

  if (parsed.kind === "purchase" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.purchases).where(eq(schema.purchases.organizationId, organizationId));
    const purchase = await findByNumber(rows, parsed.value);
    if (purchase) {
      const lines = await db
        .select({
          id: schema.purchaseLines.id,
          itemId: schema.purchaseLines.itemId,
          qtyOrdered: schema.purchaseLines.qtyOrdered,
          qtyReceived: schema.purchaseLines.qtyReceived,
          sku: schema.items.sku,
          itemName: schema.items.name,
        })
        .from(schema.purchaseLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.purchaseLines.itemId))
        .where(eq(schema.purchaseLines.purchaseId, purchase.id));
      return c.json({
        kind: "purchase" as const,
        purchase: {
          ...purchase,
          lines: lines.map((line) => ({
            ...line,
            remaining: line.qtyOrdered - line.qtyReceived,
          })),
        },
      });
    }
    if (parsed.kind === "purchase") notFound("No purchase matches that barcode");
  }

  if (parsed.kind === "rma" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.rmas).where(eq(schema.rmas.organizationId, organizationId));
    const rma = await findByNumber(rows, parsed.value);
    if (rma) {
      const lines = await db
        .select({
          id: schema.rmaLines.id,
          itemId: schema.rmaLines.itemId,
          qtyExpected: schema.rmaLines.qtyExpected,
          qtyReceived: schema.rmaLines.qtyReceived,
          disposition: schema.rmaLines.disposition,
          sku: schema.items.sku,
          itemName: schema.items.name,
        })
        .from(schema.rmaLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.rmaLines.itemId))
        .where(eq(schema.rmaLines.rmaId, rma.id));
      return c.json({
        kind: "rma" as const,
        rma: {
          ...rma,
          lines: lines.map((line) => ({
            ...line,
            remaining: line.qtyExpected - line.qtyReceived,
          })),
        },
      });
    }
    if (parsed.kind === "rma") notFound("No return matches that barcode");
  }

  if (parsed.kind === "vendorReturn" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.vendorReturns).where(eq(schema.vendorReturns.organizationId, organizationId));
    const vendorReturn = await findByNumber(rows, parsed.value);
    if (vendorReturn) {
      const lines = await db
        .select({
          id: schema.vendorReturnLines.id,
          itemId: schema.vendorReturnLines.itemId,
          qtyExpected: schema.vendorReturnLines.qtyExpected,
          qtyReturned: schema.vendorReturnLines.qtyReturned,
          sku: schema.items.sku,
          itemName: schema.items.name,
        })
        .from(schema.vendorReturnLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.vendorReturnLines.itemId))
        .where(eq(schema.vendorReturnLines.vendorReturnId, vendorReturn.id));
      return c.json({
        kind: "vendorReturn" as const,
        vendorReturn: {
          ...vendorReturn,
          lines: lines.map((line) => ({
            ...line,
            remaining: line.qtyExpected - line.qtyReturned,
          })),
        },
      });
    }
    if (parsed.kind === "vendorReturn") notFound("No vendor return matches that barcode");
  }

  if (parsed.kind === "replenishment" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.replenishments).where(eq(schema.replenishments.organizationId, organizationId));
    const replenishment = await findByNumber(rows, parsed.value);
    if (replenishment) return c.json({ kind: "replenishment" as const, replenishment });
    if (parsed.kind === "replenishment") notFound("No replenishment matches that barcode");
  }

  if (parsed.kind === "kit" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.kitBuilds).where(eq(schema.kitBuilds.organizationId, organizationId));
    const kit = await findByNumber(rows, parsed.value);
    if (kit) return c.json({ kind: "kit" as const, kit });
    if (parsed.kind === "kit") notFound("No kit matches that barcode");
  }

  if (parsed.kind === "hold" || parsed.kind === "unknown") {
    const rows = await db
      .select({
        id: schema.inventoryHolds.id,
        warehouseId: schema.inventoryHolds.warehouseId,
        number: schema.inventoryHolds.number,
        status: schema.inventoryHolds.status,
        locationId: schema.inventoryHolds.locationId,
        itemId: schema.inventoryHolds.itemId,
        lotCode: schema.inventoryHolds.lotCode,
        reason: schema.inventoryHolds.reason,
        notes: schema.inventoryHolds.notes,
        createdAt: schema.inventoryHolds.createdAt,
        releasedAt: schema.inventoryHolds.releasedAt,
        locationCode: schema.locations.code,
        locationBarcode: schema.locations.barcode,
        sku: schema.items.sku,
        itemName: schema.items.name,
      })
      .from(schema.inventoryHolds)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryHolds.locationId))
      .leftJoin(schema.items, eq(schema.items.id, schema.inventoryHolds.itemId))
      .where(eq(schema.inventoryHolds.organizationId, organizationId));
    const hold = await findByNumber(rows, parsed.value);
    if (hold) return c.json({ kind: "hold" as const, hold });
    if (parsed.kind === "hold") notFound("No hold matches that barcode");
  }

  if (parsed.kind === "wave" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.waves).where(eq(schema.waves.organizationId, organizationId));
    const wave = await findByNumber(rows, parsed.value);
    if (wave) return c.json({ kind: "wave" as const, wave });
    if (parsed.kind === "wave") notFound("No wave matches that barcode");
  }

  if (parsed.kind === "asn" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.asns).where(eq(schema.asns.organizationId, organizationId));
    const asn = await findByNumber(rows, parsed.value);
    if (asn) {
      const lines = await db
        .select({
          id: schema.asnLines.id,
          itemId: schema.asnLines.itemId,
          qtyExpected: schema.asnLines.qtyExpected,
          qtyReceived: schema.asnLines.qtyReceived,
          sku: schema.items.sku,
          itemName: schema.items.name,
          trackLot: schema.items.trackLot,
          trackSerial: schema.items.trackSerial,
          catchWeight: schema.items.catchWeight,
          trackExpiry: schema.items.trackExpiry,
        })
        .from(schema.asnLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.asnLines.itemId))
        .where(eq(schema.asnLines.asnId, asn.id));
      const packages = (await loadPackagesForAsns(db, [asn.id])).get(asn.id) ?? [];
      return c.json({
        kind: "asn" as const,
        asn: {
          ...asn,
          packages,
          lines: lines.map((line) => ({
            ...line,
            remaining: line.qtyExpected - line.qtyReceived,
          })),
        },
      });
    }
    if (parsed.kind === "asn") notFound("No ASN matches that barcode");
  }

  if (parsed.kind === "package" || parsed.kind === "unknown") {
    const needle = parsed.value.trim().toUpperCase();
    const rows = await db
      .select()
      .from(schema.asnPackages)
      .where(eq(schema.asnPackages.organizationId, organizationId));
    const pkg = rows.find(
      (row) =>
        row.number.toUpperCase() === needle ||
        row.number.toUpperCase() === `BOX-${needle}` ||
        (row.sscc && row.sscc.toUpperCase() === needle),
    );
    if (pkg) {
      const [asn] = await db
        .select()
        .from(schema.asns)
        .where(and(eq(schema.asns.id, pkg.asnId), eq(schema.asns.organizationId, organizationId)))
        .limit(1);
      if (asn) {
        const lines = await db
          .select({
            id: schema.asnLines.id,
            itemId: schema.asnLines.itemId,
            qtyExpected: schema.asnLines.qtyExpected,
            qtyReceived: schema.asnLines.qtyReceived,
            sku: schema.items.sku,
            itemName: schema.items.name,
            trackLot: schema.items.trackLot,
            trackSerial: schema.items.trackSerial,
            catchWeight: schema.items.catchWeight,
            trackExpiry: schema.items.trackExpiry,
          })
          .from(schema.asnLines)
          .innerJoin(schema.items, eq(schema.items.id, schema.asnLines.itemId))
          .where(eq(schema.asnLines.asnId, asn.id));
        const packages = (await loadPackagesForAsns(db, [asn.id])).get(asn.id) ?? [];
        return c.json({
          kind: "asn" as const,
          package: packages.find((row) => row.id === pkg.id) ?? pkg,
          asn: {
            ...asn,
            packages,
            lines: lines.map((line) => ({
              ...line,
              remaining: line.qtyExpected - line.qtyReceived,
            })),
          },
        });
      }
    }
    if (parsed.kind === "package") notFound("No carton matches that barcode");
  }

  if (parsed.kind === "yard" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.yardVisits).where(eq(schema.yardVisits.organizationId, organizationId));
    const yard = await findByNumber(rows, parsed.value);
    if (yard) return c.json({ kind: "yard" as const, yard });
    if (parsed.kind === "yard") notFound("No yard visit matches that barcode");
  }

  if (parsed.kind === "equipment" || parsed.kind === "unknown") {
    const needle = parsed.value.trim().toUpperCase();
    const rows = await db.select().from(schema.equipment).where(eq(schema.equipment.organizationId, organizationId));
    const match = rows.find(
      (row) =>
        row.barcode.toUpperCase() === needle ||
        row.barcode.toUpperCase() === `EQ:${needle}` ||
        row.code.toUpperCase() === needle ||
        row.code.toUpperCase() === needle.replace(/^EQ:/, ""),
    );
    if (match) {
      const open = await loadOpenAssignmentForEquipment(db, organizationId, match.id);
      let currentAssignment = null;
      if (open) {
        const [operator] = await db
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, open.operatorUserId))
          .limit(1);
        currentAssignment = {
          id: open.id,
          number: open.number,
          operatorUserId: open.operatorUserId,
          operatorName: operator?.name ?? null,
          status: open.status,
          shift: open.shift,
          refType: open.refType,
          refId: open.refId,
          taskNumber: await loadDocumentNumber(db, organizationId, open.refType, open.refId),
          startedAt: open.startedAt,
        };
      }
      return c.json({ kind: "equipment" as const, equipment: { ...match, currentAssignment } });
    }
    if (parsed.kind === "equipment") notFound("No equipment matches that barcode");
  }

  if (parsed.kind === "serial" || parsed.kind === "unknown") {
    const serial = await findSerialRow(db, organizationId, parsed.value);
    if (serial) {
      const [builtFrom, usedIn] = await Promise.all([
        loadAsBuiltForParentSerial(db, organizationId, serial.serialCode),
        loadAsBuiltForComponent(db, organizationId, { serial: serial.serialCode }),
      ]);
      return c.json({
        kind: "serial" as const,
        serial: {
          serialCode: serial.serialCode,
          status: serial.status,
          itemId: serial.itemId,
          sku: serial.sku,
          itemName: serial.itemName,
          locationId: serial.locationId,
          locationCode: serial.locationCode,
          locationName: serial.locationName,
        },
        item: { id: serial.itemId, sku: serial.sku, name: serial.itemName, barcode: serial.barcode },
        builtFrom,
        usedIn,
      });
    }
    if (parsed.kind === "serial") notFound("No serial matches that barcode");
  }

  if (parsed.kind === "lot" || parsed.kind === "unknown") {
    const onHand = await findLotRows(db, organizationId, parsed.value);
    const genealogy = await loadAsBuiltForLotCode(db, organizationId, parsed.value);
    if (onHand.length || genealogy.length) {
      const lotCode = onHand[0]?.lotCode ?? parsed.value.trim().toUpperCase();
      return c.json({
        kind: "lot" as const,
        lotCode,
        onHand,
        builtFrom: genealogy.filter((row) => row.parentLotCode === lotCode),
        usedIn: genealogy.filter((row) => row.componentLotCode === lotCode),
      });
    }
    if (parsed.kind === "lot") notFound("No lot matches that barcode");
  }

  notFound("No location, item, document, serial, lot, or equipment matches that barcode");
});

floorRoute.post("/moves", async (c) => {
  const body = await c.req.json<{
    fromLocationId?: string;
    toLocationId?: string;
    fromBarcode?: string;
    toBarcode?: string;
    lines?: { itemId?: string; qty?: number }[];
  }>();

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;

  const from =
    (body.fromLocationId ? await getOrgLocation(db, organizationId, requireString(body.fromLocationId, "fromLocationId")) : null) ??
    (body.fromBarcode
      ? await getOrgLocationByScan(db, organizationId, parseScan(requireString(body.fromBarcode, "fromBarcode")).value)
      : null);
  const to =
    (body.toLocationId ? await getOrgLocation(db, organizationId, requireString(body.toLocationId, "toLocationId")) : null) ??
    (body.toBarcode
      ? await getOrgLocationByScan(db, organizationId, parseScan(requireString(body.toBarcode, "toBarcode")).value)
      : null);

  if (!from) badRequest("Scan or choose a from location");
  if (!to) badRequest("Scan or choose a to location");
  if (from.id === to.id) badRequest("From and to locations must differ");
  const waiting = await loadUnputawayReceivedCartons(db, organizationId, { locationId: from.id });
  const cartonGate = asnCartonPutawayGate(waiting.length);
  if (!cartonGate.ok) conflict(cartonGate.error, cartonGate.code);
  // Cross-warehouse scan-to-move is allowed for multi-warehouse shops.
  const onHand = await db
    .select({
      itemId: schema.items.id,
      sku: schema.items.sku,
      itemName: schema.items.name,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        eq(schema.inventoryBalances.locationId, from.id),
        gt(schema.inventoryBalances.qty, 0),
      ),
    );

  if (onHand.length === 0) badRequest(`${from.code} is empty`);

  const holds = await loadOpenHolds(db, organizationId, from.warehouseId);
  const lotQtys = await loadHeldLotQuantities(db, organizationId, holds);
  const allocations = await loadOpenAllocations(db, organizationId, { warehouseId: from.warehouseId });
  const available = applyAllocationsToOnHand(
    applyHoldsToOnHand(
      onHand.map((row) => ({ ...row, locationId: from.id })),
      holds,
      lotQtys,
    ),
    allocations,
  );

  const requested = body.lines?.length
    ? body.lines.map((line) => {
        const itemId = requireString(line.itemId, "itemId");
        const qty = typeof line.qty === "number" ? line.qty : Number(line.qty);
        if (!Number.isInteger(qty) || qty <= 0) badRequest("Move quantity must be a positive integer");
        const row = onHand.find((entry) => entry.itemId === itemId);
        if (!row) badRequest("Item is not in the from location");
        const free = available.find((entry) => entry.itemId === itemId)?.qty ?? 0;
        if (qty > free) {
          const hit = matchingHoldForMove(holds, from.id, itemId);
          if (hit) throw new HeldStockError(hit.sku ?? row.sku, hit.locationCode, hit.number, hit.reason);
          const allocated = allocatedQtyAt(allocations, from.id, itemId);
          if (allocated > 0) throw new InsufficientAtpError(row.sku, free, qty, from.code);
          badRequest(`Only ${row.qty} of ${row.sku} in ${from.code}`);
        }
        return { itemId, sku: row.sku, itemName: row.itemName, qty };
      })
    : available
        .filter((row) => row.qty > 0)
        .map((row) => ({ itemId: row.itemId, sku: row.sku, itemName: row.itemName, qty: row.qty }));

  if (requested.length === 0) {
    const hit = matchingHoldForMove(holds, from.id, onHand[0]!.itemId) ?? holds.find((hold) => hold.locationId === from.id);
    if (hit) throw new HeldStockError(hit.sku ?? onHand[0]!.sku, hit.locationCode, hit.number, hit.reason);
    const allocated = allocatedQtyAt(allocations, from.id, onHand[0]!.itemId);
    if (allocated > 0) {
      throw new InsufficientAtpError(onHand[0]!.sku, 0, allocated, from.code);
    }
    badRequest(`${from.code} is empty`);
  }

  for (const line of requested) {
    await getOrgItem(db, organizationId, line.itemId);
  }

  await guardMatchingSuggestionJobs(db, {
    organizationId,
    warehouseId: from.warehouseId,
    userId: user.id,
    role: c.get("role")!,
    fromLocationId: from.id,
    toLocationId: to.id,
    itemIds: requested.map((line) => line.itemId),
  });

  const pairs = requested.flatMap((line) => [
    { locationId: from.id, itemId: line.itemId },
    { locationId: to.id, itemId: line.itemId },
  ]);
  const loaded = await loadBalanceMap(db, organizationId, pairs);
  const refId = newId();
  const plan = chainPlans(
    qtyMap(loaded),
    requested.map(
      (line) => (balances) =>
        planMove({
          itemId: line.itemId,
          sku: line.sku,
          qty: line.qty,
          fromLocationId: from.id,
          toLocationId: to.id,
          refId,
          balances,
        }),
    ),
  );

  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now: Date.now(),
    loaded,
    plan,
  });

  await completeMatchingSuggestionJobs(db, {
    organizationId,
    warehouseId: from.warehouseId,
    fromLocationId: from.id,
    toLocationId: to.id,
    itemIds: requested.map((line) => line.itemId),
  });

  return c.json({
    ok: true,
    refId,
    from: { id: from.id, code: from.code, name: from.name, barcode: from.barcode },
    to: { id: to.id, code: to.code, name: to.name, barcode: to.barcode },
    moved: requested,
  });
});
