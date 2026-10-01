import { Hono } from "hono";
import { and, eq, gte, lte } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { buildValuationRows, cogsMovementsToCsv, invoicesToCsv, valuationToCsv, type InvoiceExportLine } from "../domain/accounting-export";

export const accountingRoute = new Hono<AppEnv>();

accountingRoute.get("/accounting/valuation.csv", async (c) => {
  requireOwner(c.get("role"));
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
  requireOwner(c.get("role"));
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
  requireOwner(c.get("role"));
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
  requireOwner(c.get("role"));
  return c.json({
    exports: [
      { id: "valuation", path: "/api/accounting/valuation.csv", label: "Inventory valuation (QBO/Xero CSV)" },
      { id: "invoices", path: "/api/accounting/invoices.csv", label: "Invoices (QBO/Xero CSV)" },
      { id: "cogs", path: "/api/accounting/cogs.csv", label: "COGS movements (30d default)" },
    ],
    note: "v1 is CSV export. Set unit cost on each SKU under Items. Valuation, invoices, and COGS download as CSV. Live QBO/Xero journal sync comes next.",
  });
});
