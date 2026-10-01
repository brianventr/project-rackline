import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { notFound } from "../lib/http";
import {
  cleanEmail,
  customerFill,
  matchCustomer,
  parseChannelRefs,
  type CustomerCandidate,
  type IncomingCustomer,
} from "../domain/parties";

export type VendorRef = { id: string; name: string; email: string | null };
export type CustomerRef = { id: string; name: string };

async function vendorByName(db: AppDb, organizationId: string, name: string) {
  const [row] = await db
    .select({ id: schema.vendors.id, name: schema.vendors.name, email: schema.vendors.email })
    .from(schema.vendors)
    .where(and(eq(schema.vendors.organizationId, organizationId), sql`lower(trim(${schema.vendors.name})) = lower(trim(${name}))`))
    .limit(1);
  return row ?? null;
}

/** The vendor a document is for: the picked record, else the one with this name, else a new one. */
export async function ensureVendor(
  db: AppDb,
  organizationId: string,
  input: { vendorId?: string | null; name?: string | null },
): Promise<VendorRef> {
  if (input.vendorId) {
    const [row] = await db
      .select({ id: schema.vendors.id, name: schema.vendors.name, email: schema.vendors.email })
      .from(schema.vendors)
      .where(and(eq(schema.vendors.id, input.vendorId), eq(schema.vendors.organizationId, organizationId)))
      .limit(1);
    if (!row) notFound("Vendor not found");
    return row;
  }
  const name = input.name?.trim() ?? "";
  const found = await vendorByName(db, organizationId, name);
  if (found) return found;
  const now = Date.now();
  await db
    .insert(schema.vendors)
    .values({ id: newId(), organizationId, name, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  const created = await vendorByName(db, organizationId, name);
  if (!created) notFound("Vendor not found");
  return created;
}

function asCandidate(row: typeof schema.customers.$inferSelect): CustomerCandidate {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    shipToAddress: row.shipToAddress,
    channelRefs: parseChannelRefs(row.channelRefsJson),
    updatedAt: row.updatedAt,
  };
}

async function customerCandidates(db: AppDb, organizationId: string, incoming: IncomingCustomer) {
  const email = cleanEmail(incoming.email);
  const ref = incoming.channelRef;
  const matches = [sql`lower(trim(${schema.customers.name})) = lower(trim(${incoming.name}))`];
  if (email) matches.push(sql`lower(trim(${schema.customers.email})) = lower(${email})`);
  if (ref) {
    matches.push(
      sql`exists (select 1 from json_each(coalesce(${schema.customers.channelRefsJson}, '[]')) j where json_extract(j.value, '$.channel') = ${ref.channel} and json_extract(j.value, '$.ref') = ${ref.ref})`,
    );
  }
  return db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.organizationId, organizationId), or(...matches)));
}

/**
 * The customer an order or return is for: the picked record, else a match by channel id, email, or
 * name and address (`matchCustomer`), else a new record. A match picks up an email, ship-to, or
 * channel id it did not have yet.
 */
export async function ensureCustomer(
  db: AppDb,
  organizationId: string,
  input: IncomingCustomer & { customerId?: string | null; phone?: string | null },
): Promise<CustomerRef> {
  if (input.customerId) {
    const [row] = await db
      .select({ id: schema.customers.id, name: schema.customers.name })
      .from(schema.customers)
      .where(and(eq(schema.customers.id, input.customerId), eq(schema.customers.organizationId, organizationId)))
      .limit(1);
    if (!row) notFound("Customer not found");
    return row;
  }
  const incoming: IncomingCustomer = { ...input, name: input.name.trim() };
  const rows = await customerCandidates(db, organizationId, incoming);
  const match = matchCustomer(rows.map(asCandidate), incoming);
  const now = Date.now();
  if (match) {
    const row = rows.find((candidate) => candidate.id === match.id)!;
    const patch = customerFill(asCandidate(row), incoming);
    if (Object.keys(patch).length > 0) {
      await db
        .update(schema.customers)
        .set({ ...patch, updatedAt: now })
        .where(eq(schema.customers.id, row.id))
        .catch(() => undefined);
    }
    return { id: row.id, name: row.name };
  }
  const email = cleanEmail(incoming.email);
  const id = newId();
  const inserted = await db
    .insert(schema.customers)
    .values({
      id,
      organizationId,
      name: incoming.name || email || "Customer",
      email,
      phone: input.phone?.trim() || null,
      shipToAddress: incoming.address?.trim() || null,
      channelRefsJson: incoming.channelRef ? JSON.stringify([incoming.channelRef]) : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: schema.customers.id, name: schema.customers.name });
  if (inserted[0]) return inserted[0];
  // Lost a race on the email index: the other request made the same customer.
  const [raced] = await db
    .select({ id: schema.customers.id, name: schema.customers.name })
    .from(schema.customers)
    .where(and(eq(schema.customers.organizationId, organizationId), sql`lower(trim(${schema.customers.email})) = lower(${email})`))
    .limit(1);
  if (!raced) notFound("Customer not found");
  return raced;
}

