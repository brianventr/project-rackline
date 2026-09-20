import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import type { AppDb } from "../db/stock";
import { badRequest, notFound, requireString } from "../lib/http";
import { requireOwner } from "../lib/org";
import { newId } from "../lib/ids";

export const printersRoute = new Hono<AppEnv>();

const CONNECTIONS = new Set(["browser", "qz", "download"]);
const MEDIA = new Set(["letter", "4x6", "2x1"]);
const JOB_KINDS = new Set(["bay", "item", "pack-slip", "shipping-label", "sheet", "equipment"]);
const PAYLOAD_FORMATS = new Set(["html", "zpl"]);
const JOB_STATUSES = new Set(["queued", "sent", "failed"]);

function mapPrinter(row: typeof schema.printers.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    connection: row.connection,
    media: row.media,
    dpi: row.dpi,
    qzPrinterName: row.qzPrinterName,
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt,
  };
}

function mapStation(row: typeof schema.printStations.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    warehouseId: row.warehouseId,
    defaultPrinterId: row.defaultPrinterId,
    bayPrinterId: row.bayPrinterId,
    shippingPrinterId: row.shippingPrinterId,
    createdAt: row.createdAt,
  };
}

async function ensureDefaultPrinters(db: AppDb, organizationId: string) {
  const existing = await db.select().from(schema.printers).where(eq(schema.printers.organizationId, organizationId));
  if (existing.length) return existing;
  const now = Date.now();
  const browserId = newId();
  const downloadId = newId();
  const stationId = newId();
  await db.insert(schema.printers).values({
    id: browserId,
    organizationId,
    name: "Browser (HTML)",
    connection: "browser",
    media: "letter",
    dpi: 203,
    isDefault: 1,
    createdAt: now,
  });
  await db.insert(schema.printers).values({
    id: downloadId,
    organizationId,
    name: "ZPL download",
    connection: "download",
    media: "4x6",
    dpi: 203,
    isDefault: 0,
    createdAt: now,
  });
  await db.insert(schema.printStations).values({
    id: stationId,
    organizationId,
    name: "Front desk",
    warehouseId: null,
    defaultPrinterId: browserId,
    bayPrinterId: browserId,
    shippingPrinterId: downloadId,
    createdAt: now,
  });
  return db.select().from(schema.printers).where(eq(schema.printers.organizationId, organizationId));
}

printersRoute.get("/printers", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await ensureDefaultPrinters(db, organizationId);
  return c.json(rows.map(mapPrinter));
});

printersRoute.post("/printers", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    name?: string;
    connection?: string;
    media?: string;
    dpi?: number;
    qzPrinterName?: string;
    isDefault?: boolean;
  }>();
  const name = requireString(body.name, "name");
  const connection = (body.connection?.trim() || "browser").toLowerCase();
  const media = (body.media?.trim() || "letter").toLowerCase();
  if (!CONNECTIONS.has(connection)) badRequest("connection must be browser, qz, or download");
  if (!MEDIA.has(media)) badRequest("media must be letter, 4x6, or 2x1");
  const dpi = body.dpi === 300 ? 300 : 203;
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const now = Date.now();
  const id = newId();
  const isDefault = body.isDefault ? 1 : 0;
  if (isDefault) {
    await db
      .update(schema.printers)
      .set({ isDefault: 0 })
      .where(eq(schema.printers.organizationId, organizationId));
  }
  await db.insert(schema.printers).values({
    id,
    organizationId,
    name,
    connection,
    media,
    dpi,
    qzPrinterName: body.qzPrinterName?.trim() || null,
    isDefault,
    createdAt: now,
  });
  const [row] = await db.select().from(schema.printers).where(eq(schema.printers.id, id)).limit(1);
  return c.json(mapPrinter(row!), 201);
});

printersRoute.patch("/printers/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = c.req.param("id");
  const [existing] = await db
    .select()
    .from(schema.printers)
    .where(and(eq(schema.printers.id, id), eq(schema.printers.organizationId, organizationId)))
    .limit(1);
  if (!existing) notFound("Printer not found");
  const body = await c.req.json<{
    name?: string;
    connection?: string;
    media?: string;
    dpi?: number;
    qzPrinterName?: string | null;
    isDefault?: boolean;
  }>();
  const patch: Partial<typeof schema.printers.$inferInsert> = {};
  if (body.name !== undefined) patch.name = requireString(body.name, "name");
  if (body.connection !== undefined) {
    const connection = body.connection.trim().toLowerCase();
    if (!CONNECTIONS.has(connection)) badRequest("connection must be browser, qz, or download");
    patch.connection = connection;
  }
  if (body.media !== undefined) {
    const media = body.media.trim().toLowerCase();
    if (!MEDIA.has(media)) badRequest("media must be letter, 4x6, or 2x1");
    patch.media = media;
  }
  if (body.dpi !== undefined) patch.dpi = body.dpi === 300 ? 300 : 203;
  if (body.qzPrinterName !== undefined) patch.qzPrinterName = body.qzPrinterName?.trim() || null;
  if (body.isDefault === true) {
    await db
      .update(schema.printers)
      .set({ isDefault: 0 })
      .where(eq(schema.printers.organizationId, organizationId));
    patch.isDefault = 1;
  } else if (body.isDefault === false) {
    patch.isDefault = 0;
  }
  const [row] = await db.update(schema.printers).set(patch).where(eq(schema.printers.id, id)).returning();
  return c.json(mapPrinter(row!));
});

