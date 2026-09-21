import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, optionalInt, requireInt, requireString } from "../lib/http";
import { getOrgItem, getOrgLocation, getOrgLocationByScan, requireOwner } from "../lib/org";
import { docNumber, newId } from "../lib/ids";
import { postReceiveLines, loadBalanceMap, persistStockPlan, qtyMap } from "../db/stock";
import { applyPartialReceive, applyUnreceive, asnStatusAfterUnreceive, hasRemaining, isFullyReceived, remainingOnLine, OverReceiveError, OverUnreceiveError } from "../domain/partial-receive";
import { canExpectAsn, canReceiveAsn } from "../domain/status";
import { parseSerialList } from "../domain/lots";
import { lineCatchWeight } from "../lib/catch-weight";
import { lineExpiry } from "../lib/expiry";
import { recordLaborEvent } from "../db/labor";
import { resolveLineStockQty, UomConversionError } from "../domain/uom";
import {
  applyCarton,
  asnCartonReceiveGate,
  canPutawayAsnCarton,
  canUnreceiveAsnCarton,
  cartonNumber,
  OverCartonError,
} from "../domain/cartons";
import {
  asAsnCartonLines,
  loadPackagesForAsns,
  serializeSerialsJson,
  withAsnCartonRemaining,
  type AsnPackageRow,
} from "../db/asn-packages";
import { chainPlans, planMove, planUnreceive } from "../domain/inventory";
import { parseScan } from "../domain/barcodes";
import { suggestPutawayBay } from "../domain/directed-putaway";
import { loadPutawayBaysByItem } from "../db/putaway-bays";
import { completeMatchingSuggestionJobs, guardMatchingSuggestionJobs } from "../db/jobs";

export const asnsRoute = new Hono<AppEnv>();

function asExpected(line: { itemId: string; sku: string; qtyExpected: number; qtyReceived: number }) {
  return {
    itemId: line.itemId,
    sku: line.sku,
    qtyExpected: line.qtyExpected,
    qtyReceived: line.qtyReceived,
  };
}

async function asnWithLines(db: AppEnv["Variables"]["db"], organizationId: string, id: string) {
  const [asn] = await db
    .select()
    .from(schema.asns)
    .where(and(eq(schema.asns.id, id), eq(schema.asns.organizationId, organizationId)))
    .limit(1);
  if (!asn) notFound("ASN not found");
  const lines = await db
    .select({
      id: schema.asnLines.id,
      itemId: schema.asnLines.itemId,
      qtyExpected: schema.asnLines.qtyExpected,
      qtyReceived: schema.asnLines.qtyReceived,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
      altPerStock: schema.items.altPerStock,
    })
    .from(schema.asnLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.asnLines.itemId))
    .where(eq(schema.asnLines.asnId, id));
  const packages = (await loadPackagesForAsns(db, [id])).get(id) ?? [];
  return {
    ...asn,
    packages,
    lines: withAsnCartonRemaining(
      lines.map((line) => ({ ...line, remaining: remainingOnLine(asExpected(line)) })),
      packages,
    ),
  };
}

asnsRoute.get("/asns", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const rows = await db
    .select()
    .from(schema.asns)
    .where(eq(schema.asns.organizationId, organizationId))
    .orderBy(desc(schema.asns.createdAt));
  if (rows.length === 0) return c.json([]);
  const lines = await db
    .select({
      id: schema.asnLines.id,
      asnId: schema.asnLines.asnId,
      itemId: schema.asnLines.itemId,
      qtyExpected: schema.asnLines.qtyExpected,
      qtyReceived: schema.asnLines.qtyReceived,
      sku: schema.items.sku,
      itemName: schema.items.name,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.asnLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.asnLines.itemId))
    .where(
      inArray(
        schema.asnLines.asnId,
        rows.map((row) => row.id),
      ),
    );
  const byAsn = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byAsn.get(line.asnId) ?? [];
    list.push(line);
    byAsn.set(line.asnId, list);
  }
  const packagesByAsn = await loadPackagesForAsns(
    db,
    rows.map((row) => row.id),
  );
  return c.json(
    rows.map((row) => {
      const packages = packagesByAsn.get(row.id) ?? [];
      return {
        ...row,
        packages,
        lines: withAsnCartonRemaining(
          (byAsn.get(row.id) ?? []).map((line) => ({
            ...line,
            remaining: remainingOnLine(asExpected(line)),
          })),
          packages,
        ),
      };
    }),
  );
});

