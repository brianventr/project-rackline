import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { badRequest, conflict } from "../lib/http";
import { destPatchFromAddress } from "../domain/geo";
import { parseCrowdfundingCsv, resolveCrowdfundingRows } from "../domain/crowdfunding-import";
import { syncDocumentJob, orderJobInput } from "../db/jobs";
import { reserveOrderStock } from "../db/allocations";
import { scheduleOrderCreated } from "../db/outbound-webhooks";
import { ensureCustomer, ensureVendor } from "../db/parties";
import { parseStockyCsv } from "../domain/stocky-import";

export const importsRoute = new Hono<AppEnv>();

async function defaultWarehouseId(db: AppEnv["Variables"]["db"], organizationId: string, warehouseId?: string) {
  if (warehouseId) {
    const [row] = await db
      .select()
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
      .limit(1);
    if (!row) badRequest("Warehouse not found");
    return row.id;
  }
  const [row] = await db
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.organizationId, organizationId))
    .limit(1);
  if (!row) conflict("No warehouse in this organization", "NO_WAREHOUSE");
  return row.id;
}

importsRoute.post("/imports/crowdfunding/preview", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ csv?: string }>();
  const csv = typeof body.csv === "string" ? body.csv : "";
  const parsed = parseCrowdfundingCsv(csv);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const items = await db
    .select({ id: schema.items.id, sku: schema.items.sku })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));
  const skuMap = new Map(items.map((item) => [item.sku, item.id]));
  for (const item of items) skuMap.set(item.sku.toUpperCase(), item.id);
  const resolved = resolveCrowdfundingRows(parsed.rows, skuMap);
  return c.json({
    source: parsed.source,
    parseErrors: parsed.errors,
    rowCount: parsed.rows.length,
    orderCount: resolved.orders.length,
    missingSkus: resolved.missingSkus,
    sample: resolved.orders.slice(0, 5),
  });
});

importsRoute.post("/imports/crowdfunding", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    csv?: string;
    warehouseId?: string;
    createWave?: boolean;
    waveName?: string;
    allowMissingSkus?: boolean;
  }>();
  const csv = typeof body.csv === "string" ? body.csv : "";
  const parsed = parseCrowdfundingCsv(csv);
  if (parsed.errors.length && parsed.rows.length === 0) badRequest(parsed.errors.join("; "));

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = await defaultWarehouseId(db, organizationId, body.warehouseId);
  const items = await db
    .select({ id: schema.items.id, sku: schema.items.sku })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));
  const skuMap = new Map(items.map((item) => [item.sku, item.id]));
  for (const item of items) skuMap.set(item.sku.toUpperCase(), item.id);
  const resolved = resolveCrowdfundingRows(parsed.rows, skuMap);
  if (resolved.missingSkus.length && !body.allowMissingSkus) {
    conflict(`Unknown SKUs: ${resolved.missingSkus.join(", ")}`, "MISSING_SKUS");
  }
  if (resolved.orders.length === 0) badRequest("No importable orders after SKU resolution");

  let waveId: string | null = null;
  let waveNumber: string | null = null;
  if (body.createWave) {
    waveId = newId();
    waveNumber = docNumber("WAV");
    await db.insert(schema.waves).values({
      id: waveId,
      organizationId,
      warehouseId,
      number: waveNumber,
      mode: "batch",
      status: "open",
      createdAt: Date.now(),
      notes: body.waveName?.trim() || `Crowdfunding ${parsed.source}`,
    });
  }

  const created: { id: string; number: string }[] = [];
  const now = Date.now();
  for (const order of resolved.orders) {
    const id = newId();
    const number = docNumber("ORD");
    const source = `crowdfunding:${parsed.source}`;
    const lineRows = order.lines.map((line) => ({
      id: newId(),
      orderId: id,
      itemId: line.itemId,
      sku: line.sku,
      qty: line.qty,
      qtyPicked: 0,
    }));
    const customer = await ensureCustomer(db, organizationId, {
      name: order.customerName,
      email: order.email,
      address: order.shipToAddress,
    });
    await db.batch([
      db.insert(schema.orders).values({
        id,
        organizationId,
        warehouseId,
        number,
        customerName: order.customerName,
        customerId: customer.id,
        status: "open",
        createdAt: now,
        source,
        waveId,
        ...destPatchFromAddress(order.shipToAddress),
      }),
      ...lineRows.map((line) =>
        db.insert(schema.orderLines).values({
          id: line.id,
          orderId: line.orderId,
          itemId: line.itemId,
          qty: line.qty,
          qtyPicked: line.qtyPicked,
        }),
      ),
    ]);
    await syncDocumentJob(
      db,
      orderJobInput({
        id,
        organizationId,
        warehouseId,
        status: "open",
        number,
        customerName: order.customerName,
        source,
        createdAt: now,
      }),
    );
    await reserveOrderStock(db, {
      organizationId,
      warehouseId,
      orderId: id,
      clientId: null,
      lines: lineRows.map((line) => ({ id: line.id, itemId: line.itemId, sku: line.sku, qty: line.qty })),
    });
    scheduleOrderCreated(db, organizationId, {
      number,
      status: "open",
      city: destPatchFromAddress(order.shipToAddress).shipToCity,
      lines: lineRows.map((line) => ({ sku: line.sku, qty: line.qty })),
    });
    created.push({ id, number });
  }

  return c.json(
    {
      source: parsed.source,
      created: created.length,
      orders: created,
      waveId,
      waveNumber,
      missingSkus: resolved.missingSkus,
      parseErrors: parsed.errors,
    },
    201,
  );
});

