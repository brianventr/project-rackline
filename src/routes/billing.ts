import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { conflict } from "../lib/http";
import { ACTIVITY_RATES, type ActivityLine } from "../domain/billing";
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
    account,
    invoices: invoices.map((row) => presentInvoice(row, clients)),
    clientCount: clientRows.length,
    rates: ACTIVITY_RATES,
    periodDays: 30,
  });
});

billingRoute.post("/billing/invoices/generate", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await ensureBillingAccount(db, organizationId);
  const now = Date.now();
  const { periodStart, periodEnd, drafts } = await loadActivityDrafts(db, organizationId, now);
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
      linesJson: JSON.stringify(draft.lines),
      status: "draft",
      createdAt: now,
    });
  }
  const invoices = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, organizationId))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(ids.length);
  const created = invoices.filter((row) => ids.includes(row.id));
  const clientRows = await db
    .select({ id: schema.clients.id, code: schema.clients.code, name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, organizationId));
  const clients = new Map(clientRows.map((row) => [row.id, row]));
  return c.json(
    { invoices: created.map((row) => presentInvoice(row, clients)) },
    201,
  );
});
