import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { badRequest, conflict } from "../lib/http";
import { destPatchFromAddress } from "../domain/geo";
import { groupChannelRows, parseChannelCsv, type ChannelKind } from "../domain/channel-import";
import { syncDocumentJob, orderJobInput } from "../db/jobs";

export const channelsRoute = new Hono<AppEnv>();

const CHANNELS: ChannelKind[] = ["etsy", "faire"];

function isChannel(value: string): value is ChannelKind {
  return CHANNELS.includes(value as ChannelKind);
}

async function ensureChannel(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  channel: ChannelKind,
  externalShop?: string | null,
) {
  const [existing] = await db
    .select()
    .from(schema.channelConnections)
    .where(
      and(eq(schema.channelConnections.organizationId, organizationId), eq(schema.channelConnections.channel, channel)),
    )
    .limit(1);
  if (existing) {
    if (externalShop !== undefined) {
      await db
        .update(schema.channelConnections)
        .set({ externalShop: externalShop || existing.externalShop, status: "active" })
        .where(eq(schema.channelConnections.id, existing.id));
    }
    return existing;
  }
  const id = newId();
  await db.insert(schema.channelConnections).values({
    id,
    organizationId,
    channel,
    status: "active",
    externalShop: externalShop || null,
    createdAt: Date.now(),
  });
  const [row] = await db.select().from(schema.channelConnections).where(eq(schema.channelConnections.id, id)).limit(1);
  return row!;
}

channelsRoute.get("/channels", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.channelConnections)
    .where(eq(schema.channelConnections.organizationId, organizationId));
  return c.json({
    channels: CHANNELS.map((channel) => {
      const row = rows.find((r) => r.channel === channel);
      return {
        channel,
        connected: Boolean(row),
        status: row?.status ?? "disconnected",
        externalShop: row?.externalShop ?? null,
        id: row?.id ?? null,
      };
    }),
  });
});

channelsRoute.put("/channels/:channel", async (c) => {
  requireOwner(c.get("role"));
  const channel = c.req.param("channel");
  if (!isChannel(channel)) badRequest("Channel must be etsy or faire");
  const body = await c.req.json<{ externalShop?: string; status?: string }>();
  const row = await ensureChannel(c.get("db"), c.get("organizationId")!, channel, body.externalShop?.trim() ?? null);
  if (body.status === "paused") {
    await c
      .get("db")
      .update(schema.channelConnections)
      .set({ status: "paused" })
      .where(eq(schema.channelConnections.id, row.id));
  }
  return c.json({ id: row.id, channel, connected: true });
});

channelsRoute.post("/channels/:channel/import", async (c) => {
  requireOwner(c.get("role"));
  const channel = c.req.param("channel");
  if (!isChannel(channel)) badRequest("Channel must be etsy or faire");
  const body = await c.req.json<{ csv?: string; warehouseId?: string }>();
  const parsed = parseChannelCsv(channel, typeof body.csv === "string" ? body.csv : "");
  if (parsed.errors.length && parsed.rows.length === 0) badRequest(parsed.errors.join("; "));

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await ensureChannel(db, organizationId, channel);

  let warehouseId = body.warehouseId;
  if (warehouseId) {
    const [wh] = await db
      .select()
      .from(schema.warehouses)
      .where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.organizationId, organizationId)))
      .limit(1);
    if (!wh) badRequest("Warehouse not found");
  } else {
    const [wh] = await db
      .select()
      .from(schema.warehouses)
      .where(eq(schema.warehouses.organizationId, organizationId))
      .limit(1);
    if (!wh) conflict("No warehouse", "NO_WAREHOUSE");
    warehouseId = wh.id;
  }

  const items = await db
    .select({ id: schema.items.id, sku: schema.items.sku })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));
  const skuMap = new Map<string, string>();
  for (const item of items) {
    skuMap.set(item.sku, item.id);
    skuMap.set(item.sku.toUpperCase(), item.id);
  }
  const groups = groupChannelRows(parsed.rows);
  const created: { id: string; number: string; externalId: string }[] = [];
  const missing = new Set<string>();
  const now = Date.now();

  for (const [externalId, group] of groups) {
    const orderId = newId();
    const lines: { id: string; orderId: string; itemId: string; qty: number; qtyPicked: number }[] = [];
    for (const row of group) {
      const itemId = skuMap.get(row.sku) ?? skuMap.get(row.sku.toUpperCase());
      if (!itemId) {
        missing.add(row.sku);
        continue;
      }
      lines.push({ id: newId(), orderId, itemId, qty: row.qty, qtyPicked: 0 });
    }
    if (lines.length === 0) continue;
    const number = docNumber("ORD");
    const customerName = group[0]!.customerName;
    const source = channel;
    await db.batch([
      db.insert(schema.orders).values({
        id: orderId,
        organizationId,
        warehouseId: warehouseId!,
        number,
        customerName,
        status: "open",
        createdAt: now,
        source,
        ...destPatchFromAddress(group[0]?.address),
      }),
      ...lines.map((line) => db.insert(schema.orderLines).values(line)),
    ]);
    await syncDocumentJob(
      db,
      orderJobInput({
        id: orderId,
        organizationId,
        warehouseId: warehouseId!,
        status: "open",
        number,
        customerName,
        source,
        createdAt: now,
      }),
    );
    created.push({ id: orderId, number, externalId });
  }

  if (created.length === 0) {
    if (missing.size) conflict(`Unknown SKUs: ${[...missing].join(", ")}`, "MISSING_SKUS");
    badRequest("No orders imported");
  }

  return c.json(
    {
      channel,
      created: created.length,
      orders: created,
      missingSkus: [...missing].sort(),
      parseErrors: parsed.errors,
    },
    201,
  );
});