printersRoute.delete("/printers/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = c.req.param("id");
  const [existing] = await db
    .select()
    .from(schema.printers)
    .where(and(eq(schema.printers.id, id), eq(schema.printers.organizationId, organizationId)))
    .limit(1);
  if (!existing) notFound("Printer not found");
  await db.delete(schema.printers).where(eq(schema.printers.id, id));
  return c.json({ ok: true });
});

printersRoute.get("/print-stations", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.printStations)
    .where(eq(schema.printStations.organizationId, organizationId));
  return c.json(rows.map(mapStation));
});

printersRoute.post("/print-stations", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<{
    name?: string;
    warehouseId?: string | null;
    defaultPrinterId?: string | null;
    bayPrinterId?: string | null;
    shippingPrinterId?: string | null;
  }>();
  const name = requireString(body.name, "name");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = newId();
  await db.insert(schema.printStations).values({
    id,
    organizationId,
    name,
    warehouseId: body.warehouseId || null,
    defaultPrinterId: body.defaultPrinterId || null,
    bayPrinterId: body.bayPrinterId || null,
    shippingPrinterId: body.shippingPrinterId || null,
    createdAt: Date.now(),
  });
  const [row] = await db.select().from(schema.printStations).where(eq(schema.printStations.id, id)).limit(1);
  return c.json(mapStation(row!), 201);
});

printersRoute.patch("/print-stations/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = c.req.param("id");
  const [existing] = await db
    .select()
    .from(schema.printStations)
    .where(and(eq(schema.printStations.id, id), eq(schema.printStations.organizationId, organizationId)))
    .limit(1);
  if (!existing) notFound("Print station not found");
  const body = await c.req.json<{
    name?: string;
    warehouseId?: string | null;
    defaultPrinterId?: string | null;
    bayPrinterId?: string | null;
    shippingPrinterId?: string | null;
  }>();
  const patch: Partial<typeof schema.printStations.$inferInsert> = {};
  if (body.name !== undefined) patch.name = requireString(body.name, "name");
  if (body.warehouseId !== undefined) patch.warehouseId = body.warehouseId || null;
  if (body.defaultPrinterId !== undefined) patch.defaultPrinterId = body.defaultPrinterId || null;
  if (body.bayPrinterId !== undefined) patch.bayPrinterId = body.bayPrinterId || null;
  if (body.shippingPrinterId !== undefined) patch.shippingPrinterId = body.shippingPrinterId || null;
  const [row] = await db.update(schema.printStations).set(patch).where(eq(schema.printStations.id, id)).returning();
  return c.json(mapStation(row!));
});

printersRoute.get("/print-jobs", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const limit = Math.min(Number(c.req.query("limit") || 25), 100);
  const rows = await db
    .select()
    .from(schema.printJobs)
    .where(eq(schema.printJobs.organizationId, organizationId))
    .orderBy(desc(schema.printJobs.createdAt))
    .limit(limit);
  return c.json(rows);
});

printersRoute.post("/print-jobs", async (c) => {
  const body = await c.req.json<{
    printerId?: string | null;
    stationId?: string | null;
    kind?: string;
    payloadFormat?: string;
    status?: string;
    refType?: string | null;
    refId?: string | null;
    error?: string | null;
  }>();
  const kind = requireString(body.kind, "kind");
  const payloadFormat = requireString(body.payloadFormat, "payloadFormat");
  const status = requireString(body.status, "status");
  if (!JOB_KINDS.has(kind)) badRequest("Unknown print job kind");
  if (!PAYLOAD_FORMATS.has(payloadFormat)) badRequest("payloadFormat must be html or zpl");
  if (!JOB_STATUSES.has(status)) badRequest("status must be queued, sent, or failed");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const id = newId();
  const now = Date.now();
  await db.insert(schema.printJobs).values({
    id,
    organizationId,
    printerId: body.printerId || null,
    stationId: body.stationId || null,
    kind,
    payloadFormat,
    status,
    refType: body.refType || null,
    refId: body.refId || null,
    error: body.error || null,
    createdAt: now,
    sentAt: status === "sent" ? now : null,
  });
  const [row] = await db.select().from(schema.printJobs).where(eq(schema.printJobs.id, id)).limit(1);
  return c.json(row, 201);
});
