import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { conflict, notFound } from "../lib/http";
import { invoiceMailText, isBillingEmail, type ActivityLine } from "../domain/billing";
import { loadActivityDrafts } from "../db/activity-billing";
import { sendPurchaseEmail } from "../lib/mail";

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

function overlaps(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start <= otherEnd && otherStart <= end;
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
  const existing = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, organizationId));
  const touched: string[] = [];
  for (const draft of drafts) {
    const issued = existing.some(
      (row) =>
        row.clientId === draft.clientId &&
        row.status === "issued" &&
        overlaps(periodStart, periodEnd, row.periodStart, row.periodEnd),
    );
    if (issued) continue;
    const draftsForClient = existing
      .filter((row) => row.clientId === draft.clientId && row.status === "draft")
      .sort((a, b) => b.createdAt - a.createdAt);
    const current = draftsForClient[0];
    if (current) {
      await db
        .update(schema.invoices)
        .set({
          periodStart,
          periodEnd,
          amountCents: draft.amountCents,
          linesJson: JSON.stringify(draft.lines),
        })
        .where(eq(schema.invoices.id, current.id));
      touched.push(current.id);
      continue;
    }
    const id = newId();
    touched.push(id);
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
  if (touched.length === 0) conflict("Issued invoices already cover this period", "NOTHING_TO_BILL");
  const invoices = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, organizationId))
    .orderBy(desc(schema.invoices.createdAt));
  const created = invoices.filter((row) => touched.includes(row.id));
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

billingRoute.post("/billing/invoices/:id/issue", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [invoice] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, c.req.param("id")), eq(schema.invoices.organizationId, organizationId)))
    .limit(1);
  if (!invoice) notFound("Invoice not found");
  if (invoice.status !== "draft") conflict("Invoice is already issued", "ALREADY_ISSUED");
  const [client] = invoice.clientId
    ? await db
        .select()
        .from(schema.clients)
        .where(and(eq(schema.clients.id, invoice.clientId), eq(schema.clients.organizationId, organizationId)))
        .limit(1)
    : [];
  const mailConfigured = Boolean(c.env.MAIL_API_KEY && c.env.MAIL_FROM);
  const now = Date.now();
  let emailedAt: number | null = null;
  if (mailConfigured) {
    if (!isBillingEmail(client?.billingEmail)) {
      conflict("Client has no billing email", "MAIL_ADDRESS");
    }
    const mail = invoiceMailText({
      number: invoice.number,
      clientName: client?.name ?? "Client",
      lines: parseLines(invoice.linesJson),
      amountCents: invoice.amountCents,
    });
    try {
      await sendPurchaseEmail({
        apiKey: c.env.MAIL_API_KEY!,
        from: c.env.MAIL_FROM!,
        to: client!.billingEmail!.trim(),
        subject: mail.subject,
        text: mail.text,
      });
    } catch {
      conflict("Could not email the invoice", "MAIL_FAILED");
    }
    emailedAt = now;
  }
  await db
    .update(schema.invoices)
    .set({ status: "issued", issuedAt: now, emailedAt })
    .where(eq(schema.invoices.id, invoice.id));
  const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoice.id)).limit(1);
  const clients = new Map(client ? [[client.id, { code: client.code, name: client.name }]] : []);
  return c.json(presentInvoice(row!, clients));
});
