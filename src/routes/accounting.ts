import { Hono } from "hono";
import { and, eq, gte, lte } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { buildValuationRows, cogsMovementsToCsv, valuationToCsv } from "../domain/accounting-export";

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
      { id: "cogs", path: "/api/accounting/cogs.csv", label: "COGS movements (30d default)" },
    ],
    note: "v1 is CSV export. Set unit cost on each SKU under Items. Live QBO/Xero journal sync comes next.",
  });
});