/**
 * Link one organization's documents to vendor and customer records by name, creating a record per
 * distinct name (the same pass as `drizzle/0048_vendors_customers.sql`, for data written by code
 * that only sets names, like the demo seed).
 */
export async function backfillParties(db: AppDb, organizationId: string): Promise<void> {
  const now = Date.now();
  const statements = [
    sql`insert into vendors (id, organization_id, name, currency, created_at, updated_at)
      select lower(hex(randomblob(16))), organization_id, trim(vendor_name), 'USD', ${now}, ${now}
      from (
        select organization_id, vendor_name from purchases where organization_id = ${organizationId} and vendor_id is null
        union all select organization_id, vendor_name from vendor_returns where organization_id = ${organizationId} and vendor_id is null
        union all select organization_id, vendor_name from asns where organization_id = ${organizationId} and vendor_id is null
      ) names
      where trim(vendor_name) != ''
        and not exists (select 1 from vendors v where v.organization_id = names.organization_id and lower(trim(v.name)) = lower(trim(names.vendor_name)))
      group by organization_id, lower(trim(vendor_name))`,
    ...(["purchases", "vendor_returns", "asns"] as const).map(
      (table) => sql`update ${sql.identifier(table)} set vendor_id = (
        select v.id from vendors v
        where v.organization_id = ${sql.identifier(table)}.organization_id and lower(trim(v.name)) = lower(trim(${sql.identifier(table)}.vendor_name))
      ) where organization_id = ${organizationId} and vendor_id is null`,
    ),
    sql`insert into customers (id, organization_id, name, created_at, updated_at)
      select lower(hex(randomblob(16))), organization_id, trim(customer_name), ${now}, ${now}
      from (
        select organization_id, customer_name from orders where organization_id = ${organizationId} and customer_id is null
        union all select organization_id, customer_name from rmas where organization_id = ${organizationId} and customer_id is null
      ) names
      where trim(customer_name) != ''
        and not exists (select 1 from customers c where c.organization_id = names.organization_id and lower(trim(c.name)) = lower(trim(names.customer_name)))
      group by organization_id, lower(trim(customer_name))`,
    sql`update customers set ship_to_address = (
        select o.ship_to_address from orders o
        where o.organization_id = customers.organization_id and lower(trim(o.customer_name)) = lower(trim(customers.name))
          and trim(coalesce(o.ship_to_address, '')) != ''
        order by o.created_at desc limit 1
      ) where organization_id = ${organizationId} and ship_to_address is null`,
    sql`update orders set customer_id = (
        select c.id from customers c
        where c.organization_id = orders.organization_id and lower(trim(c.name)) = lower(trim(orders.customer_name))
        order by c.created_at limit 1
      ) where organization_id = ${organizationId} and customer_id is null`,
    sql`update rmas set customer_id = coalesce(
        (select o.customer_id from orders o where o.id = rmas.order_id),
        (select c.id from customers c
         where c.organization_id = rmas.organization_id and lower(trim(c.name)) = lower(trim(rmas.customer_name))
         order by c.created_at limit 1)
      ) where organization_id = ${organizationId} and customer_id is null`,
  ];
  for (const statement of statements) await db.run(statement);
}

/** Each item's last recorded price from this vendor. */
export async function vendorLastCosts(
  db: AppDb,
  organizationId: string,
  vendorId: string,
  itemIds: string[],
): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db
    .select({ itemId: schema.purchaseLines.itemId, unitCostCents: schema.purchaseLines.unitCostCents })
    .from(schema.purchaseLines)
    .innerJoin(schema.purchases, eq(schema.purchases.id, schema.purchaseLines.purchaseId))
    .where(
      and(
        eq(schema.purchases.organizationId, organizationId),
        eq(schema.purchases.vendorId, vendorId),
        inArray(schema.purchaseLines.itemId, itemIds),
        isNotNull(schema.purchaseLines.unitCostCents),
      ),
    )
    .orderBy(desc(schema.purchases.createdAt));
  const costs = new Map<string, number>();
  for (const row of rows) if (!costs.has(row.itemId) && row.unitCostCents != null) costs.set(row.itemId, row.unitCostCents);
  return costs;
}
