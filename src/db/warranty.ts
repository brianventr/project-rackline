import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId, docNumber } from "../lib/ids";
import { isUniqueViolation } from "../lib/db-errors";
import { WarrantyError } from "../domain/warranty";
import {
  KLAVIYO_METRICS,
  SHOPIFY_METAFIELDS_SET,
  assignmentIdsToStamp,
  inheritWarranty,
  klaviyoEventBody,
  normalizeSerialCode,
  refurbTarget,
  serialsForPack,
  shopifySerialMetafields,
  warrantyFromTerm,
  type SerialFallbackRow,
} from "../domain/warranty";
import { openSecret } from "../lib/secret-box";
import { credentialSecret } from "../lib/credential-secret";
import { openShopifyRow } from "./credentials";
import { createShopifyGraphqlClient } from "../lib/shopify-client";
import { syncDocumentJob, orderJobInput } from "./jobs";

type PackLine = {
  lineId: string;
  itemId: string;
  sku: string;
  qty: number;
  trackSerial: boolean;
  serials: string[];
};

export async function assignPackedSerials(
  db: AppDb,
  input: {
    organizationId: string;
    userId: string;
    orderId: string;
    now: number;
    lines: PackLine[];
  },
): Promise<string[]> {
  const created: string[] = [];
  for (const line of input.lines) {
    const serials = serialsForPack({ qty: line.qty, trackSerial: line.trackSerial, serials: line.serials });
    for (const serialCode of serials) {
      const assignmentId = await assignOne(db, { ...input, line, serialCode });
      if (assignmentId) created.push(assignmentId);
    }
  }
  return created;
}