asnsRoute.get("/asns/:id", async (c) => {
  return c.json(await asnWithLines(c.get("db"), c.get("organizationId")!, c.req.param("id")));
});

asnsRoute.post("/asns", async (c) => {
  const body = await c.req.json<{
    warehouseId?: string;
    vendorName?: string;
    notes?: string;
    purchaseId?: string;
    clientId?: string;
    eta?: number;
    lines?: { itemId?: string; qty?: number }[];
  }>();
  const warehouseId = requireString(body.warehouseId, "warehouseId");
  const vendorName = requireString(body.vendorName, "vendorName");
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    badRequest("At least one ASN line is required");
  }

  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  if (body.purchaseId) {
    const [purchase] = await db
      .select()
      .from(schema.purchases)
      .where(and(eq(schema.purchases.id, body.purchaseId), eq(schema.purchases.organizationId, organizationId)))
      .limit(1);
    if (!purchase) badRequest("Purchase not found");
  }
  if (body.clientId) {
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.id, body.clientId), eq(schema.clients.organizationId, organizationId)))
      .limit(1);
    if (!client) badRequest("Client not found");
  }

  const now = Date.now();
  const id = newId();
  const seen = new Set<string>();
  const lines = [];
  for (const line of body.lines) {
    const itemId = requireString(line.itemId, "itemId");
    const qty = requireInt(line.qty, "qty");
    if (qty <= 0) badRequest("Line quantity must be positive");
    if (seen.has(itemId)) badRequest("Each SKU can appear once on an ASN");
    seen.add(itemId);
    await getOrgItem(db, organizationId, itemId);
    lines.push({ id: newId(), asnId: id, itemId, qtyExpected: qty, qtyReceived: 0 });
  }

  await db.batch([
    db.insert(schema.asns).values({
      id,
      organizationId,
      warehouseId,
      number: docNumber("ASN"),
      vendorName,
      status: "draft",
      purchaseId: body.purchaseId || null,
      clientId: body.clientId || null,
      eta: typeof body.eta === "number" ? body.eta : null,
      notes: body.notes?.trim() || null,
      createdAt: now,
    }),
    ...lines.map((line) => db.insert(schema.asnLines).values(line)),
  ]);

  return c.json(await asnWithLines(db, organizationId, id), 201);
});

asnsRoute.post("/asns/:id/expect", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const asn = await asnWithLines(db, organizationId, c.req.param("id"));
  if (!canExpectAsn(asn.status)) conflict("ASN is not a draft");
  await db
    .update(schema.asns)
    .set({ status: "expected", expectedAt: Date.now() })
    .where(eq(schema.asns.id, asn.id));
  return c.json(await asnWithLines(db, organizationId, asn.id));
});

