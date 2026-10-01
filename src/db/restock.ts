import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import {
  decideRestock,
  defaultTransitDays,
  freightEta,
  isTransitMode,
  learnedTransitDays,
  poolKey,
  poolLabel,
  restockGap,
  restockLead,
  RESTOCK_WINDOW_DAYS,
  type RestockPool,
  type TransitMode,
} from "../domain/restock";
import { docNumber, newId } from "../lib/ids";
import { effectiveRate, DAY_MS, type InboundReceipt } from "../domain/runway";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { loadRunway } from "./runway";

const OPEN_PO = ["draft", "ordered", "receiving"] as const;
const OPEN_ASN = ["draft", "expected", "receiving"] as const;

export type RestockNeed = {
  itemId: string;
  sku: string;
  name: string;
  warehouseId: string;
  pool: RestockPool;
  vendorId: string | null;
  vendorName: string | null;
  makeDays: number;
  transitDays: number;
  leadDays: number;
  learned: boolean;
  rate: number;
  sellable: number;
  suggestedQty: number;
  orderByAt: number | null;
  stockoutAt: number | null;
  gap: "make" | "transit";
};

type VendorLane = {
  id: string;
  name: string;
  makeDays: number | null;
  transitMode: TransitMode | null;
  transitDays: number | null;
  bufferDays: number | null;
};