async function assignOne(
  db: AppDb,
  input: {
    organizationId: string;
    userId: string;
    orderId: string;
    now: number;
    line: PackLine;
    serialCode: string;
  },
): Promise<string | null> {
  const [existing] = await db
    .select()
    .from(schema.serials)
    .where(
      and(eq(schema.serials.organizationId, input.organizationId), eq(schema.serials.serialCode, input.serialCode)),
    )
    .limit(1);
  if (existing && existing.itemId !== input.line.itemId) {
    throw new WarrantyError(`Serial ${input.serialCode} is already on another SKU`, "SERIAL_OTHER_SKU");
  }
  let serialId = existing?.id ?? null;
  if (!serialId) {
    serialId = newId();
    await db.insert(schema.serials).values({
      id: serialId,
      organizationId: input.organizationId,
      itemId: input.line.itemId,
      serialCode: input.serialCode,
      locationId: null,
      status: "on_hand",
      updatedAt: input.now,
    });
  }
  const [assigned] = await db
    .select({ id: schema.serialAssignments.id })
    .from(schema.serialAssignments)
    .where(eq(schema.serialAssignments.serialId, serialId))
    .limit(1);
  if (assigned) throw new WarrantyError(`Serial ${input.serialCode} is already assigned`, "SERIAL_ASSIGNED");
  const id = newId();
  try {
    await db.insert(schema.serialAssignments).values({
      id,
      organizationId: input.organizationId,
      serialId,
      orderId: input.orderId,
      orderLineId: input.line.lineId,
      scannedBy: input.userId,
      scannedAt: input.now,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new WarrantyError(`Serial ${input.serialCode} is already assigned`, "SERIAL_ASSIGNED");
    throw err;
  }
  return id;
}

/** Attach freshly packed serials to the carton that holds their line. */
export async function linkAssignmentsToPackage(
  db: AppDb,
  organizationId: string,
  orderId: string,
  lines: { lineId: string; qty: number }[],
  packageId: string,
): Promise<void> {
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const rows = await db
      .select({ id: schema.serialAssignments.id })
      .from(schema.serialAssignments)
      .where(
        and(
          eq(schema.serialAssignments.organizationId, organizationId),
          eq(schema.serialAssignments.orderId, orderId),
          eq(schema.serialAssignments.orderLineId, line.lineId),
          isNull(schema.serialAssignments.packageId),
          isNull(schema.serialAssignments.shippedAt),
        ),
      )
      .limit(line.qty);
    for (const row of rows) {
      await db.update(schema.serialAssignments).set({ packageId }).where(eq(schema.serialAssignments.id, row.id));
    }
  }
}

export async function enqueueOrderPrepared(
  db: AppDb,
  input: {
    organizationId: string;
    orderId: string;
    orderNumber: string;
    customerName: string;
    customerId?: string | null;
    email?: string | null;
    now: number;
    origin?: string;
  },
): Promise<void> {
  const email = input.email ?? (input.customerId ? await customerEmail(db, input.customerId) : null);
  await enqueue(db, input.organizationId, "klaviyo", `klaviyo:prepared:${input.orderId}`, {
    metric: KLAVIYO_METRICS.prepared,
    uniqueId: `prepared:${input.orderId}`,
    email,
    properties: { order: input.orderNumber, orderId: input.orderId, customer: input.customerName },
  }, input.now);
  await flushOutbox(db, input.organizationId, input.origin);
}

export async function enqueueReturnReceived(
  db: AppDb,
  input: {
    organizationId: string;
    rmaId: string;
    rmaNumber: string;
    orderNumber: string | null;
    serials: string[];
    email?: string | null;
    now: number;
    origin?: string;
  },
): Promise<void> {
  await enqueue(db, input.organizationId, "klaviyo", `klaviyo:return:${input.rmaId}`, {
    metric: KLAVIYO_METRICS.returnReceived,
    uniqueId: `return:${input.rmaId}`,
    email: input.email ?? null,
    properties: { rma: input.rmaNumber, order: input.orderNumber, serials: input.serials },
  }, input.now);
  await flushOutbox(db, input.organizationId, input.origin);
}

export async function stampShipmentWarranties(
  db: AppDb,
  input: {
    organizationId: string;
    orderId: string;
    now: number;
    trackingNumber: string | null;
    packageIds: string[];
    orderComplete: boolean;
    origin?: string;
  },
): Promise<void> {
  const rows = await db
    .select({
      id: schema.serialAssignments.id,
      packageId: schema.serialAssignments.packageId,
      shippedAt: schema.serialAssignments.shippedAt,
      serialId: schema.serialAssignments.serialId,
      serialCode: schema.serials.serialCode,
      itemId: schema.serials.itemId,
      warrantyMonths: schema.items.warrantyMonths,
    })
    .from(schema.serialAssignments)
    .innerJoin(schema.serials, eq(schema.serials.id, schema.serialAssignments.serialId))
    .innerJoin(schema.items, eq(schema.items.id, schema.serials.itemId))
    .where(
      and(eq(schema.serialAssignments.organizationId, input.organizationId), eq(schema.serialAssignments.orderId, input.orderId)),
    );
  const ids = new Set(assignmentIdsToStamp(rows, { packageIds: input.packageIds, orderComplete: input.orderComplete }));
  const stamped = rows.filter((row) => ids.has(row.id));
  if (stamped.length === 0) return;

  const [link] = await db
    .select()
    .from(schema.replacementLinks)
    .where(
      and(
        eq(schema.replacementLinks.organizationId, input.organizationId),
        eq(schema.replacementLinks.replacementOrderId, input.orderId),
        isNull(schema.replacementLinks.newSerialId),
      ),
    )
    .limit(1);

  let inherited: { start: number | null; end: number | null } | null = null;
  if (link) {
    const [original] = await db
      .select()
      .from(schema.warranties)
      .where(eq(schema.warranties.serialId, link.originalSerialId))
      .limit(1);
    inherited = original ? { start: original.startAt, end: original.endAt } : { start: null, end: null };
  }

  const serialCodes: string[] = [];
  let warrantyEnd: number | null = null;
  for (const [index, row] of stamped.entries()) {
    await db
      .update(schema.serialAssignments)
      .set({ shippedAt: input.now, trackingNumber: input.trackingNumber })
      .where(eq(schema.serialAssignments.id, row.id));
    await db
      .update(schema.serials)
      .set({ status: "shipped", locationId: null, updatedAt: input.now })
      .where(eq(schema.serials.id, row.serialId));
    const view =
      inherited && index === 0
        ? inheritWarranty({ start: inherited.start, end: inherited.end, status: "active" }, input.now)
        : warrantyFromTerm(input.now, row.warrantyMonths, input.now);
    await upsertWarranty(db, {
      organizationId: input.organizationId,
      serialId: row.serialId,
      view,
      now: input.now,
    });
    if (view.end != null) warrantyEnd = view.end;
    serialCodes.push(row.serialCode);
    if (link && index === 0) {
      await db
        .update(schema.replacementLinks)
        .set({ newSerialId: row.serialId })
        .where(eq(schema.replacementLinks.id, link.id));
    }
  }

  const [order] = await db
    .select({
      number: schema.orders.number,
      customerName: schema.orders.customerName,
      shopifyOrderGid: schema.orders.shopifyOrderGid,
      customerId: schema.orders.customerId,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, input.orderId))
    .limit(1);
  const email = order?.customerId ? await customerEmail(db, order.customerId) : null;
  const customerGid = order?.customerId ? await shopifyCustomerGid(db, order.customerId) : null;

  await enqueue(db, input.organizationId, "klaviyo", `klaviyo:shipped:${input.orderId}:${stamped.map((row) => row.id).join(",")}`, {
    metric: KLAVIYO_METRICS.shipped,
    uniqueId: `shipped:${input.orderId}:${stamped.map((row) => row.serialId).sort().join(",")}`,
    email,
    properties: {
      order: order?.number ?? input.orderId,
      serials: serialCodes,
      tracking: input.trackingNumber,
      warrantyEnd,
    },
  }, input.now);
  await enqueue(db, input.organizationId, "shopify_metafield", `shopify_metafield:${input.orderId}`, {
    orderGid: order?.shopifyOrderGid ?? null,
    customerGid,
    serials: serialCodes,
  }, input.now);
  await flushOutbox(db, input.organizationId, input.origin);
}

async function upsertWarranty(
  db: AppDb,
  input: { organizationId: string; serialId: string; view: ReturnType<typeof warrantyFromTerm>; now: number },
) {
  const [existing] = await db
    .select({ id: schema.warranties.id })
    .from(schema.warranties)
    .where(eq(schema.warranties.serialId, input.serialId))
    .limit(1);
  const values = {
    startAt: input.view.start,
    endAt: input.view.end,
    status: input.view.status,
    termMonths: input.view.termMonths,
    updatedAt: input.now,
  };
  if (existing) {
    await db.update(schema.warranties).set(values).where(eq(schema.warranties.id, existing.id));
    return;
  }
  await db.insert(schema.warranties).values({
    id: newId(),
    organizationId: input.organizationId,
    serialId: input.serialId,
    ...values,
  });
}

export async function prepareRefurbSerials(
  db: AppDb,
  organizationId: string,
  lines: { itemId: string; serials: string[]; disposition: string }[],
): Promise<{ itemId: string; serials: string[]; disposition: string; quarantine: boolean; recordedDisposition: string }[]> {
  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const items = itemIds.length
    ? await db
        .select({ id: schema.items.id, refurbItemId: schema.items.refurbItemId })
        .from(schema.items)
        .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, itemIds)))
    : [];
  const refurbById = new Map(items.map((row) => [row.id, row.refurbItemId]));
  const prepared = [];
  for (const line of lines) {
    const target = refurbTarget({
      disposition: line.disposition,
      itemId: line.itemId,
      refurbItemId: refurbById.get(line.itemId) ?? null,
    });
    if (line.disposition === "refurb" && !target.quarantine) {
      for (const serialCode of line.serials) {
        await db
          .update(schema.serials)
          .set({ itemId: target.itemId, status: "returned", locationId: null, updatedAt: Date.now() })
          .where(and(eq(schema.serials.organizationId, organizationId), eq(schema.serials.serialCode, normalizeSerialCode(serialCode))));
      }
    }
    prepared.push({
      itemId: target.itemId,
      serials: line.serials,
      disposition: target.quarantine ? "hold" : line.disposition === "refurb" ? "restock" : line.disposition,
      quarantine: target.quarantine,
      recordedDisposition: line.disposition,
    });
  }
  return prepared;
}

