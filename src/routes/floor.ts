import { Hono } from "hono";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation, getOrgLocationByScan, getOrgItemByScan } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { chainPlans, planCycleCount, planMove } from "../domain/inventory";
import { loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { parseScan } from "../domain/barcodes";
import { canPostCount, canPostTransfer } from "../domain/status";

export const floorRoute = new Hono<AppEnv>();

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
    })
    .from(schema.transfers)
    .innerJoin(fromLoc, eq(fromLoc.id, schema.transfers.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, schema.transfers.toLocationId))
    .where(and(eq(schema.transfers.id, id), eq(schema.transfers.organizationId, organizationId)))
    .limit(1);
  if (!row) notFound("Transfer not found");
  const lines = await db
    .select({
      id: schema.transferLines.id,
      itemId: schema.transferLines.itemId,
      qty: schema.transferLines.qty,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.transferLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.transferLines.itemId))
    .where(eq(schema.transferLines.transferId, id));
  return { ...row, lines };
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
    })
    .from(schema.transfers)
    .innerJoin(fromLoc, eq(fromLoc.id, schema.transfers.fromLocationId))
    .innerJoin(toLoc, eq(toLoc.id, schema.transfers.toLocationId))
    .where(eq(schema.transfers.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.transfers.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.transferLines.id,
      transferId: schema.transferLines.transferId,
      itemId: schema.transferLines.itemId,
      qty: schema.transferLines.qty,
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.transferLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.transferLines.itemId))
    .where(
      inArray(
        schema.transferLines.transferId,
        rows.map((row) => row.id),
      ),
    );
  const byTransfer = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byTransfer.get(line.transferId) ?? [];
    list.push(line);
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
  await getOrgLocation(db, organizationId, fromLocationId);
  await getOrgLocation(db, organizationId, toLocationId);

  const id = newId();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), transferId: id, itemId, qty });
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
      notes: body.notes?.trim() || null,
      createdAt: Date.now(),
    }),
    ...lines.map((line) => db.insert(schema.transferLines).values(line)),
  ]);

  return c.json(await transferWithLines(db, organizationId, id), 201);
});

floorRoute.post("/transfers/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const transfer = await transferWithLines(db, organizationId, c.req.param("id"));
  if (transfer.status !== "draft") conflict("Transfer is not a draft");
  await db.update(schema.transfers).set({ status: "in_progress" }).where(eq(schema.transfers.id, transfer.id));
  return c.json(await transferWithLines(db, organizationId, transfer.id));
});

floorRoute.post("/transfers/:id/post", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const transfer = await transferWithLines(db, organizationId, c.req.param("id"));
  if (!canPostTransfer(transfer.status)) conflict("Transfer already posted");

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    transfer.lines.flatMap((line) => [
      { locationId: transfer.fromLocationId, itemId: line.itemId },
      { locationId: transfer.toLocationId, itemId: line.itemId },
    ]),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    transfer.lines.map((line) => (balances) =>
      planMove({
        itemId: line.itemId,
        sku: line.sku,
        fromLocationId: transfer.fromLocationId,
        toLocationId: transfer.toLocationId,
        qty: line.qty,
        refId: transfer.id,
        balances,
        refType: "transfer",
      }),
    ),
  );

  const now = Date.now();
  await persistStockPlan(db, {
    organizationId,
    createdBy: user.id,
    now,
    loaded,
    plan,
    extra: [
      db
        .update(schema.transfers)
        .set({ status: "posted", postedAt: now })
        .where(eq(schema.transfers.id, transfer.id)),
    ],
  });

  return c.json(await transferWithLines(db, organizationId, transfer.id));
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
      sku: schema.items.sku,
      itemName: schema.items.name,
    })
    .from(schema.cycleCountLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.cycleCountLines.itemId))
    .where(eq(schema.cycleCountLines.cycleCountId, id));
  return { ...row, lines };
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
      ),
    );

  if (onHand.length === 0) badRequest("That location has no on-hand rows to count");

  const id = newId();
  const lines = onHand.map((row) => ({
    id: newId(),
    cycleCountId: id,
    itemId: row.itemId,
    systemQty: row.qty,
    countedQty: row.qty,
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

  return c.json(await countWithLines(db, organizationId, id), 201);
});

floorRoute.post("/cycle-counts/:id/start", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const count = await countWithLines(db, organizationId, c.req.param("id"));
  if (count.status !== "draft") conflict("Cycle count is not a draft");
  await db.update(schema.cycleCounts).set({ status: "counting" }).where(eq(schema.cycleCounts.id, count.id));
  return c.json(await countWithLines(db, organizationId, count.id));
});

