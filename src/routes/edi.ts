import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest } from "../lib/http";
import { docNumber, newId } from "../lib/ids";
import { EdiParseError, parseEdiAsnBody } from "../domain/edi";
import { getOrgItem, requireOwner } from "../lib/org";

export const ediRoute = new Hono<AppEnv>();

ediRoute.post("/edi/asn", async (c) => {
  requireOwner(c.get("role"));
  const raw = await c.req.json().catch(() => null);
  let payload;
  try {
    payload = parseEdiAsnBody(raw);
  } catch (err) {
    if (err instanceof EdiParseError) badRequest(err.message);
    throw err;
  }
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
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
  return c.json({ asn, inboxId }, 201);
});