export async function finishReturnSerials(
  db: AppDb,
  organizationId: string,
  lines: { serials: string[]; recordedDisposition: string; quarantine: boolean }[],
): Promise<void> {
  const now = Date.now();
  for (const line of lines) {
    const status = line.recordedDisposition === "scrap" ? "scrapped" : line.quarantine ? "returned" : null;
    if (!status) continue;
    for (const serialCode of line.serials) {
      await db
        .update(schema.serials)
        .set({ status, locationId: null, updatedAt: now })
        .where(and(eq(schema.serials.organizationId, organizationId), eq(schema.serials.serialCode, normalizeSerialCode(serialCode))));
    }
  }
}

export type WarrantyMatch = {
  serial: string | null;
  sku: string | null;
  itemName: string | null;
  serialStatus: string | null;
  warranty: ReturnType<typeof warrantyFromTerm> | null;
  order: {
    id: string;
    number: string;
    customerName: string;
    email: string | null;
    status: string;
    trackingNumber: string | null;
    shippedAt: number | null;
  } | null;
  replacement: { claimReference: string; orderId: string; orderNumber: string | null; newSerial: string | null } | null;
  rma: { id: string; number: string; disposition: string | null; grade: string | null; condition: string | null } | null;
};

export async function lookupWarranty(db: AppDb, organizationId: string, query: string, now = Date.now()): Promise<WarrantyMatch[]> {
  const needle = query.trim();
  if (!needle) return [];
  const serialCode = normalizeSerialCode(needle);
  const matches: WarrantyMatch[] = [];
  const seen = new Set<string>();

  const serialRows = await db
    .select({
      serialId: schema.serials.id,
      serialCode: schema.serials.serialCode,
      status: schema.serials.status,
      sku: schema.items.sku,
      itemName: schema.items.name,
      warrantyMonths: schema.items.warrantyMonths,
    })
    .from(schema.serials)
    .innerJoin(schema.items, eq(schema.items.id, schema.serials.itemId))
    .where(and(eq(schema.serials.organizationId, organizationId), eq(schema.serials.serialCode, serialCode)))
    .limit(5);
  for (const row of serialRows) {
    const match = await matchForSerial(db, row, now);
    if (seen.has(matchKey(match))) continue;
    seen.add(matchKey(match));
    matches.push(match);
  }

  const orders = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      customerName: schema.orders.customerName,
      status: schema.orders.status,
      trackingNumber: schema.orders.trackingNumber,
      shippedAt: schema.orders.shippedAt,
      customerId: schema.orders.customerId,
    })
    .from(schema.orders)
    .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.number, needle)))
    .limit(5);
  for (const order of orders) {
    const email = order.customerId ? await customerEmail(db, order.customerId) : null;
    const { customerId: _customerId, ...orderRest } = order;
    const assigned = await assignmentsForOrder(db, organizationId, order.id, now);
    if (assigned.length === 0) {
      matches.push({
        serial: null,
        sku: null,
        itemName: null,
        serialStatus: null,
        warranty: null,
        order: { ...orderRest, email },
        replacement: null,
        rma: null,
      });
    } else {
      for (const row of assigned) {
        if (seen.has(matchKey(row))) continue;
        seen.add(matchKey(row));
        matches.push(row);
      }
    }
  }

  if (needle.includes("@")) {
    const customers = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.organizationId, organizationId), sql`lower(${schema.customers.email}) = ${needle.toLowerCase()}`))
      .limit(5);
    for (const customer of customers) {
      const owned = await db
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.customerId, customer.id)))
        .limit(20);
      for (const order of owned) {
        const assigned = await assignmentsForOrder(db, organizationId, order.id, now);
        for (const row of assigned) {
          if (seen.has(matchKey(row))) continue;
          seen.add(matchKey(row));
          matches.push(row);
        }
      }
    }
  }

  const trackingOrders = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.orders.trackingNumber, needle)))
    .limit(5);
  for (const order of trackingOrders) {
    for (const row of await assignmentsForOrder(db, organizationId, order.id, now)) {
      if (seen.has(matchKey(row))) continue;
      seen.add(matchKey(row));
      matches.push(row);
    }
  }

  const labelOrders = await db
    .select({ rmaId: schema.returnLabels.rmaId })
    .from(schema.returnLabels)
    .where(and(eq(schema.returnLabels.organizationId, organizationId), eq(schema.returnLabels.trackingNumber, needle)))
    .limit(5);
  const rmas = await db
    .select()
    .from(schema.rmas)
    .where(and(eq(schema.rmas.organizationId, organizationId), eq(schema.rmas.number, needle)))
    .limit(5);
  const rmaIds = [...rmas.map((row) => row.id), ...labelOrders.map((row) => row.rmaId)];
  for (const rmaId of rmaIds) {
    const [rma] = await db.select().from(schema.rmas).where(eq(schema.rmas.id, rmaId)).limit(1);
    if (!rma) continue;
    const lines = await db.select().from(schema.rmaLines).where(eq(schema.rmaLines.rmaId, rma.id));
    const line = lines[0];
    if (rma.orderId) {
      const assigned = await assignmentsForOrder(db, organizationId, rma.orderId, now);
      for (const row of assigned) {
        matches.push({
          ...row,
          rma: {
            id: rma.id,
            number: rma.number,
            disposition: line?.disposition ?? null,
            grade: line?.grade ?? null,
            condition: line?.condition ?? null,
          },
        });
      }
      if (assigned.length) continue;
    }
    matches.push({
      serial: line?.serial ?? null,
      sku: null,
      itemName: null,
      serialStatus: null,
      warranty: null,
      order: null,
      replacement: null,
      rma: {
        id: rma.id,
        number: rma.number,
        disposition: line?.disposition ?? null,
        grade: line?.grade ?? null,
        condition: line?.condition ?? null,
      },
    });
  }
  return matches;
}

