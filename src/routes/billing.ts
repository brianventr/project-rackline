import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { badRequest, conflict } from "../lib/http";
import {
  ACTIVITY_RATES,
  parseBillingRates,
  serializeBillingRates,
  type ActivityLine,
  type BillingRates,
} from "../domain/billing";
import { loadActivityDrafts } from "../db/activity-billing";

export const billingRoute = new Hono<AppEnv>();

async function ensureBillingAccount(db: AppEnv["Variables"]["db"], organizationId: string, plan = "3pl") {
  const [existing] = await db
    .select()
    .from(schema.billingAccounts)
    .where(eq(schema.billingAccounts.organizationId, organizationId))
    .limit(1);
  if (existing) return existing;
  await db.insert(schema.billingAccounts).values({
    organizationId,
    plan,
    status: "active",
    createdAt: Date.now(),
    ratesJson: serializeBillingRates(ACTIVITY_RATES),
    portalToken: null,
  });
  const [row] = await db
    .select()
    .from(schema.billingAccounts)
    .where(eq(schema.billingAccounts.organizationId, organizationId))
    .limit(1);
  return row!;
}

function parseLines(value: string | null | undefined): ActivityLine[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ActivityLine[]) : [];
  } catch {
    return [];
  }
}

function presentInvoice(
  row: typeof schema.invoices.$inferSelect,
  clients: Map<string, { code: string; name: string }>,
) {
  const client = row.clientId ? clients.get(row.clientId) : undefined;
  return {
    ...row,
    lines: parseLines(row.linesJson),
    clientCode: client?.code ?? null,
    clientName: client?.name ?? null,
  };
}

billingRoute.get("/billing", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const account = await ensureBillingAccount(db, organizationId);
  const rates = parseBillingRates(account.ratesJson);
  const [invoices, clientRows] = await Promise.all([
    db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.organizationId, organizationId))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(50),
    db
      .select({ id: schema.clients.id, code: schema.clients.code, name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, organizationId)),
  ]);
  const clients = new Map(clientRows.map((row) => [row.id, row]));
  return c.json({
    account: {
      ...account,
      rates,
      portalEnabled: Boolean(account.portalToken),
    },
    invoices: invoices.map((row) => presentInvoice(row, clients)),
    clientCount: clientRows.length,
    rates,
    defaults: ACTIVITY_RATES,
    periodDays: 30,
  });
});

billingRoute.put("/billing/rates", async (c) => {
  requireOwner(c.get("role"));
  const body = await c.req.json<Partial<BillingRates>>();
  const rates: BillingRates = {
    storageCentsPerPiece:
      typeof body.storageCentsPerPiece === "number" ? Math.floor(body.storageCentsPerPiece) : ACTIVITY_RATES.storageCentsPerPiece,
    pickCentsPerUnit:
      typeof body.pickCentsPerUnit === "number" ? Math.floor(body.pickCentsPerUnit) : ACTIVITY_RATES.pickCentsPerUnit,
    cartonCents: typeof body.cartonCents === "number" ? Math.floor(body.cartonCents) : ACTIVITY_RATES.cartonCents,
  };
  if (rates.storageCentsPerPiece < 0 || rates.pickCentsPerUnit < 0 || rates.cartonCents < 0) {
    badRequest("Rates must be non-negative");
  }
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await ensureBillingAccount(db, organizationId);
  await db
    .update(schema.billingAccounts)
    .set({ ratesJson: serializeBillingRates(rates) })
    .where(eq(schema.billingAccounts.organizationId, organizationId));
  return c.json({ rates });
});

billingRoute.post("/billing/portal-token", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await ensureBillingAccount(db, organizationId);
  const token = `rlp_${newId().replace(/-/g, "").slice(0, 24)}`;
  await db
    .update(schema.billingAccounts)
    .set({ portalToken: token })
    .where(eq(schema.billingAccounts.organizationId, organizationId));
  return c.json({ portalToken: token });
});

billingRoute.post("/billing/invoices/generate", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const account = await ensureBillingAccount(db, organizationId);
  const rates = parseBillingRates(account.ratesJson);
  const now = Date.now();
  const { periodStart, periodEnd, drafts } = await loadActivityDrafts(db, organizationId, now, rates);
  if (drafts.length === 0) conflict("No client activity to bill for this period", "NOTHING_TO_BILL");
  const ids: string[] = [];
  for (const draft of drafts) {
    const id = newId();
    ids.push(id);
    await db.insert(schema.invoices).values({
      id,
      organizationId,
      clientId: draft.clientId,
      number: docNumber("INV"),
      periodStart,
      periodEnd,
      amountCents: draft.amountCents,
      status: "draft",
      linesJson: JSON.stringify(draft.lines),
      createdAt: now,
    });
  }
  const invoices = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, organizationId))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(50);
  const clientRows = await db
    .select({ id: schema.clients.id, code: schema.clients.code, name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, organizationId));
  const clients = new Map(clientRows.map((row) => [row.id, row]));
  return c.json({
    ids,
    count: ids.length,
    invoices: invoices.map((row) => presentInvoice(row, clients)),
  });
});

/** Public light client portal — invoice list by token (no session). */
export const billingPublicRoute = new Hono<AppEnv>();

billingPublicRoute.get("/billing/portal/:token", async (c) => {
  const db = c.get("db");
  const token = c.req.param("token");
  if (!token || token.length < 8) return c.json({ error: "Not found" }, 404);
  const [account] = await db
    .select()
    .from(schema.billingAccounts)
    .where(eq(schema.billingAccounts.portalToken, token))
    .limit(1);
  if (!account) return c.json({ error: "Not found" }, 404);
  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, account.organizationId))
    .limit(1);
  const invoices = await db
    .select({
      number: schema.invoices.number,
      amountCents: schema.invoices.amountCents,
      status: schema.invoices.status,
      periodStart: schema.invoices.periodStart,
      periodEnd: schema.invoices.periodEnd,
      createdAt: schema.invoices.createdAt,
      clientId: schema.invoices.clientId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, account.organizationId))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(50);
  const clients = await db
    .select({ id: schema.clients.id, code: schema.clients.code, name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, account.organizationId));
  const byId = new Map(clients.map((row) => [row.id, row]));
  return c.json({
    organizationName: org?.name ?? "Warehouse",
    invoices: invoices.map((row) => ({
      number: row.number,
      amountCents: row.amountCents,
      status: row.status,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      createdAt: row.createdAt,
      clientCode: row.clientId ? byId.get(row.clientId)?.code ?? null : null,
      clientName: row.clientId ? byId.get(row.clientId)?.name ?? null : null,
    })),
  });
});
