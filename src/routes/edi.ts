import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppDb } from "../db/stock";
import type { AppEnv } from "../lib/types";
import { badRequest, HttpError } from "../lib/http";
import { docNumber, newId } from "../lib/ids";
import { EdiParseError, parseEdiAsnBody } from "../domain/edi";
import { refusedPayloadJson, summarizeEdiPayload } from "../domain/edi-inbox";
import { getOrgItem, getOrgWarehouse, requireOwner } from "../lib/org";

export const ediRoute = new Hono<AppEnv>();

/** Newest first, capped so a chatty supplier cannot make the page slow. */
const INBOX_LIMIT = 200;

async function recordFailedAsn(db: AppDb, organizationId: string, raw: unknown, error: string) {
  try {
    await db.insert(schema.ediInbox).values({
      id: newId(),
      organizationId,
      kind: "asn",
      payloadJson: refusedPayloadJson(raw),
      status: "failed",
      createdAsnId: null,
      createdAt: Date.now(),
      error: error.slice(0, 500),
    });
  } catch (err) {
    console.error("edi inbox write failed", err);
  }
}

ediRoute.get("/edi/inbox", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      id: schema.ediInbox.id,
      kind: schema.ediInbox.kind,
      status: schema.ediInbox.status,
      createdAt: schema.ediInbox.createdAt,
      error: schema.ediInbox.error,
      createdAsnId: schema.ediInbox.createdAsnId,
      payloadJson: schema.ediInbox.payloadJson,
      asnNumber: schema.asns.number,
      asnVendorName: schema.asns.vendorName,
    })
    .from(schema.ediInbox)
    .leftJoin(
      schema.asns,
      and(eq(schema.asns.id, schema.ediInbox.createdAsnId), eq(schema.asns.organizationId, organizationId)),
    )
    .where(eq(schema.ediInbox.organizationId, organizationId))
    .orderBy(desc(schema.ediInbox.createdAt), desc(schema.ediInbox.id))
    .limit(INBOX_LIMIT);
  return c.json(
    rows.map((row) => {
      const payload = summarizeEdiPayload(row.payloadJson);
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        createdAt: row.createdAt,
        error: row.error,
        createdAsnId: row.createdAsnId,
        createdAsnNumber: row.asnNumber ?? null,
        vendorName: payload.vendorName ?? row.asnVendorName ?? null,
        reference: payload.reference,
        lineCount: payload.lineCount,
        lines: payload.lines,
      };
    }),
  );
});

ediRoute.post("/edi/asn", async (c) => {
  requireOwner(c.get("role"));
  const raw = await c.req.json().catch(() => null);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  let created;
  try {
    created = await ingestAsn(db, organizationId, raw);
  } catch (err) {
    // A refused ASN lands in the inbox too, so the owner can see what the supplier sent and why it
    // bounced. The response is the same error as before.
    if (err instanceof HttpError && err.status < 500) await recordFailedAsn(db, organizationId, raw, err.message);
    throw err;
  }
  return c.json(created, 201);
});

async function ingestAsn(db: AppDb, organizationId: string, raw: unknown) {
  let payload;
  try {
    payload = parseEdiAsnBody(raw);
  } catch (err) {
    if (err instanceof EdiParseError) badRequest(err.message);
    throw err;
  }
  await getOrgWarehouse(db, organizationId, payload.warehouseId);
  let clientId: string | null = null;
  if (payload.clientCode) {
    const [clientRow] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.organizationId, organizationId), eq(schema.clients.code, payload.clientCode)))
      .limit(1);
    if (!clientRow) badRequest("Client code not found");
    clientId = clientRow.id;
  }
  const itemRows = await db
    .select({ id: schema.items.id, sku: schema.items.sku })
    .from(schema.items)
    .where(eq(schema.items.organizationId, organizationId));
  const bySku = new Map(itemRows.map((row) => [row.sku.toUpperCase(), row.id]));
  const now = Date.now();
  const asnId = newId();
  const inboxId = newId();
  const asnLines = [];
  for (const line of payload.lines) {
    const itemId = bySku.get(line.sku);
    if (!itemId) badRequest(`SKU ${line.sku} not in catalog`);
    await getOrgItem(db, organizationId, itemId);
    asnLines.push({ id: newId(), asnId, itemId, qtyExpected: line.qty, qtyReceived: 0 });
  }
  await db.batch([
    db.insert(schema.asns).values({
      id: asnId,
      organizationId,
      warehouseId: payload.warehouseId,
      number: docNumber("ASN"),
      vendorName: payload.vendorName,
      status: "expected",
      clientId,
      notes: payload.reference,
      createdAt: now,
      expectedAt: now,
    }),
    ...asnLines.map((line) => db.insert(schema.asnLines).values(line)),
    db.insert(schema.ediInbox).values({
      id: inboxId,
      organizationId,
      kind: "asn",
      payloadJson: JSON.stringify(payload),
      status: "processed",
      createdAsnId: asnId,
      createdAt: now,
      error: null,
    }),
  ]);
  const [asn] = await db.select().from(schema.asns).where(eq(schema.asns.id, asnId)).limit(1);
  return { asn, inboxId };
}