function matchKey(match: WarrantyMatch): string {
  return `${match.serial ?? ""}:${match.order?.id ?? ""}:${match.rma?.id ?? ""}`;
}

async function matchForSerial(
  db: AppDb,
  row: { serialId: string; serialCode: string; status: string; sku: string; itemName: string; warrantyMonths: number | null },
  now: number,
): Promise<WarrantyMatch> {
  const [assignment] = await db
    .select()
    .from(schema.serialAssignments)
    .where(eq(schema.serialAssignments.serialId, row.serialId))
    .limit(1);
  const [warranty] = await db.select().from(schema.warranties).where(eq(schema.warranties.serialId, row.serialId)).limit(1);
  const storedStatus =
    warranty?.status === "active" || warranty?.status === "expired" || warranty?.status === "void" || warranty?.status === "none"
      ? warranty.status
      : null;
  const view = warranty
    ? {
        eligible: storedStatus === "active" && (warranty.endAt == null || now <= warranty.endAt),
        status: storedStatus ?? "none",
        start: warranty.startAt,
        end: warranty.endAt,
        termMonths: warranty.termMonths,
      }
    : row.status === "shipped"
      ? warrantyFromTerm(0, row.warrantyMonths, now)
      : null;
  const order = assignment ? await orderSummary(db, assignment.orderId) : null;
  const [link] = await db
    .select()
    .from(schema.replacementLinks)
    .where(eq(schema.replacementLinks.originalSerialId, row.serialId))
    .limit(1);
  let replacement: WarrantyMatch["replacement"] = null;
  if (link) {
    const [replacementOrder] = await db
      .select({ number: schema.orders.number })
      .from(schema.orders)
      .where(eq(schema.orders.id, link.replacementOrderId))
      .limit(1);
    let newSerial: string | null = null;
    if (link.newSerialId) {
      const [serial] = await db
        .select({ serialCode: schema.serials.serialCode })
        .from(schema.serials)
        .where(eq(schema.serials.id, link.newSerialId))
        .limit(1);
      newSerial = serial?.serialCode ?? null;
    }
    replacement = {
      claimReference: link.claimReference,
      orderId: link.replacementOrderId,
      orderNumber: replacementOrder?.number ?? null,
      newSerial,
    };
  }
  return {
    serial: row.serialCode,
    sku: row.sku,
    itemName: row.itemName,
    serialStatus: row.status,
    warranty: view
      ? {
          eligible: view.eligible,
          status: view.status === "active" || view.status === "expired" || view.status === "void" || view.status === "none" ? view.status : "none",
          start: view.start,
          end: view.end,
          termMonths: view.termMonths,
        }
      : null,
    order,
    replacement,
    rma: null,
  };
}

