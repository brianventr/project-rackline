import { Hono } from "hono";
import { and, eq, gte, lte } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireBooks } from "../lib/org";
import { badRequest, conflict } from "../lib/http";
import { quickbooksBill, quickbooksConfigured } from "../domain/quickbooks";
import { credentialSecret } from "../lib/credential-secret";
import { openSecret, sealSecret } from "../lib/secret-box";
import { buildValuationRows, cogsMovementsToCsv, invoicesToCsv, valuationToCsv, type InvoiceExportLine } from "../domain/accounting-export";

export const accountingRoute = new Hono<AppEnv>();

accountingRoute.get("/accounting/valuation.csv", async (c) => {
  requireBooks(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select({
      sku: schema.items.sku,
      name: schema.items.name,
      locationCode: schema.locations.code,
      qty: schema.inventoryBalances.qty,
      unitCostCents: schema.items.unitCostCents,
    })
    .from(schema.inventoryBalances)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryBalances.itemId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
    .where(eq(schema.inventoryBalances.organizationId, organizationId));
  const valuation = buildValuationRows(rows);
  const asOf = new Date().toISOString().slice(0, 10);
  const csv = valuationToCsv(valuation, asOf);
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="rackline-valuation-${asOf}.csv"`,
  });
});

function parseInvoiceLines(value: string | null | undefined): InvoiceExportLine[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as InvoiceExportLine[]) : [];
  } catch {
    return [];
  }
}

accountingRoute.get("/accounting/invoices.csv", async (c) => {
  requireBooks(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [invoiceRows, clientRows] = await Promise.all([
    db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.organizationId, organizationId))
      .orderBy(schema.invoices.number),
    db
      .select({ id: schema.clients.id, code: schema.clients.code })
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, organizationId)),
  ]);
  const clients = new Map(clientRows.map((row) => [row.id, row.code]));
  const csv = invoicesToCsv(
    invoiceRows.map((row) => ({
      number: row.number,
      clientCode: row.clientId ? clients.get(row.clientId) ?? null : null,
      status: row.status,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      amountCents: row.amountCents,
      lines: parseInvoiceLines(row.linesJson),
    })),
  );
  const asOf = new Date().toISOString().slice(0, 10);
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="rackline-invoices-${asOf}.csv"`,
  });
});