asnsRoute.post("/asns/:id/receive", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lines?: {
      itemId?: string;
      qty?: number;
      altQty?: number;
      lotCode?: string;
      serials?: string | string[];
      weightGrams?: number;
      expiresOn?: unknown;
    }[];
  }>();
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const user = c.get("user")!;
  let asn = await asnWithLines(db, organizationId, c.req.param("id"));
  if (!canReceiveAsn(asn.status)) conflict("ASN is already received");
  if (!hasRemaining(asn.lines.map(asExpected))) conflict("ASN has nothing remaining");
  const cartonGate = asnCartonReceiveGate(asn.packages.length);
  if (!cartonGate.ok) conflict(cartonGate.error, cartonGate.code);
  await getOrgLocation(db, organizationId, locationId);

  if (asn.status === "draft") {
    await db
      .update(schema.asns)
      .set({ status: "expected", expectedAt: Date.now() })
      .where(eq(schema.asns.id, asn.id));
    asn = await asnWithLines(db, organizationId, asn.id);
  }

  const incoming =
    Array.isArray(body.lines) && body.lines.length > 0
      ? body.lines.map((row) => {
          const itemId = requireString(row.itemId, "itemId");
          const line = asn.lines.find((l) => l.itemId === itemId);
          if (!line) badRequest("Line is not on this ASN");
          let qty: number;
          if (row.qty == null && row.altQty == null) badRequest("qty or altQty is required");
          else {
            try {
              qty = resolveLineStockQty({
                qty: row.qty == null ? undefined : requireInt(row.qty, "qty"),
                altQty: row.altQty == null ? undefined : requireInt(row.altQty, "altQty"),
                altPerStock: line.altPerStock,
              });
            } catch (err) {
              if (err instanceof UomConversionError) badRequest(err.message);
              throw err;
            }
          }
          return {
            itemId,
            sku: line.sku,
            qty,
            lotCode: row.lotCode?.trim() || null,
            serials: parseSerialList(row.serials),
            weightGrams: lineCatchWeight(line.catchWeight, line.sku, row.weightGrams),
            expiresOn: lineExpiry(line.trackExpiry, line.sku, row.expiresOn),
          };
        })
      : asn.lines
          .filter((line) => line.remaining > 0)
          .map((line) => ({
            itemId: line.itemId,
            sku: line.sku,
            qty: line.remaining,
            lotCode: null as string | null,
            serials: [] as string[],
            weightGrams: null as number | null,
            expiresOn: null as number | null,
          }));

  let applied;
  try {
    applied = applyPartialReceive(
      asn.lines.map(asExpected),
      incoming.map((row) => ({ itemId: row.itemId, sku: row.sku, qty: row.qty })),
    );
  } catch (err) {
    if (err instanceof OverReceiveError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid receive");
  }

  const now = Date.now();
  const fully = isFullyReceived(applied.next);
  const qtyByItem = new Map(applied.next.map((line) => [line.itemId, line.qtyReceived]));
  const posted = incoming.filter((row) => row.qty > 0);

  await postReceiveLines(db, {
    organizationId,
    createdBy: user.id,
    now,
    locationId,
    refType: "asn",
    refId: asn.id,
    clientId: asn.clientId,
    lines: posted.map((row) => ({
      itemId: row.itemId,
      sku: row.sku,
      qty: row.qty,
      lotCode: row.lotCode,
      serials: row.serials,
      weightGrams: row.weightGrams,
      expiresOn: row.expiresOn,
    })),
    extra: [
      ...asn.lines.map((line) =>
        db
          .update(schema.asnLines)
          .set({ qtyReceived: qtyByItem.get(line.itemId) ?? line.qtyReceived })
          .where(eq(schema.asnLines.id, line.id)),
      ),
      db
        .update(schema.asns)
        .set({
          status: fully ? "received" : "receiving",
          locationId,
          receivedAt: fully ? now : asn.receivedAt,
        })
        .where(eq(schema.asns.id, asn.id)),
    ],
  });

  await recordLaborEvent(db, {
    organizationId,
    warehouseId: asn.warehouseId,
    userId: user.id,
    verb: "receive",
    refType: "asn",
    refId: asn.id,
    qty: posted.reduce((sum, row) => sum + row.qty, 0),
    now,
  });

  return c.json(await asnWithLines(db, organizationId, asn.id));
});

type AsnCartonLineIncoming = {
  itemId?: string;
  sku?: string;
  qty?: number;
  lotCode?: string;
  serials?: string | string[];
  weightGrams?: number;
  expiresOn?: unknown;
};

type AsnCartonIncoming = { sscc?: string; lines?: AsnCartonLineIncoming[] };

type ResolvedAsnCartonLine = {
  lineId: string;
  itemId: string;
  sku: string;
  qty: number;
  lotCode: string | null;
  serials: string[];
  weightGrams: number | null;
  expiresOn: number | null;
};

function resolveAsnCartonLines(
  asn: Awaited<ReturnType<typeof asnWithLines>>,
  rows: AsnCartonLineIncoming[] | undefined,
): ResolvedAsnCartonLine[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    return asn.lines
      .filter((line) => (line.cartonRemaining ?? remainingOnLine(asExpected(line))) > 0)
      .map((line) => ({
        lineId: line.id,
        itemId: line.itemId,
        sku: line.sku,
        qty: line.cartonRemaining ?? remainingOnLine(asExpected(line)),
        lotCode: null,
        serials: [] as string[],
        weightGrams: null,
        expiresOn: null,
      }));
  }
  return rows.map((row) => {
    const sku = row.sku?.trim().toUpperCase();
    const line =
      (row.itemId ? asn.lines.find((item) => item.itemId === row.itemId) : undefined) ??
      (sku ? asn.lines.find((item) => item.sku.toUpperCase() === sku) : undefined);
    if (!line) badRequest("Line is not on this ASN");
    const qty =
      row.qty === undefined || row.qty === null
        ? (line.cartonRemaining ?? remainingOnLine(asExpected(line)))
        : requireInt(row.qty, "qty");
    let serials: string[] = [];
    try {
      serials = parseSerialList(row.serials);
    } catch (err) {
      badRequest(err instanceof Error ? err.message : "Invalid serials");
    }
    return {
      lineId: line.id,
      itemId: line.itemId,
      sku: line.sku,
      qty,
      lotCode: row.lotCode?.trim().toUpperCase() || null,
      serials,
      weightGrams: line.catchWeight
        ? lineCatchWeight(true, line.sku, row.weightGrams)
        : (optionalInt(row.weightGrams, "weightGrams") ?? null),
      expiresOn: line.trackExpiry ? lineExpiry(true, line.sku, row.expiresOn) : null,
    };
  });
}