async function assignmentsForOrder(db: AppDb, organizationId: string, orderId: string, now: number): Promise<WarrantyMatch[]> {
  const rows = await db
    .select({
      serialId: schema.serials.id,
      serialCode: schema.serials.serialCode,
      status: schema.serials.status,
      sku: schema.items.sku,
      itemName: schema.items.name,
      warrantyMonths: schema.items.warrantyMonths,
    })
    .from(schema.serialAssignments)
    .innerJoin(schema.serials, eq(schema.serials.id, schema.serialAssignments.serialId))
    .innerJoin(schema.items, eq(schema.items.id, schema.serials.itemId))
    .where(and(eq(schema.serialAssignments.organizationId, organizationId), eq(schema.serialAssignments.orderId, orderId)));
  const matches = [];
  for (const row of rows) matches.push(await matchForSerial(db, row, now));
  return matches;
}

async function orderSummary(db: AppDb, orderId: string): Promise<WarrantyMatch["order"]> {
  const [order] = await db
    .select({
      id: schema.orders.id,
      number: schema.orders.number,
      customerName: schema.orders.customerName,
      status: schema.orders.status,
      trackingNumber: schema.orders.trackingNumber,
      shippedAt: schema.orders.shippedAt,
      customerId: schema.orders.customerId,
    })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  if (!order) return null;
  const { customerId, ...rest } = order;
  return { ...rest, email: customerId ? await customerEmail(db, customerId) : null };
}