floorRoute.post("/cycle-counts/:id/post", async (c) => {
  const body = await c.req.json<{ lines?: { id?: string; countedQty?: number }[] }>().catch(() => ({
    lines: [] as { id?: string; countedQty?: number }[],
  }));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  const count = await countWithLines(db, organizationId, c.req.param("id"));
  if (!canPostCount(count.status)) conflict("Cycle count already posted");

  const countedById = new Map<string, number>();
  for (const line of body.lines ?? []) {
    if (!line.id) continue;
    countedById.set(line.id, requireInt(line.countedQty, "countedQty"));
  }

  const resolved = count.lines.map((line) => ({
    ...line,
    countedQty: countedById.has(line.id) ? countedById.get(line.id)! : line.countedQty,
  }));

  const loaded = await loadBalanceMap(
    db,
    organizationId,
    resolved.map((line) => ({ locationId: count.locationId, itemId: line.itemId })),
  );
  const current = qtyMap(loaded);
  const plan = planCycleCount({
    refId: count.id,
    locationId: count.locationId,
    balances: current,
    lines: resolved.map((line) => ({
      itemId: line.itemId,
      sku: line.sku,
      systemQty: current.get(`${count.locationId}:${line.itemId}`) ?? 0,
      countedQty: line.countedQty,
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
      ...resolved.map((line) =>
        db
          .update(schema.cycleCountLines)
          .set({ countedQty: line.countedQty })
          .where(eq(schema.cycleCountLines.id, line.id)),
      ),
      db
        .update(schema.cycleCounts)
        .set({ status: "posted", postedAt: now })
        .where(eq(schema.cycleCounts.id, count.id)),
    ],
  });

  return c.json(await countWithLines(db, organizationId, count.id));
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
    return { kind: "location" as const, location, contents };
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
    return { kind: "item" as const, item, onHand };
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
          sku: schema.items.sku,
          itemName: schema.items.name,
        })
        .from(schema.orderLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
        .where(eq(schema.orderLines.orderId, order.id));
      return { ...order, lines };
    })() });
    if (parsed.kind === "order") notFound("No order matches that barcode");
  }

  if (parsed.kind === "receipt" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.receipts).where(eq(schema.receipts.organizationId, organizationId));
    const receipt = await findByNumber(rows, parsed.value);
    if (receipt) return c.json({ kind: "receipt" as const, receipt });
    if (parsed.kind === "receipt") notFound("No receipt matches that barcode");
  }

  if (parsed.kind === "transfer" || parsed.kind === "unknown") {
    const rows = await db.select().from(schema.transfers).where(eq(schema.transfers.organizationId, organizationId));
    const transfer = await findByNumber(rows, parsed.value);
    if (transfer) return c.json({ kind: "transfer" as const, transfer });
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

  notFound("No location, item, or document matches that barcode");
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
  if (from.warehouseId !== to.warehouseId) badRequest("Locations must be in the same warehouse");

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

  const requested = body.lines?.length
    ? body.lines.map((line) => {
        const itemId = requireString(line.itemId, "itemId");
        const qty = typeof line.qty === "number" ? line.qty : Number(line.qty);
        if (!Number.isInteger(qty) || qty <= 0) badRequest("Move quantity must be a positive integer");
        const row = onHand.find((entry) => entry.itemId === itemId);
        if (!row) badRequest("Item is not in the from location");
        if (qty > row.qty) badRequest(`Only ${row.qty} of ${row.sku} in ${from.code}`);
        return { itemId, sku: row.sku, itemName: row.itemName, qty };
      })
    : onHand.map((row) => ({ itemId: row.itemId, sku: row.sku, itemName: row.itemName, qty: row.qty }));

  for (const line of requested) {
    await getOrgItem(db, organizationId, line.itemId);
  }

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

  return c.json({
    ok: true,
    refId,
    from: { id: from.id, code: from.code, name: from.name, barcode: from.barcode },
    to: { id: to.id, code: to.code, name: to.name, barcode: to.barcode },
    moved: requested,
  });
});