export async function loadRestockNeeds(
  db: AppDb,
  organizationId: string,
  warehouseId: string,
  now = Date.now(),
): Promise<RestockNeed[]> {
  const lookback = now - RESTOCK_WINDOW_DAYS * DAY_MS;
  const runway = await loadRunway(db, organizationId, { warehouseId, window: "30d", multiplier: 1 });

  const [vendors, items, clients, balances, shipped, covers, inboundRows, learnedRows] = await Promise.all([
    db
      .select({
        id: schema.vendors.id,
        name: schema.vendors.name,
        makeDays: schema.vendors.makeDays,
        transitMode: schema.vendors.transitMode,
        transitDays: schema.vendors.transitDays,
        bufferDays: schema.vendors.bufferDays,
      })
      .from(schema.vendors)
      .where(eq(schema.vendors.organizationId, organizationId)),
    db
      .select({ id: schema.items.id, makeDays: schema.items.makeDays, baselineShipRate: schema.items.baselineShipRate })
      .from(schema.items)
      .where(eq(schema.items.organizationId, organizationId)),
    db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, organizationId)),
    db
      .select({
        itemId: schema.clientBalances.itemId,
        clientId: schema.clientBalances.clientId,
        qty: schema.clientBalances.qty,
      })
      .from(schema.clientBalances)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.clientBalances.locationId))
      .where(and(eq(schema.clientBalances.organizationId, organizationId), eq(schema.locations.warehouseId, warehouseId))),
    db
      .select({
        itemId: schema.orderLines.itemId,
        qty: schema.orderLines.qty,
        clientId: schema.orders.clientId,
      })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          eq(schema.orders.warehouseId, warehouseId),
          eq(schema.orders.status, "shipped"),
          gte(schema.orders.shippedAt, lookback),
          isNotNull(schema.orders.clientId),
        ),
      ),
    db
      .select({
        itemId: schema.purchaseLines.itemId,
        qtyOrdered: schema.purchaseLines.qtyOrdered,
        qtyReceived: schema.purchaseLines.qtyReceived,
        clientId: schema.purchases.clientId,
        vendorId: schema.purchases.vendorId,
      })
      .from(schema.purchaseLines)
      .innerJoin(schema.purchases, eq(schema.purchases.id, schema.purchaseLines.purchaseId))
      .where(
        and(
          eq(schema.purchases.organizationId, organizationId),
          eq(schema.purchases.warehouseId, warehouseId),
          inArray(schema.purchases.status, [...OPEN_PO]),
        ),
      ),
    db
      .select({
        itemId: schema.asnLines.itemId,
        qtyExpected: schema.asnLines.qtyExpected,
        qtyReceived: schema.asnLines.qtyReceived,
        clientId: schema.asns.clientId,
        expectedAt: schema.asns.expectedAt,
        eta: schema.asns.eta,
        departedAt: schema.asns.departedAt,
        createdAt: schema.asns.createdAt,
        orderedAt: schema.purchases.orderedAt,
        vendorId: schema.asns.vendorId,
      })
      .from(schema.asnLines)
      .innerJoin(schema.asns, eq(schema.asns.id, schema.asnLines.asnId))
      .leftJoin(schema.purchases, eq(schema.purchases.id, schema.asns.purchaseId))
      .where(
        and(
          eq(schema.asns.organizationId, organizationId),
          eq(schema.asns.warehouseId, warehouseId),
          inArray(schema.asns.status, [...OPEN_ASN]),
        ),
      ),
    db
      .select({
        vendorId: schema.asns.vendorId,
        departedAt: schema.asns.departedAt,
        receivedAt: schema.asns.receivedAt,
      })
      .from(schema.asns)
      .where(
        and(
          eq(schema.asns.organizationId, organizationId),
          isNotNull(schema.asns.departedAt),
          isNotNull(schema.asns.receivedAt),
          isNotNull(schema.asns.vendorId),
        ),
      ),
  ]);

  const vendorById = new Map<string, VendorLane>();
  for (const vendor of vendors) {
    vendorById.set(vendor.id, {
      ...vendor,
      transitMode: isTransitMode(vendor.transitMode) ? vendor.transitMode : null,
    });
  }
  const itemMake = new Map(items.map((item) => [item.id, item.makeDays]));
  const clientName = new Map(clients.map((client) => [client.id, client.name]));

  const clientQty = new Map<string, Map<string, number>>();
  for (const row of balances) {
    const byItem = clientQty.get(row.clientId) ?? new Map<string, number>();
    byItem.set(row.itemId, (byItem.get(row.itemId) ?? 0) + Math.max(0, row.qty));
    clientQty.set(row.clientId, byItem);
  }
  const clientShipped = new Map<string, Map<string, number>>();
  for (const row of shipped) {
    if (!row.clientId) continue;
    const byItem = clientShipped.get(row.clientId) ?? new Map<string, number>();
    byItem.set(row.itemId, (byItem.get(row.itemId) ?? 0) + row.qty);
    clientShipped.set(row.clientId, byItem);
  }

  const coverLeft = (clientId: string | null, itemId: string) => {
    let qty = 0;
    for (const row of covers) {
      if (row.itemId !== itemId) continue;
      if ((row.clientId ?? null) !== clientId) continue;
      qty += Math.max(0, row.qtyOrdered - row.qtyReceived);
    }
    return qty;
  };

  const learnedByVendor = new Map<string, number[]>();
  for (const row of learnedRows) {
    if (!row.vendorId || row.departedAt == null || row.receivedAt == null) continue;
    const days = (row.receivedAt - row.departedAt) / DAY_MS;
    if (days <= 0) continue;
    const list = learnedByVendor.get(row.vendorId) ?? [];
    list.push(days);
    learnedByVendor.set(row.vendorId, list);
  }

  const lastVendor = new Map<string, string>();
  const lastRows = await db
    .select({ itemId: schema.purchaseLines.itemId, vendorId: schema.purchases.vendorId, createdAt: schema.purchases.createdAt })
    .from(schema.purchaseLines)
    .innerJoin(schema.purchases, eq(schema.purchases.id, schema.purchaseLines.purchaseId))
    .where(and(eq(schema.purchases.organizationId, organizationId), eq(schema.purchases.warehouseId, warehouseId)))
    .orderBy(desc(schema.purchases.createdAt));
  for (const row of lastRows) {
    if (!row.vendorId || lastVendor.has(row.itemId)) continue;
    lastVendor.set(row.itemId, row.vendorId);
  }

  function inboundFor(clientId: string | null, itemId: string, vendor: VendorLane | null): InboundReceipt[] {
    const receipts: InboundReceipt[] = [];
    for (const row of inboundRows) {
      if (row.itemId !== itemId || (row.clientId ?? null) !== clientId) continue;
      const remaining = Math.max(0, row.qtyExpected - row.qtyReceived);
      if (remaining <= 0) continue;
      const lane = row.vendorId ? vendorById.get(row.vendorId) : vendor;
      const mode = lane?.transitMode ?? null;
      const at = mode
        ? freightEta({
            expectedAt: row.expectedAt,
            eta: row.eta,
            departedAt: row.departedAt,
            orderedAt: row.orderedAt,
            makeDays: lane?.makeDays ?? 0,
            transitDays: lane?.transitDays ?? defaultTransitDays(mode),
            fallbackAt: row.createdAt,
          }).at
        : (row.expectedAt ?? row.eta ?? row.createdAt);
      receipts.push({ at, qty: remaining });
    }
    const poQty = coverLeft(clientId, itemId);
    const asnQty = receipts.reduce((sum, row) => sum + row.qty, 0);
    const poNet = Math.max(0, poQty - asnQty);
    if (poNet > 0) {
      const lead = leadFor(vendor, itemMake.get(itemId) ?? null);
      receipts.push({ at: now + lead.leadDays * DAY_MS, qty: poNet });
    }
    return receipts;
  }

  function leadFor(vendor: VendorLane | null, itemMakeDays: number | null) {
    const samples = vendor ? learnedTransitDays(learnedByVendor.get(vendor.id) ?? []) : { days: null, count: 0 };
    return restockLead({
      laneSet: Boolean(vendor?.transitMode),
      makeDays: itemMakeDays ?? vendor?.makeDays ?? null,
      transitMode: vendor?.transitMode ?? null,
      transitDays: vendor?.transitDays ?? null,
      learnedTransitDays: samples.days,
      learnedSamples: samples.count,
      legacyLeadDays: 7,
    });
  }

  const needs: RestockNeed[] = [];
  const push = (input: {
    itemId: string;
    sku: string;
    name: string;
    pool: RestockPool;
    vendor: VendorLane | null;
    sellable: number;
    rate: number;
    legacyLeadDays: number;
  }) => {
    if (!(input.rate > 0)) return;
    const itemMakeDays = itemMake.get(input.itemId) ?? null;
    const samples = input.vendor ? learnedTransitDays(learnedByVendor.get(input.vendor.id) ?? []) : { days: null, count: 0 };
    const lead = restockLead({
      laneSet: Boolean(input.vendor?.transitMode),
      makeDays: itemMakeDays ?? input.vendor?.makeDays ?? null,
      transitMode: input.vendor?.transitMode ?? null,
      transitDays: input.vendor?.transitDays ?? null,
      learnedTransitDays: samples.days,
      learnedSamples: samples.count,
      legacyLeadDays: input.legacyLeadDays,
    });
    const clientId = input.pool.kind === "client" ? input.pool.clientId : null;
    const coveredQty = coverLeft(clientId, input.itemId);
    const inbound = inboundFor(clientId, input.itemId, input.vendor);
    const decision = decideRestock({
      asOf: now,
      rate: input.rate,
      sellable: input.sellable,
      inbound,
      leadDays: lead.leadDays,
      bufferDays: input.vendor?.bufferDays ?? undefined,
      covered: coveredQty > 0,
    });
    if (!decision.due) return;
    needs.push({
      itemId: input.itemId,
      sku: input.sku,
      name: input.name,
      warehouseId,
      pool: input.pool,
      vendorId: input.vendor?.id ?? null,
      vendorName: input.vendor?.name ?? null,
      makeDays: lead.makeDays,
      transitDays: lead.transitDays,
      leadDays: lead.leadDays,
      learned: lead.learned,
      rate: input.rate,
      sellable: input.sellable,
      suggestedQty: decision.suggestedQty,
      orderByAt: decision.orderByAt,
      stockoutAt: decision.stockoutAt,
      gap: restockGap(lead.makeDays, lead.transitDays),
    });
  };

  for (const row of runway.board.rows) {
    let clientOnHand = 0;
    let clientUnits = 0;
    for (const byItem of clientQty.values()) clientOnHand += byItem.get(row.itemId) ?? 0;
    for (const byItem of clientShipped.values()) clientUnits += byItem.get(row.itemId) ?? 0;
    const vendor = vendorById.get(lastVendor.get(row.itemId) ?? "") ?? null;
    const houseUnits = Math.max(0, row.unitsShipped - clientUnits);
    const houseRate = effectiveRate({
      observed: houseUnits / RESTOCK_WINDOW_DAYS,
      baseline: row.baselineRate,
      multiplier: 1,
    }).rate;
    push({
      itemId: row.itemId,
      sku: row.sku,
      name: row.name,
      pool: { kind: "house" },
      vendor,
      sellable: Math.max(0, row.sellable - clientOnHand),
      rate: houseRate > 0 ? houseRate : Math.max(0, row.burnRate - clientUnits / RESTOCK_WINDOW_DAYS),
      legacyLeadDays: Math.max(1, row.leadTimeMs / DAY_MS),
    });
  }

  for (const clientId of new Set([...clientQty.keys(), ...clientShipped.keys()])) {
    const name = clientName.get(clientId) ?? "Client";
    const byItem = clientQty.get(clientId) ?? new Map<string, number>();
    const shippedByItem = clientShipped.get(clientId) ?? new Map<string, number>();
    const itemIds = new Set([...byItem.keys(), ...shippedByItem.keys()]);
    for (const itemId of itemIds) {
      const row = runway.board.rows.find((line) => line.itemId === itemId);
      if (!row) continue;
      const vendor = vendorById.get(lastVendor.get(itemId) ?? "") ?? null;
      const units = shippedByItem.get(itemId) ?? 0;
      const rate = effectiveRate({
        observed: units / RESTOCK_WINDOW_DAYS,
        baseline: null,
        multiplier: 1,
      }).rate;
      push({
        itemId,
        sku: row.sku,
        name: row.name,
        pool: { kind: "client", clientId, clientName: name },
        vendor,
        sellable: byItem.get(itemId) ?? 0,
        rate,
        legacyLeadDays: Math.max(1, row.leadTimeMs / DAY_MS),
      });
    }
  }

  return needs.sort((a, b) => (a.orderByAt ?? 0) - (b.orderByAt ?? 0) || a.sku.localeCompare(b.sku));
}