export async function claimReplacement(
  db: AppDb,
  input: { organizationId: string; serial: string; now?: number },
): Promise<{ orderId: string; number: string; claimReference: string }> {
  const now = input.now ?? Date.now();
  const serialCode = normalizeSerialCode(input.serial);
  const [serial] = await db
    .select()
    .from(schema.serials)
    .where(and(eq(schema.serials.organizationId, input.organizationId), eq(schema.serials.serialCode, serialCode)))
    .limit(1);
  if (!serial) throw new WarrantyError(`Serial ${serialCode} was not found`, "WARRANTY");
  const [warranty] = await db.select().from(schema.warranties).where(eq(schema.warranties.serialId, serial.id)).limit(1);
  const view = warranty
    ? {
        eligible: warranty.status === "active" && (warranty.endAt == null || now <= warranty.endAt),
        status: warranty.status,
        end: warranty.endAt,
      }
    : { eligible: false, status: "none", end: null };
  if (!view.eligible) throw new WarrantyError(`Serial ${serialCode} is not eligible for replacement`, "WARRANTY");
  const [existing] = await db
    .select({ id: schema.replacementLinks.id })
    .from(schema.replacementLinks)
    .where(eq(schema.replacementLinks.originalSerialId, serial.id))
    .limit(1);
  if (existing || serial.status === "replaced") {
    throw new WarrantyError(`Serial ${serialCode} is already replaced`, "WARRANTY");
  }
  const [assignment] = await db
    .select()
    .from(schema.serialAssignments)
    .where(eq(schema.serialAssignments.serialId, serial.id))
    .limit(1);
  if (!assignment) throw new WarrantyError(`Serial ${serialCode} is not on an order`, "WARRANTY");
  const [original] = await db.select().from(schema.orders).where(eq(schema.orders.id, assignment.orderId)).limit(1);
  if (!original) throw new WarrantyError(`Serial ${serialCode} is not on an order`, "WARRANTY");

  const orderId = newId();
  const number = docNumber("ORD");
  const claimReference = `CLM-${number}`;
  await db.insert(schema.orders).values({
    id: orderId,
    organizationId: input.organizationId,
    warehouseId: original.warehouseId,
    number,
    customerName: original.customerName,
    customerId: original.customerId,
    status: "open",
    createdAt: now,
    source: "replacement",
    parentOrderId: original.id,
    shipToAddress: original.shipToAddress,
    shipToCity: original.shipToCity,
    shipToRegion: original.shipToRegion,
    shipToCountry: original.shipToCountry,
    clientId: original.clientId,
  });
  await db.insert(schema.orderLines).values({
    id: newId(),
    orderId,
    itemId: serial.itemId,
    qty: 1,
  });
  await db.insert(schema.replacementLinks).values({
    id: newId(),
    organizationId: input.organizationId,
    originalSerialId: serial.id,
    claimReference,
    replacementOrderId: orderId,
    createdAt: now,
  });
  await db.update(schema.serials).set({ status: "replaced", updatedAt: now }).where(eq(schema.serials.id, serial.id));
  if (warranty) {
    await db.update(schema.warranties).set({ status: "void", updatedAt: now }).where(eq(schema.warranties.id, warranty.id));
  }
  await syncDocumentJob(
    db,
    orderJobInput({
      id: orderId,
      organizationId: input.organizationId,
      warehouseId: original.warehouseId,
      status: "open",
      number,
      customerName: original.customerName,
      source: "replacement",
      createdAt: now,
    }),
  );
  return { orderId, number, claimReference };
}

