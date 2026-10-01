import { Hono } from "hono";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, requireString } from "../lib/http";
import { newId } from "../lib/ids";
import { isEmailAddress } from "../domain/purchase-mail";
import { lastCostByItem, parseCurrency, parseLeadTimeDays } from "../domain/parties";
import { isOpenPurchase } from "../domain/status";

export const vendorsRoute = new Hono<AppEnv>();

type VendorBody = {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  leadTimeDays?: number | string | null;
  currency?: string | null;
  notes?: string | null;
};

type VendorPatch = Partial<Omit<typeof schema.vendors.$inferInsert, "id" | "organizationId" | "createdAt">>;

function text(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/** Only the fields present in the body; blank text clears the field. */
function vendorPatch(body: VendorBody): VendorPatch {
  const patch: VendorPatch = {};
  if (body.name !== undefined) patch.name = requireString(body.name, "name");
  if (body.contactName !== undefined) patch.contactName = text(body.contactName);
  if (body.email !== undefined) {
    const email = text(body.email);
    if (email && !isEmailAddress(email)) badRequest("Vendor email must be a full address, like orders@vendor.com");
    patch.email = email;
  }
  if (body.phone !== undefined) patch.phone = text(body.phone);
  if (body.address !== undefined) patch.address = text(body.address);
  if (body.paymentTerms !== undefined) patch.paymentTerms = text(body.paymentTerms);
  if (body.leadTimeDays !== undefined) {
    const days = parseLeadTimeDays(body.leadTimeDays);
    if (days === "invalid") badRequest("Lead time must be whole days, 0 to 365");
    patch.leadTimeDays = days;
  }
  if (body.currency !== undefined) {
    const currency = parseCurrency(body.currency);
    if (!currency) badRequest("Currency must be a three-letter code, like USD");
    patch.currency = currency;
  }
  if (body.notes !== undefined) patch.notes = text(body.notes);
  return patch;
}

async function assertNameFree(db: AppEnv["Variables"]["db"], organizationId: string, name: string, exceptId?: string) {
  const [taken] = await db
    .select({ id: schema.vendors.id })
    .from(schema.vendors)
    .where(
      and(
        eq(schema.vendors.organizationId, organizationId),
        sql`lower(trim(${schema.vendors.name})) = lower(trim(${name}))`,
        exceptId ? ne(schema.vendors.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (taken) conflict(`A vendor named ${name} already exists`);
}

vendorsRoute.get("/vendors", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.vendors)
    .where(eq(schema.vendors.organizationId, organizationId))
    .orderBy(schema.vendors.name);
  const stats = await db
    .select({
      vendorId: schema.purchases.vendorId,
      purchases: sql<number>`count(*)`,
      open: sql<number>`sum(case when ${schema.purchases.status} in ('draft', 'ordered', 'receiving') then 1 else 0 end)`,
      lastAt: sql<number | null>`max(${schema.purchases.createdAt})`,
    })
    .from(schema.purchases)
    .where(eq(schema.purchases.organizationId, organizationId))
    .groupBy(schema.purchases.vendorId);
  const byVendor = new Map(stats.map((row) => [row.vendorId, row]));
  return c.json(
    rows.map((row) => {
      const stat = byVendor.get(row.id);
      return {
        ...row,
        purchaseCount: Number(stat?.purchases ?? 0),
        openPurchaseCount: Number(stat?.open ?? 0),
        lastPurchaseAt: stat?.lastAt ?? null,
      };
    }),
  );
});

vendorsRoute.post("/vendors", async (c) => {
  const body = await c.req.json<VendorBody>();
  const patch = vendorPatch({ ...body, name: requireString(body.name, "name") });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  await assertNameFree(db, organizationId, patch.name!);
  const now = Date.now();
  const [row] = await db
    .insert(schema.vendors)
    .values({ ...patch, id: newId(), organizationId, name: patch.name!, createdAt: now, updatedAt: now })
    .returning();
  return c.json(row, 201);
});

vendorsRoute.get("/vendors/:id", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [vendor] = await db
    .select()
    .from(schema.vendors)
    .where(and(eq(schema.vendors.id, c.req.param("id")), eq(schema.vendors.organizationId, organizationId)))
    .limit(1);
  if (!vendor) notFound("Vendor not found");
  const purchases = await db
    .select()
    .from(schema.purchases)
    .where(and(eq(schema.purchases.organizationId, organizationId), eq(schema.purchases.vendorId, vendor.id)))
    .orderBy(desc(schema.purchases.createdAt));
  const lines = purchases.length
    ? await db
        .select({
          purchaseId: schema.purchaseLines.purchaseId,
          itemId: schema.purchaseLines.itemId,
          qtyOrdered: schema.purchaseLines.qtyOrdered,
          qtyReceived: schema.purchaseLines.qtyReceived,
          unitCostCents: schema.purchaseLines.unitCostCents,
          sku: schema.items.sku,
          itemName: schema.items.name,
        })
        .from(schema.purchaseLines)
        .innerJoin(schema.items, eq(schema.items.id, schema.purchaseLines.itemId))
        .where(
          inArray(
            schema.purchaseLines.purchaseId,
            purchases.map((row) => row.id),
          ),
        )
    : [];
  const byPurchase = new Map(purchases.map((row) => [row.id, row]));
  const returns = await db
    .select()
    .from(schema.vendorReturns)
    .where(and(eq(schema.vendorReturns.organizationId, organizationId), eq(schema.vendorReturns.vendorId, vendor.id)))
    .orderBy(desc(schema.vendorReturns.createdAt));
  return c.json({
    vendor,
    purchases: purchases.map((row) => {
      const own = lines.filter((line) => line.purchaseId === row.id);
      return {
        ...row,
        open: isOpenPurchase(row.status),
        lineCount: own.length,
        unitsOrdered: own.reduce((sum, line) => sum + line.qtyOrdered, 0),
        unitsReceived: own.reduce((sum, line) => sum + line.qtyReceived, 0),
        totalCents: own.every((line) => line.unitCostCents != null)
          ? own.reduce((sum, line) => sum + line.qtyOrdered * (line.unitCostCents ?? 0), 0)
          : null,
      };
    }),
    lastCosts: lastCostByItem(
      lines.map((line) => {
        const purchase = byPurchase.get(line.purchaseId)!;
        return {
          itemId: line.itemId,
          sku: line.sku,
          itemName: line.itemName,
          unitCostCents: line.unitCostCents,
          qtyOrdered: line.qtyOrdered,
          purchaseId: purchase.id,
          purchaseNumber: purchase.number,
          at: purchase.createdAt,
        };
      }),
    ),
    vendorReturns: returns,
  });
});

vendorsRoute.patch("/vendors/:id", async (c) => {
  const body = await c.req.json<VendorBody>();
  const patch = vendorPatch(body);
  if (Object.keys(patch).length === 0) badRequest("No vendor fields to update");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [vendor] = await db
    .select()
    .from(schema.vendors)
    .where(and(eq(schema.vendors.id, c.req.param("id")), eq(schema.vendors.organizationId, organizationId)))
    .limit(1);
  if (!vendor) notFound("Vendor not found");
  if (patch.name) await assertNameFree(db, organizationId, patch.name, vendor.id);
  const [row] = await db
    .update(schema.vendors)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(schema.vendors.id, vendor.id))
    .returning();
  return c.json(row);
});