importsRoute.post("/imports/stocky/preview", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ csv?: string }>().catch(() => ({}) as { csv?: string });
  const parsed = parseStockyCsv(typeof body.csv === "string" ? body.csv : "");
  return c.json({
    kind: parsed.kind,
    parseErrors: parsed.errors,
    purchaseCount: parsed.purchases.length,
    lineCount: parsed.purchases.reduce((sum, purchase) => sum + purchase.lines.length, 0),
    countCount: parsed.counts.length,
    suppliers: [...new Set(parsed.purchases.map((purchase) => purchase.supplier))],
  });
});

importsRoute.post("/imports/stocky", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{ csv?: string; warehouseId?: string }>().catch(() => ({}) as { csv?: string; warehouseId?: string });
  const parsed = parseStockyCsv(typeof body.csv === "string" ? body.csv : "");
  if (parsed.errors.length && parsed.purchases.length === 0 && parsed.counts.length === 0) badRequest(parsed.errors.join("; "));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const warehouseId = await defaultWarehouseId(db, organizationId, body.warehouseId);
  const items = await db
    .select({ id: schema.items.id, sku: schema.items.sku })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));
  const skuMap = new Map(items.map((item) => [item.sku.toUpperCase(), item.id]));
  const now = Date.now();

  async function itemFor(sku: string, name: string, unitCostCents: number | null): Promise<string> {
    const found = skuMap.get(sku.toUpperCase());
    if (found) return found;
    const id = newId();
    await db.insert(schema.items).values({
      id,
      organizationId,
      sku,
      name,
      type: "finished",
      barcode: sku,
      createdAt: now,
      unitCostCents: unitCostCents ?? 0,
    });
    skuMap.set(sku.toUpperCase(), id);
    return id;
  }

  const createdPurchases: { id: string; number: string }[] = [];
  for (const purchase of parsed.purchases) {
    const vendor = await ensureVendor(db, organizationId, { name: purchase.supplier });
    const id = newId();
    const number = purchase.poNumber || docNumber("PO");
    const lineRows = [];
    for (const line of purchase.lines) {
      if (line.qtyReceived >= line.qtyOrdered) continue;
      const itemId = await itemFor(line.sku, line.name, line.unitCostCents);
      lineRows.push({
        id: newId(),
        purchaseId: id,
        itemId,
        qtyOrdered: line.qtyOrdered,
        qtyReceived: Math.min(line.qtyReceived, line.qtyOrdered),
        unitCostCents: line.unitCostCents,
      });
    }
    if (lineRows.length === 0) continue;
    const received = lineRows.some((line) => line.qtyReceived > 0);
    await db.batch([
      db.insert(schema.purchases).values({
        id,
        organizationId,
        warehouseId,
        number,
        vendorName: vendor.name,
        vendorId: vendor.id,
        status: received ? "receiving" : "ordered",
        notes: `Imported from Stocky ${purchase.poNumber}`,
        createdAt: now,
        orderedAt: now,
      }),
      ...lineRows.map((line) => db.insert(schema.purchaseLines).values(line)),
    ]);
    await syncDocumentJob(db, {
      organizationId,
      warehouseId,
      refType: "purchase",
      status: received ? "receiving" : "ordered",
      refId: id,
      number,
      title: vendor.name,
      fromLocationId: null,
      createdAt: now,
    });
    createdPurchases.push({ id, number });
  }

  let count: { id: string; number: string } | null = null;
  if (parsed.counts.length) {
    const [dock] = await db
      .select({ id: schema.locations.id })
      .from(schema.locations)
      .where(and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.warehouseId, warehouseId)))
      .limit(1);
    if (!dock) conflict("Set up a bay before importing a stocktake", "NO_WAREHOUSE");
    const balances = await db
      .select({ itemId: schema.inventoryBalances.itemId, qty: schema.inventoryBalances.qty })
      .from(schema.inventoryBalances)
      .where(and(eq(schema.inventoryBalances.organizationId, organizationId), eq(schema.inventoryBalances.locationId, dock.id)));
    const onHand = new Map(balances.map((row) => [row.itemId, row.qty]));
    const id = newId();
    const number = docNumber("CC");
    const countLines = [];
    for (const line of parsed.counts) {
      const itemId = await itemFor(line.sku, line.name, null);
      countLines.push({
        id: newId(),
        cycleCountId: id,
        itemId,
        systemQty: onHand.get(itemId) ?? 0,
        countedQty: line.counted,
        entered: 1,
      });
    }
    await db.batch([
      db.insert(schema.cycleCounts).values({
        id,
        organizationId,
        warehouseId,
        number,
        status: "counting",
        locationId: dock.id,
        notes: "Imported from Stocky stocktake",
        createdAt: now,
      }),
      ...countLines.map((line) => db.insert(schema.cycleCountLines).values(line)),
    ]);
    count = { id, number };
  }

  if (createdPurchases.length === 0 && !count) badRequest(parsed.errors.join("; ") || "Nothing to import");
  return c.json({ kind: parsed.kind, purchases: createdPurchases, count, parseErrors: parsed.errors }, 201);
});