export async function openSerializedOrderRows(db: AppDb, organizationId: string) {
  const lines = await db
    .select({
      orderNumber: schema.orders.number,
      sku: schema.items.sku,
      qty: schema.orderLines.qty,
      lineId: schema.orderLines.id,
      status: schema.orders.status,
    })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
    .where(and(eq(schema.orders.organizationId, organizationId), eq(schema.items.trackSerial, true)));
  const open = lines.filter((line) => line.status !== "cancelled");
  const assignments = await db
    .select({ lineId: schema.serialAssignments.orderLineId })
    .from(schema.serialAssignments)
    .where(eq(schema.serialAssignments.organizationId, organizationId));
  const counts = new Map<string, number>();
  for (const row of assignments) counts.set(row.lineId, (counts.get(row.lineId) ?? 0) + 1);
  return open
    .filter((line) => line.status !== "shipped" || (counts.get(line.lineId) ?? 0) < line.qty)
    .map((line) => ({
      orderNumber: line.orderNumber,
      sku: line.sku,
      qty: line.qty,
      assigned: counts.get(line.lineId) ?? 0,
    }));
}

export async function importSerialFallback(
  db: AppDb,
  input: { organizationId: string; userId: string; rows: SerialFallbackRow[]; now?: number; origin?: string },
): Promise<{ assigned: number }> {
  const now = input.now ?? Date.now();
  let assigned = 0;
  const touched = new Set<string>();
  for (const row of input.rows) {
    const [order] = await db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.organizationId, input.organizationId), eq(schema.orders.number, row.orderNumber)))
      .limit(1);
    if (!order) throw new WarrantyError(`Order ${row.orderNumber} was not found`, "WARRANTY");
    const [line] = await db
      .select({ id: schema.orderLines.id, itemId: schema.orderLines.itemId, qty: schema.orderLines.qty, trackSerial: schema.items.trackSerial, sku: schema.items.sku })
      .from(schema.orderLines)
      .innerJoin(schema.items, eq(schema.items.id, schema.orderLines.itemId))
      .where(and(eq(schema.orderLines.orderId, order.id), eq(schema.items.sku, row.sku)))
      .limit(1);
    if (!line || !line.trackSerial) throw new WarrantyError(`${row.sku} on ${row.orderNumber} is not a serialized line`, "WARRANTY");
    await assignOne(db, {
      organizationId: input.organizationId,
      userId: input.userId,
      orderId: order.id,
      now,
      line: { lineId: line.id, itemId: line.itemId, sku: line.sku, qty: 1, trackSerial: true, serials: [row.serial] },
      serialCode: row.serial,
    });
    assigned += 1;
    if (order.status === "shipped") touched.add(order.id);
  }
  for (const orderId of touched) {
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    if (!order) continue;
    await stampShipmentWarranties(db, {
      organizationId: input.organizationId,
      orderId,
      now: order.shippedAt ?? now,
      trackingNumber: order.trackingNumber,
      packageIds: [],
      orderComplete: true,
      origin: input.origin,
    });
  }
  return { assigned };
}

async function customerEmail(db: AppDb, customerId: string): Promise<string | null> {
  const [row] = await db.select({ email: schema.customers.email }).from(schema.customers).where(eq(schema.customers.id, customerId)).limit(1);
  return row?.email ?? null;
}