accountingRoute.get("/accounting/cogs.csv", async (c) => {
  requireBooks(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const from = Number(c.req.query("from") || Date.now() - 30 * 86_400_000);
  const to = Number(c.req.query("to") || Date.now());
  const rows = await db
    .select({
      createdAt: schema.inventoryMovements.createdAt,
      sku: schema.items.sku,
      type: schema.inventoryMovements.type,
      qty: schema.inventoryMovements.qty,
      unitCostCents: schema.items.unitCostCents,
      refType: schema.inventoryMovements.refType,
      refId: schema.inventoryMovements.refId,
    })
    .from(schema.inventoryMovements)
    .innerJoin(schema.items, eq(schema.items.id, schema.inventoryMovements.itemId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        gte(schema.inventoryMovements.createdAt, from),
        lte(schema.inventoryMovements.createdAt, to),
      ),
    )
    .limit(5000);
  const csv = cogsMovementsToCsv(
    rows.map((row) => ({
      dateIso: new Date(row.createdAt).toISOString().slice(0, 10),
      sku: row.sku,
      movementType: row.type,
      qty: row.qty,
      unitCostCents: row.unitCostCents,
      amountCents: row.qty * row.unitCostCents,
      refType: row.refType,
      refId: row.refId,
    })),
  );
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="rackline-cogs.csv"`,
  });
});

accountingRoute.get("/accounting", async (c) => {
  requireBooks(c.get("role"));
  const [org] = await c
    .get("db")
    .select({
      qboRealmId: schema.organizations.qboRealmId,
      qboAccessToken: schema.organizations.qboAccessToken,
      qboExpenseAccountId: schema.organizations.qboExpenseAccountId,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, c.get("organizationId")!))
    .limit(1);
  return c.json({
    exports: [
      { id: "valuation", path: "/api/accounting/valuation.csv", label: "Inventory valuation (QBO/Xero CSV)" },
      { id: "invoices", path: "/api/accounting/invoices.csv", label: "Invoices (QBO/Xero CSV)" },
      { id: "cogs", path: "/api/accounting/cogs.csv", label: "COGS movements (30d default)" },
    ],
    note: "CSV is the fallback. Connect QuickBooks to send a received purchase as a bill. Set unit cost on each SKU, and freight on the purchase, so the bill matches what you paid.",
    quickbooks: quickbooksConfigured({
      realmId: org?.qboRealmId,
      accessToken: org?.qboAccessToken,
      expenseAccountId: org?.qboExpenseAccountId,
    }),
  });
});

accountingRoute.post("/accounting/quickbooks", async (c) => {
  requireBooks(c.get("role"));
  const body = await c.req.json<{ realmId?: string; accessToken?: string; expenseAccountId?: string }>().catch(() => ({}) as {
    realmId?: string;
    accessToken?: string;
    expenseAccountId?: string;
  });
  const realmId = body.realmId?.trim() ?? "";
  const accessToken = body.accessToken?.trim() ?? "";
  const expenseAccountId = body.expenseAccountId?.trim() ?? "";
  if (!realmId || !accessToken || !expenseAccountId) badRequest("Realm id, access token, and expense account id are required");
  const sealed = await sealSecret(credentialSecret(c.get("origin")), accessToken);
  if (!sealed) badRequest("Could not store the QuickBooks token");
  await c
    .get("db")
    .update(schema.organizations)
    .set({ qboRealmId: realmId, qboAccessToken: sealed, qboExpenseAccountId: expenseAccountId })
    .where(eq(schema.organizations.id, c.get("organizationId")!));
  return c.json({ quickbooks: true });
});

accountingRoute.post("/accounting/quickbooks/send", async (c) => {
  requireBooks(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
  const token = org ? await openSecret(credentialSecret(c.get("origin")), org.qboAccessToken) : null;
  if (!org || !quickbooksConfigured({ realmId: org.qboRealmId, accessToken: token, expenseAccountId: org.qboExpenseAccountId })) {
    conflict("QuickBooks is not connected. Download the CSV instead.", "QBO_UNAVAILABLE");
  }
  const purchases = await db
    .select()
    .from(schema.purchases)
    .where(and(eq(schema.purchases.organizationId, organizationId), eq(schema.purchases.status, "received")));
  const pending = purchases.filter((row) => !row.qboBillId);
  if (pending.length === 0) conflict("No received purchase is waiting to send. Download the CSV if you need the history.", "QBO_UNAVAILABLE");
  const sent: { number: string; billId: string }[] = [];
  for (const purchase of pending) {
    const lines = await db
      .select({
        sku: schema.items.sku,
        name: schema.items.name,
        qty: schema.purchaseLines.qtyReceived,
        unitCostCents: schema.purchaseLines.unitCostCents,
      })
      .from(schema.purchaseLines)
      .innerJoin(schema.items, eq(schema.items.id, schema.purchaseLines.itemId))
      .where(eq(schema.purchaseLines.purchaseId, purchase.id));
    const bill = quickbooksBill({
      vendorName: purchase.vendorName,
      docNumber: purchase.number,
      expenseAccountId: org.qboExpenseAccountId!,
      txnDate: new Date(purchase.receivedAt ?? purchase.createdAt).toISOString().slice(0, 10),
      freightCents: purchase.freightCents,
      lines: lines.map((line) => ({
        sku: line.sku,
        name: line.name,
        qty: line.qty,
        unitCostCents: line.unitCostCents ?? 0,
      })),
    });
    const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(org.qboRealmId!)}/bill`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bill),
    });
    const payload = (await res.json().catch(() => ({}))) as { Bill?: { Id?: string }; Fault?: { Error?: { Message?: string }[] } };
    if (!res.ok) {
      const message = payload.Fault?.Error?.[0]?.Message || `QuickBooks returned ${res.status}`;
      conflict(`${message} Download the CSV instead.`, "QBO_UNAVAILABLE");
    }
    const billId = payload.Bill?.Id ?? "sent";
    await db.update(schema.purchases).set({ qboBillId: billId }).where(eq(schema.purchases.id, purchase.id));
    sent.push({ number: purchase.number, billId });
  }
  return c.json({ sent });
});