export async function draftRestockPurchases(
  db: AppDb,
  organizationId: string,
  warehouseId: string,
  now = Date.now(),
): Promise<{ created: number; needs: RestockNeed[] }> {
  const needs = await loadRestockNeeds(db, organizationId, warehouseId, now);
  const groups = new Map<string, RestockNeed[]>();
  for (const need of needs) {
    if (!need.vendorId) continue;
    const key = `${need.vendorId}:${poolKey(need.pool)}`;
    const list = groups.get(key) ?? [];
    list.push(need);
    groups.set(key, list);
  }
  let created = 0;
  for (const lines of groups.values()) {
    const first = lines[0]!;
    const id = newId();
    const itemRows = await db
      .select({ id: schema.items.id, unitCostCents: schema.items.unitCostCents })
      .from(schema.items)
      .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, lines.map((line) => line.itemId))));
    const cost = new Map(itemRows.map((row) => [row.id, row.unitCostCents]));
    await db.batch([
      db.insert(schema.purchases).values({
        id,
        organizationId,
        warehouseId,
        number: docNumber("PO"),
        vendorName: first.vendorName ?? "Vendor",
        vendorId: first.vendorId,
        clientId: first.pool.kind === "client" ? first.pool.clientId : null,
        status: "draft",
        notes: `Drafted from the restock forecast for ${poolLabel(first.pool)}. Not sent.`,
        createdAt: now,
      }),
      ...lines.map((line) =>
        db.insert(schema.purchaseLines).values({
          id: newId(),
          purchaseId: id,
          itemId: line.itemId,
          qtyOrdered: line.suggestedQty,
          qtyReceived: 0,
          unitCostCents: cost.get(line.itemId) ?? null,
        }),
      ),
    ]);
    created += 1;
  }
  return { created, needs };
}

export async function runRestockCron(db: AppDb, now = Date.now()): Promise<{ drafted: number }> {
  const orgs = await db
    .select({ id: schema.organizations.id, restockPolicy: schema.organizations.restockPolicy })
    .from(schema.organizations);
  let drafted = 0;
  for (const org of orgs) {
    if (org.restockPolicy !== "draft") continue;
    const warehouses = await db
      .select({ id: schema.warehouses.id })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.organizationId, org.id));
    for (const warehouse of warehouses) {
      try {
        const result = await draftRestockPurchases(db, org.id, warehouse.id, now);
        drafted += result.created;
      } catch (err) {
        console.error("restock draft failed", org.id, warehouse.id, err);
      }
    }
  }
  return { drafted };
}