async function shopifyCustomerGid(db: AppDb, customerId: string): Promise<string | null> {
  const [row] = await db
    .select({ channelRefsJson: schema.customers.channelRefsJson })
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  if (!row?.channelRefsJson) return null;
  try {
    const refs = JSON.parse(row.channelRefsJson) as { channel?: string; ref?: string }[];
    const ref = refs.find((item) => item.channel === "shopify")?.ref;
    if (!ref) return null;
    return ref.startsWith("gid://") ? ref : `gid://shopify/Customer/${ref}`;
  } catch {
    return null;
  }
}

async function enqueue(
  db: AppDb,
  organizationId: string,
  destination: string,
  idempotencyKey: string,
  payload: unknown,
  now: number,
): Promise<void> {
  try {
    await db.insert(schema.eventOutbox).values({
      id: newId(),
      organizationId,
      destination,
      idempotencyKey,
      payloadJson: JSON.stringify(payload),
      attempts: 0,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}

export async function flushOutbox(db: AppDb, organizationId: string, origin?: string): Promise<void> {
  const rows = await db
    .select()
    .from(schema.eventOutbox)
    .where(and(eq(schema.eventOutbox.organizationId, organizationId), inArray(schema.eventOutbox.status, ["pending", "failed"])));
  const due = rows.filter((row) => row.attempts < 5);
  if (due.length === 0) return;
  const [org] = await db
    .select({ mode: schema.organizations.klaviyoMode, key: schema.organizations.klaviyoPrivateKey })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  const klaviyoKey = org?.key ? await openSecret(credentialSecret(origin), org.key) : null;
  const [connection] = await db
    .select()
    .from(schema.shopifyConnections)
    .where(eq(schema.shopifyConnections.organizationId, organizationId))
    .limit(1);
  const shopify = connection ? await openShopifyRow(db, credentialSecret, connection) : null;

  for (const row of due) {
    const now = Date.now();
    try {
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
      if (row.destination === "klaviyo") {
        if (org?.mode !== "live") {
          await markOutbox(db, row.id, "recorded", row.attempts, null, now);
          continue;
        }
        if (!klaviyoKey) throw new Error("Klaviyo key is not set");
        const response = await fetch("https://a.klaviyo.com/api/events/", {
          method: "POST",
          headers: {
            Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
            accept: "application/vnd.api+json",
            "content-type": "application/vnd.api+json",
            revision: "2024-10-15",
          },
          body: JSON.stringify(
            klaviyoEventBody({
              metric: String(payload.metric ?? ""),
              uniqueId: String(payload.uniqueId ?? row.idempotencyKey),
              email: typeof payload.email === "string" ? payload.email : null,
              properties: (payload.properties as Record<string, unknown>) ?? {},
            }),
          ),
        });
        if (!response.ok) throw new Error(`Klaviyo answered ${response.status}`);
        await markOutbox(db, row.id, "sent", row.attempts + 1, null, now);
        continue;
      }
      if (row.destination === "shopify_metafield") {
        const metafields = shopifySerialMetafields({
          orderGid: typeof payload.orderGid === "string" ? payload.orderGid : null,
          customerGid: typeof payload.customerGid === "string" ? payload.customerGid : null,
          serials: Array.isArray(payload.serials) ? payload.serials.map(String) : [],
        });
        if (!shopify || shopify.mode !== "live" || !shopify.accessToken || metafields.length === 0) {
          await markOutbox(db, row.id, "recorded", row.attempts, null, now);
          continue;
        }
        const client = createShopifyGraphqlClient({
          shopDomain: shopify.shopDomain,
          accessToken: shopify.accessToken,
          apiVersion: shopify.apiVersion,
        });
        const result = await client.graphql<{
          metafieldsSet?: { userErrors?: { message?: string }[] };
        }>(SHOPIFY_METAFIELDS_SET, { metafields });
        const userError = result.metafieldsSet?.userErrors?.find((item) => item.message)?.message;
        if (userError) throw new Error(userError);
        await markOutbox(db, row.id, "sent", row.attempts + 1, null, now);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Outbox send failed";
      await markOutbox(db, row.id, "failed", row.attempts + 1, message, now);
    }
  }
}

async function markOutbox(db: AppDb, id: string, status: string, attempts: number, lastError: string | null, now: number) {
  await db.update(schema.eventOutbox).set({ status, attempts, lastError, updatedAt: now }).where(eq(schema.eventOutbox.id, id));
}