async function addAsnCarton(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  asn: Awaited<ReturnType<typeof asnWithLines>>,
  input: AsnCartonIncoming,
): Promise<AsnPackageRow> {
  const incoming = resolveAsnCartonLines(asn, input.lines).filter((row) => row.qty > 0);
  if (incoming.length === 0) badRequest("At least one carton line is required");
  let applied;
  try {
    applied = applyCarton(asAsnCartonLines(asn.lines, asn.packages), incoming.map((row) => ({ lineId: row.lineId, qty: row.qty })));
  } catch (err) {
    if (err instanceof OverCartonError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid carton");
  }
  const now = Date.now();
  const id = newId();
  const seq = asn.packages.length + 1;
  const sscc = input.sscc?.trim() || null;
  if (sscc) {
    const [dup] = await db
      .select({ id: schema.asnPackages.id })
      .from(schema.asnPackages)
      .where(and(eq(schema.asnPackages.organizationId, organizationId), eq(schema.asnPackages.sscc, sscc)))
      .limit(1);
    if (dup) conflict("SSCC is already on an ASN carton");
  }
  await db.batch([
    db.insert(schema.asnPackages).values({
      id,
      organizationId,
      asnId: asn.id,
      number: cartonNumber(seq),
      seq,
      sscc,
      createdAt: now,
    }),
    ...applied.posted.map((row) => {
      const line = incoming.find((item) => item.lineId === row.lineId)!;
      return db.insert(schema.asnPackageLines).values({
        id: newId(),
        packageId: id,
        asnLineId: row.lineId,
        itemId: line.itemId,
        qty: row.qty,
        lotCode: line.lotCode,
        serialsJson: serializeSerialsJson(line.serials),
        weightGrams: line.weightGrams,
        expiresOn: line.expiresOn,
      });
    }),
  ]);
  const next = (await loadPackagesForAsns(db, [asn.id])).get(asn.id) ?? [];
  const created = next.find((row) => row.id === id);
  if (!created) badRequest("Could not create carton");
  asn.packages = next;
  asn.lines = withAsnCartonRemaining(asn.lines, next);
  return created;
}

asnsRoute.post("/asns/:id/packages", async (c) => {
  const body = await c.req.json<{
    sscc?: string;
    lines?: AsnCartonLineIncoming[];
    cartons?: AsnCartonIncoming[];
    receive?: boolean;
    locationId?: string;
  }>().catch(() => ({} as { sscc?: string; lines?: AsnCartonLineIncoming[]; cartons?: AsnCartonIncoming[]; receive?: boolean; locationId?: string }));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  let asn = await asnWithLines(db, organizationId, c.req.param("id"));
  if (!canReceiveAsn(asn.status)) conflict("ASN must be open for vendor cartons");
  const cartons = Array.isArray(body.cartons) && body.cartons.length > 0 ? body.cartons : [{ sscc: body.sscc, lines: body.lines }];
  for (const carton of cartons) {
    await addAsnCarton(db, organizationId, asn, carton);
    asn = await asnWithLines(db, organizationId, asn.id);
  }
  if (body.receive) {
    const locationId = requireString(body.locationId, "locationId");
    const newest = asn.packages[asn.packages.length - 1];
    if (newest) {
      await receiveAsnPackage(db, organizationId, c.get("user")!.id, asn, newest.id, { locationId });
      asn = await asnWithLines(db, organizationId, asn.id);
    }
  }
  return c.json(asn, 201);
});

asnsRoute.post("/asns/:id/packages/:pkgId/receive", async (c) => {
  const body = await c.req.json<{
    locationId?: string;
    lots?: Record<string, string>;
    serials?: Record<string, string | string[]>;
    weights?: Record<string, number>;
    expiries?: Record<string, unknown>;
  }>().catch(
    () =>
      ({}) as {
        locationId?: string;
        lots?: Record<string, string>;
        serials?: Record<string, string | string[]>;
        weights?: Record<string, number>;
        expiries?: Record<string, unknown>;
      },
  );
  const locationId = requireString(body.locationId, "locationId");
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const asn = await asnWithLines(db, organizationId, c.req.param("id"));
  return c.json(await receiveAsnPackage(db, organizationId, c.get("user")!.id, asn, c.req.param("pkgId"), {
    locationId,
    lots: body.lots,
    serials: body.serials,
    weights: body.weights,
    expiries: body.expiries,
  }));
});

async function receiveAsnPackage(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  userId: string,
  asn: Awaited<ReturnType<typeof asnWithLines>>,
  pkgId: string,
  input: {
    locationId: string;
    lots?: Record<string, string>;
    serials?: Record<string, string | string[]>;
    weights?: Record<string, number>;
    expiries?: Record<string, unknown>;
  },
) {
  if (!canReceiveAsn(asn.status)) conflict("ASN is already received");
  const pkg = asn.packages.find((row) => row.id === pkgId);
  if (!pkg) notFound("Carton not found");
  if (pkg.receivedAt) conflict("Carton is already received");
  await getOrgLocation(db, organizationId, input.locationId);

  if (asn.status === "draft") {
    await db
      .update(schema.asns)
      .set({ status: "expected", expectedAt: Date.now() })
      .where(eq(schema.asns.id, asn.id));
    asn = await asnWithLines(db, organizationId, asn.id);
  }

  const incoming = pkg.lines.map((row) => {
    const line = asn.lines.find((item) => item.itemId === row.itemId);
    const formSerials = parseSerialList(input.serials?.[row.itemId]);
    const weightRaw = row.weightGrams ?? input.weights?.[row.itemId];
    const expiryRaw = row.expiresOn ?? input.expiries?.[row.itemId];
    return {
      itemId: row.itemId,
      sku: row.sku,
      qty: row.qty,
      lotCode: row.lotCode?.trim() || input.lots?.[row.itemId]?.trim() || null,
      serials: row.serials.length ? row.serials : formSerials,
      weightGrams: line?.catchWeight ? lineCatchWeight(true, row.sku, weightRaw) : (weightRaw ?? null),
      expiresOn: line?.trackExpiry ? lineExpiry(true, row.sku, expiryRaw) : (typeof expiryRaw === "number" ? expiryRaw : null),
    };
  });

  let applied;
  try {
    applied = applyPartialReceive(
      asn.lines.map(asExpected),
      incoming.map((row) => ({ itemId: row.itemId, sku: row.sku, qty: row.qty })),
    );
  } catch (err) {
    if (err instanceof OverReceiveError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid receive");
  }

  const now = Date.now();
  const fully = isFullyReceived(applied.next);
  const qtyByItem = new Map(applied.next.map((line) => [line.itemId, line.qtyReceived]));
  const posted = incoming.filter((row) => row.qty > 0);

  await postReceiveLines(db, {
    organizationId,
    createdBy: userId,
    now,
    locationId: input.locationId,
    refType: "asn",
    refId: asn.id,
    clientId: asn.clientId,
    lines: posted.map((row) => ({
      itemId: row.itemId,
      sku: row.sku,
      qty: row.qty,
      lotCode: row.lotCode,
      serials: row.serials,
      weightGrams: row.weightGrams,
      expiresOn: row.expiresOn,
    })),
    extra: [
      ...asn.lines.map((line) =>
        db
          .update(schema.asnLines)
          .set({ qtyReceived: qtyByItem.get(line.itemId) ?? line.qtyReceived })
          .where(eq(schema.asnLines.id, line.id)),
      ),
      db
        .update(schema.asnPackages)
        .set({ receivedAt: now })
        .where(eq(schema.asnPackages.id, pkg.id)),
      db
        .update(schema.asns)
        .set({
          status: fully ? "received" : "receiving",
          locationId: input.locationId,
          receivedAt: fully ? now : asn.receivedAt,
        })
        .where(eq(schema.asns.id, asn.id)),
    ],
  });

  await recordLaborEvent(db, {
    organizationId,
    warehouseId: asn.warehouseId,
    userId,
    verb: "receive",
    refType: "asn",
    refId: asn.id,
    qty: posted.reduce((sum, row) => sum + row.qty, 0),
    now,
  });

  return asnWithLines(db, organizationId, asn.id);
}

asnsRoute.post("/asns/:id/packages/:pkgId/unreceive", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const asn = await asnWithLines(db, organizationId, c.req.param("id"));
  return c.json(await unreceiveAsnPackage(db, organizationId, c.get("user")!.id, asn, c.req.param("pkgId")));
});

async function unreceiveAsnPackage(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  userId: string,
  asn: Awaited<ReturnType<typeof asnWithLines>>,
  pkgId: string,
) {
  const pkg = asn.packages.find((row) => row.id === pkgId);
  if (!pkg) notFound("Carton not found");
  const gate = canUnreceiveAsnCarton(pkg);
  if (!gate.ok) conflict(gate.error, gate.code);
  if (!asn.locationId) conflict("Receive the carton onto a dock before unreceiving");
  await getOrgLocation(db, organizationId, asn.locationId);

  const incoming = pkg.lines.map((row) => ({
    itemId: row.itemId,
    sku: row.sku,
    qty: row.qty,
    lotCode: row.lotCode,
    serials: row.serials.length ? row.serials : null,
    weightGrams: row.weightGrams,
    expiresOn: row.expiresOn,
  }));

  let applied;
  try {
    applied = applyUnreceive(
      asn.lines.map(asExpected),
      incoming.map((row) => ({ itemId: row.itemId, qty: row.qty })),
    );
  } catch (err) {
    if (err instanceof OverUnreceiveError) throw err;
    badRequest(err instanceof Error ? err.message : "Invalid unreceive");
  }

  const now = Date.now();
  const statusPatch = asnStatusAfterUnreceive(applied.next, asn.status);
  const qtyByItem = new Map(applied.next.map((line) => [line.itemId, line.qtyReceived]));
  const posted = incoming.filter((row) => row.qty > 0);
  const loaded = await loadBalanceMap(
    db,
    organizationId,
    posted.map((row) => ({ locationId: asn.locationId!, itemId: row.itemId })),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    posted.map(
      (row) => (balances) =>
        planUnreceive({
          itemId: row.itemId,
          sku: row.sku,
          locationId: asn.locationId!,
          qty: row.qty,
          refId: asn.id,
          balances,
          lotCode: row.lotCode,
          serials: row.serials,
          weightGrams: row.weightGrams,
          expiresOn: row.expiresOn,
          clientId: asn.clientId,
        }),
    ),
  );

  await persistStockPlan(db, {
    organizationId,
    createdBy: userId,
    now,
    loaded,
    plan,
    extra: [
      ...asn.lines.map((line) =>
        db
          .update(schema.asnLines)
          .set({ qtyReceived: qtyByItem.get(line.itemId) ?? line.qtyReceived })
          .where(eq(schema.asnLines.id, line.id)),
      ),
      db.update(schema.asnPackages).set({ receivedAt: null }).where(eq(schema.asnPackages.id, pkg.id)),
      db
        .update(schema.asns)
        .set({
          status: statusPatch.status,
          receivedAt: statusPatch.clearReceivedAt ? null : asn.receivedAt,
        })
        .where(eq(schema.asns.id, asn.id)),
    ],
  });

  return asnWithLines(db, organizationId, asn.id);
}

asnsRoute.post("/asns/:id/packages/:pkgId/putaway", async (c) => {
  const body = await c.req
    .json<{ toLocationId?: string; toBarcode?: string }>()
    .catch(() => ({}) as { toLocationId?: string; toBarcode?: string });
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const asn = await asnWithLines(db, organizationId, c.req.param("id"));
  return c.json(
    await putawayAsnPackage(db, organizationId, c.get("user")!.id, c.get("role")!, asn, c.req.param("pkgId"), body),
  );
});

async function putawayAsnPackage(
  db: AppEnv["Variables"]["db"],
  organizationId: string,
  userId: string,
  role: string,
  asn: Awaited<ReturnType<typeof asnWithLines>>,
  pkgId: string,
  input: { toLocationId?: string; toBarcode?: string },
) {
  const pkg = asn.packages.find((row) => row.id === pkgId);
  if (!pkg) notFound("Carton not found");
  const gate = canPutawayAsnCarton(pkg);
  if (!gate.ok) conflict(gate.error, gate.code);
  if (!asn.locationId) conflict("Receive the carton onto a dock before putaway");
  const from = await getOrgLocation(db, organizationId, asn.locationId);
  const override =
    (input.toLocationId ? await getOrgLocation(db, organizationId, requireString(input.toLocationId, "toLocationId")) : null) ??
    (input.toBarcode
      ? await getOrgLocationByScan(db, organizationId, parseScan(requireString(input.toBarcode, "toBarcode")).value)
      : null);
  if (input.toLocationId && !override) notFound("Location not found");
  if (input.toBarcode && !override) notFound("Location not found");

  const baysByItem = override
    ? new Map()
    : await loadPutawayBaysByItem(
        db,
        organizationId,
        from.warehouseId,
        [...new Set(pkg.lines.map((line) => line.itemId))],
      );

  const dests = pkg.lines.map((line) => {
    if (override) {
      if (override.id === from.id) badRequest("From and to locations must differ");
      return {
        itemId: line.itemId,
        sku: line.sku,
        qty: line.qty,
        lotCode: line.lotCode,
        serials: line.serials.length ? line.serials : null,
        toLocationId: override.id,
        toCode: override.code,
        toBarcode: override.barcode,
      };
    }
    const suggested = suggestPutawayBay(baysByItem.get(line.itemId) ?? [], from.id);
    if (!suggested) badRequest(`No putaway bay for ${line.sku}`);
    return {
      itemId: line.itemId,
      sku: line.sku,
      qty: line.qty,
      lotCode: line.lotCode,
      serials: line.serials.length ? line.serials : null,
      toLocationId: suggested.locationId,
      toCode: suggested.locationCode,
      toBarcode: suggested.barcode,
    };
  });

  for (const dest of dests) {
    await guardMatchingSuggestionJobs(db, {
      organizationId,
      warehouseId: from.warehouseId,
      userId,
      role,
      fromLocationId: from.id,
      toLocationId: dest.toLocationId,
      itemIds: [dest.itemId],
    });
  }

  const pairs = dests.flatMap((line) => [
    { locationId: from.id, itemId: line.itemId },
    { locationId: line.toLocationId, itemId: line.itemId },
  ]);
  const loaded = await loadBalanceMap(db, organizationId, pairs);
  const now = Date.now();
  const plan = chainPlans(
    qtyMap(loaded),
    dests.map(
      (line) => (balances) =>
        planMove({
          itemId: line.itemId,
          sku: line.sku,
          qty: line.qty,
          fromLocationId: from.id,
          toLocationId: line.toLocationId,
          refId: asn.id,
          refType: "asn",
          balances,
          lotCode: line.lotCode,
          serials: line.serials,
        }),
    ),
  );

  await persistStockPlan(db, {
    organizationId,
    createdBy: userId,
    now,
    loaded,
    plan,
    extra: [db.update(schema.asnPackages).set({ putawayAt: now }).where(eq(schema.asnPackages.id, pkg.id))],
  });

  for (const dest of dests) {
    await completeMatchingSuggestionJobs(db, {
      organizationId,
      warehouseId: from.warehouseId,
      fromLocationId: from.id,
      toLocationId: dest.toLocationId,
      itemIds: [dest.itemId],
    });
  }

  await recordLaborEvent(db, {
    organizationId,
    warehouseId: asn.warehouseId,
    userId,
    verb: "putaway",
    refType: "asn",
    refId: asn.id,
    qty: dests.reduce((sum, row) => sum + row.qty, 0),
    now,
  });

  const next = await asnWithLines(db, organizationId, asn.id);
  return {
    ...next,
    putaway: {
      from: { id: from.id, code: from.code, barcode: from.barcode },
      moved: dests.map((row) => ({
        itemId: row.itemId,
        sku: row.sku,
        qty: row.qty,
        toLocationId: row.toLocationId,
        toCode: row.toCode,
        toBarcode: row.toBarcode,
      })),
    },
  };
}

asnsRoute.delete("/asns/:id", async (c) => {
  requireOwner(c.get("role"));
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const asn = await asnWithLines(db, organizationId, c.req.param("id"));
  if (asn.status !== "draft") conflict("Only draft ASNs can be deleted");
  await db.delete(schema.asns).where(eq(schema.asns.id, asn.id));
  return c.body(null, 204);
});
