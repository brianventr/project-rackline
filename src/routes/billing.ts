import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";

export const billingRoute = new Hono<AppEnv>();

const FEE_PER_CLIENT_CENTS = 500;

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

billingRoute.get("/billing", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const account = await ensureBillingAccount(db, organizationId);
  const invoices = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.organizationId, organizationId))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(50);
  const [{ count: clientCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, organizationId));
  return c.json({
    account,
    invoices,
    clientCount,
    feePerClientCents: FEE_PER_CLIENT_CENTS,
  });
});

billingRoute.post("/billing/invoices/generate", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await ensureBillingAccount(db, organizationId);
  const [{ count: clientCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.clients)
    .where(eq(schema.clients.organizationId, organizationId));
  const now = Date.now();
  const periodEnd = now;
  const periodStart = now - 30 * 86_400_000;
  const amountCents = Number(clientCount) * FEE_PER_CLIENT_CENTS;
  const id = newId();
  await db.insert(schema.invoices).values({
    id,
    organizationId,
    number: docNumber("INV"),
    periodStart,
    periodEnd,
    amountCents,
    status: "draft",
    createdAt: now,
  });
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
  return c.json(invoice, 201);
});
