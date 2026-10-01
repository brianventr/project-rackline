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
import { ensureCustomer } from "../db/parties";

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
      ...lineRows.map((line) => db.insert(schema.orderLines).values(line)),
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
