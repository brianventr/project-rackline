import { Hono } from "hono";
import { and, asc, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, conflict, notFound, optionalInt, optionalString } from "../lib/http";
import { newId } from "../lib/ids";
import { buyLivePostage, voidLivePostage } from "../lib/live-postage";
import { asCarrierLiveError } from "../lib/carrier-client";
import { loadCarrierConnections, recordCarrierEvent } from "./carriers";
import { isLivePostage, requireLiveShipAddress, resolveParcel, type LiveLabelResult } from "../domain/carrier-live";
import { enabledServicesFromConnections, quoteRates, resolveLabelPurchase, resolveService } from "../domain/carriers";
import { generateTrackingNumber, trackingUrlFor } from "../domain/shipping-label";
import { buildingDefaultService } from "../domain/ship-defaults";
import { isPublicToken, newPublicToken, publicLink, returnLabelPagePath } from "../domain/public-token";
import {
  publicReturnLabelView,
  returnDestination,
  returnLabelBlock,
  returnLabelRefusal,
  returnLabelStatusLabel,
  returnLabelVoidBlock,
} from "../domain/return-label";

type Db = AppEnv["Variables"]["db"];
type ReturnLabelRow = typeof schema.returnLabels.$inferSelect;

function serializeReturnLabel(row: ReturnLabelRow, origin: string) {
  const path = returnLabelPagePath(row.token);
  return {
    id: row.id,
    rmaId: row.rmaId,
    status: row.status,
    statusLabel: returnLabelStatusLabel(row),
    carrierConnectionId: row.carrierConnectionId,
    carrierCompany: row.carrierCompany,
    carrierService: row.carrierService,
    serviceName: resolveService(row.carrierService)?.service ?? row.carrierService,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    labelUrl: row.labelUrl,
    postageCents: row.postageCents,
    trackerStatus: row.trackerStatus,
    trackerUpdatedAt: row.trackerUpdatedAt,
    fromName: row.fromName,
    fromAddress: row.fromAddress,
    toName: row.toName,
    toAddress: row.toAddress,
    weightOz: row.weightOz,
    createdAt: row.createdAt,
    voidedAt: row.voidedAt,
    path,
    url: publicLink(origin, path),
  };
}

/** The RMA, its original order's ship-to, its building, and the shop name a return label needs. */
async function loadReturnContext(db: Db, organizationId: string, rmaId: string) {
  const [rma] = await db
    .select({
      id: schema.rmas.id,
      number: schema.rmas.number,
      status: schema.rmas.status,
      customerName: schema.rmas.customerName,
      warehouseId: schema.rmas.warehouseId,
      orderId: schema.rmas.orderId,
    })
    .from(schema.rmas)
    .where(and(eq(schema.rmas.id, rmaId), eq(schema.rmas.organizationId, organizationId)))
    .limit(1);
  if (!rma) notFound("Return not found");
  const [order] = rma.orderId
    ? await db
        .select({
          shipToAddress: schema.orders.shipToAddress,
          shipToCity: schema.orders.shipToCity,
          shipToRegion: schema.orders.shipToRegion,
          shipToCountry: schema.orders.shipToCountry,
          carrierService: schema.orders.carrierService,
          carrierConnectionId: schema.orders.carrierConnectionId,
          packageWeightOz: schema.orders.packageWeightOz,
          packageLengthIn: schema.orders.packageLengthIn,
          packageWidthIn: schema.orders.packageWidthIn,
          packageHeightIn: schema.orders.packageHeightIn,
        })
        .from(schema.orders)
        .where(and(eq(schema.orders.id, rma.orderId), eq(schema.orders.organizationId, organizationId)))
        .limit(1)
    : [];
  const [warehouse] = await db
    .select()
    .from(schema.warehouses)
    .where(and(eq(schema.warehouses.id, rma.warehouseId), eq(schema.warehouses.organizationId, organizationId)))
    .limit(1);
  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  return { rma, order: order ?? null, warehouse: warehouse ?? null, shopName: org?.name || warehouse?.name || "Returns" };
}

type ReturnContext = Awaited<ReturnType<typeof loadReturnContext>>;
type Connections = Awaited<ReturnType<typeof loadCarrierConnections>>;

/** The service a new return label starts on: the original order's, else the building default, else Rackline Ground. */
function draftService(connections: Connections, ctx: ReturnContext) {
  if (ctx.order?.carrierService) {
    const purchase = resolveLabelPurchase({
      connections,
      serviceId: ctx.order.carrierService,
      connectionId: ctx.order.carrierConnectionId,
    });
    if (purchase.ok) return { serviceId: purchase.service.id, connectionId: purchase.connectionId };
  }
  return buildingDefaultService(connections, ctx.warehouse) ?? { serviceId: "rackline_ground", connectionId: null };
}

function draftFor(connections: Connections, ctx: ReturnContext) {
  const service = draftService(connections, ctx);
  return {
    fromName: ctx.rma.customerName,
    fromAddress: ctx.order?.shipToAddress?.trim() || null,
    toName: ctx.shopName,
    toAddress: returnDestination(ctx.warehouse),
    carrierService: service.serviceId,
    carrierConnectionId: service.connectionId,
  };
}

async function labelsForRma(db: Db, organizationId: string, rmaId: string) {
  return db
    .select()
    .from(schema.returnLabels)
    .where(and(eq(schema.returnLabels.rmaId, rmaId), eq(schema.returnLabels.organizationId, organizationId)))
    .orderBy(desc(schema.returnLabels.createdAt));
}

export const returnLabelsRoute = new Hono<AppEnv>();

returnLabelsRoute.get("/return-labels", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(schema.returnLabels)
    .where(eq(schema.returnLabels.organizationId, c.get("organizationId")!))
    .orderBy(desc(schema.returnLabels.createdAt));
  return c.json(rows.map((row) => serializeReturnLabel(row, c.get("origin"))));
});

returnLabelsRoute.get("/returns/:id/return-labels", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const ctx = await loadReturnContext(db, organizationId, c.req.param("id"));
  const [labels, connections] = await Promise.all([
    labelsForRma(db, organizationId, ctx.rma.id),
    loadCarrierConnections(db, organizationId),
  ]);
  return c.json({
    labels: labels.map((row) => serializeReturnLabel(row, c.get("origin"))),
    draft: draftFor(connections, ctx),
  });
});

type ReturnLabelBody = {
  fromName?: string;
  fromAddress?: string;
  carrierService?: string;
  carrierConnectionId?: string;
  weightOz?: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
};

returnLabelsRoute.post("/returns/:id/return-labels", async (c) => {
  const body = await c.req.json<ReturnLabelBody>().catch(() => ({}) as ReturnLabelBody);
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const ctx = await loadReturnContext(db, organizationId, c.req.param("id"));
  const existing = await labelsForRma(db, organizationId, ctx.rma.id);
  const block = returnLabelBlock({
    rmaStatus: ctx.rma.status,
    hasActiveLabel: existing.some((row) => row.status === "active"),
  });
  if (block) conflict(block);

  const connections = await loadCarrierConnections(db, organizationId);
  const draft = draftFor(connections, ctx);
  const typedAddress = optionalString(body.fromAddress);
  const fromName = optionalString(body.fromName) ?? draft.fromName;
  const fromAddress = typedAddress ?? draft.fromAddress;
  if (!fromAddress) badRequest("Add the customer's address. This return has no original order to take it from.");
  const toAddress = draft.toAddress;
  if (!toAddress) conflict("This building has no return address. Add one in Settings → Warehouse, then buy the label.");

  const chosen = optionalString(body.carrierService);
  const purchase = resolveLabelPurchase({
    connections,
    serviceId: chosen ?? draft.carrierService,
    connectionId: chosen ? optionalString(body.carrierConnectionId) : draft.carrierConnectionId,
  });
  if (!purchase.ok) badRequest(purchase.error);
  const connection = connections.find((row) => row.id === purchase.connectionId) ?? null;
  const refusal = returnLabelRefusal(connection);
  if (refusal) conflict(refusal, "RETURN_LABEL_UNSUPPORTED");

  const parcel = resolveParcel({
    weightOz: optionalInt(body.weightOz, "weightOz") ?? ctx.order?.packageWeightOz ?? undefined,
    lengthIn: optionalInt(body.lengthIn, "lengthIn") ?? ctx.order?.packageLengthIn ?? undefined,
    widthIn: optionalInt(body.widthIn, "widthIn") ?? ctx.order?.packageWidthIn ?? undefined,
    heightIn: optionalInt(body.heightIn, "heightIn") ?? ctx.order?.packageHeightIn ?? undefined,
  });
  const live = Boolean(connection && isLivePostage(connection.provider, connection.mode));
  const request = {
    returnLabel: true,
    rmaId: ctx.rma.id,
    rmaNumber: ctx.rma.number,
    carrierService: purchase.service.id,
    connectionId: purchase.connectionId,
    mode: live ? "live" : connection?.mode ?? "demo",
    parcel,
  };

  let liveLabel: LiveLabelResult | null = null;
  if (live && connection) {
    if (!connection.apiKey) badRequest("Live postage needs an API key");
    const warehouse = ctx.warehouse;
    const toShipFrom = !warehouse?.returnAddress?.trim();
    try {
      liveLabel = await buyLivePostage({
        connection,
        services: enabledServicesFromConnections([connection]).filter((row) => row.connectionId === connection.id),
        serviceId: purchase.service.id,
        shipFrom: requireLiveShipAddress({
          name: fromName,
          text: fromAddress,
          city: typedAddress ? null : ctx.order?.shipToCity,
          region: typedAddress ? null : ctx.order?.shipToRegion,
          country: typedAddress ? null : ctx.order?.shipToCountry,
        }),
        shipTo: requireLiveShipAddress({
          name: draft.toName,
          text: toAddress,
          city: toShipFrom ? warehouse?.city : null,
          region: toShipFrom ? warehouse?.region : null,
          country: toShipFrom ? warehouse?.country : null,
        }),
        parcel,
        returnLabel: { rmaNumber: ctx.rma.number },
      });
    } catch (err) {
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: purchase.connectionId,
        orderId: ctx.rma.orderId,
        kind: "buy",
        status: "failed",
        request,
        response: { error: err instanceof Error ? err.message : "Buy failed" },
      });
      throw asCarrierLiveError(err);
    }
  }

  const trackingNumber = liveLabel?.trackingNumber ?? generateTrackingNumber(purchase.service.id);
  const quoted = live
    ? null
    : (quoteRates({
        services: enabledServicesFromConnections(connections).filter((row) => row.id === purchase.service.id).slice(0, 1),
        shipFrom: fromAddress,
        shipTo: toAddress,
      })[0]?.amountCents ?? null);
  const now = Date.now();
  const id = newId();
  await db.insert(schema.returnLabels).values({
    id,
    organizationId,
    rmaId: ctx.rma.id,
    token: newPublicToken(),
    status: "active",
    carrierConnectionId: purchase.connectionId,
    carrierCompany: purchase.service.company,
    carrierService: purchase.service.id,
    trackingNumber,
    trackingUrl: liveLabel?.trackingUrl || trackingUrlFor(trackingNumber, purchase.service.id),
    labelUrl: liveLabel?.labelUrl ?? null,
    carrierShipmentId: liveLabel?.shipmentId ?? null,
    carrierLabelId: liveLabel?.labelId ?? null,
    postageCents: liveLabel ? (liveLabel.postageCents ?? null) : quoted,
    fromName,
    fromAddress,
    toName: draft.toName,
    toAddress,
    weightOz: parcel.weightOz,
    lengthIn: parcel.lengthIn,
    widthIn: parcel.widthIn,
    heightIn: parcel.heightIn,
    createdBy: c.get("user")?.id ?? null,
    createdAt: now,
  });
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: purchase.connectionId,
    orderId: ctx.rma.orderId,
    kind: "buy",
    status: "ok",
    request,
    response: {
      returnLabelId: id,
      trackingNumber,
      shipmentId: liveLabel?.shipmentId ?? null,
      labelId: liveLabel?.labelId ?? null,
      postageCents: liveLabel?.postageCents ?? quoted,
    },
    now,
  });
  const [row] = await db.select().from(schema.returnLabels).where(eq(schema.returnLabels.id, id)).limit(1);
  return c.json(serializeReturnLabel(row!, c.get("origin")), 201);
});

returnLabelsRoute.post("/return-labels/:id/void", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [label] = await db
    .select()
    .from(schema.returnLabels)
    .where(and(eq(schema.returnLabels.id, c.req.param("id")), eq(schema.returnLabels.organizationId, organizationId)))
    .limit(1);
  if (!label) notFound("Return label not found");
  const block = returnLabelVoidBlock(label);
  if (block) conflict(block);
  const [rma] = await db
    .select({ orderId: schema.rmas.orderId })
    .from(schema.rmas)
    .where(eq(schema.rmas.id, label.rmaId))
    .limit(1);
  const connections = await loadCarrierConnections(db, organizationId);
  const connection = connections.find((row) => row.id === label.carrierConnectionId) ?? null;
  const live = Boolean(
    connection && isLivePostage(connection.provider, connection.mode) && (label.carrierShipmentId || label.carrierLabelId),
  );
  const request = { returnLabelId: label.id, trackingNumber: label.trackingNumber, carrierService: label.carrierService };
  if (live && connection) {
    try {
      await voidLivePostage({
        connection,
        shipmentId: label.carrierShipmentId,
        labelId: label.carrierLabelId,
        trackingNumber: label.trackingNumber,
      });
    } catch (err) {
      await recordCarrierEvent(db, {
        organizationId,
        connectionId: label.carrierConnectionId,
        orderId: rma?.orderId ?? null,
        kind: "void",
        status: "failed",
        request: { ...request, mode: "live" },
        response: { error: err instanceof Error ? err.message : "Void failed" },
      });
      throw asCarrierLiveError(err);
    }
  }
  const now = Date.now();
  await db
    .update(schema.returnLabels)
    .set({ status: "voided", voidedAt: now })
    .where(eq(schema.returnLabels.id, label.id));
  await recordCarrierEvent(db, {
    organizationId,
    connectionId: label.carrierConnectionId,
    orderId: rma?.orderId ?? null,
    kind: "void",
    status: "ok",
    request,
    response: { voided: true, live },
    now,
  });
  const [row] = await db.select().from(schema.returnLabels).where(eq(schema.returnLabels.id, label.id)).limit(1);
  return c.json(serializeReturnLabel(row!, c.get("origin")));
});

/** The customer's return label page. Anyone with the link may read it, so it answers 404 for every miss. */
export const returnLabelsPublicRoute = new Hono<AppEnv>();

returnLabelsPublicRoute.get("/return-label/:token", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  const token = c.req.param("token");
  if (!isPublicToken(token)) return c.json({ error: "Not found" }, 404);
  const db = c.get("db");
  const [label] = await db.select().from(schema.returnLabels).where(eq(schema.returnLabels.token, token)).limit(1);
  if (!label) return c.json({ error: "Not found" }, 404);
  const [org] = await db
    .select({ name: schema.organizations.name, brandColor: schema.organizations.brandColor, logoUrl: schema.organizations.logoUrl })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, label.organizationId))
    .limit(1);
  const [rma] = await db
    .select({ number: schema.rmas.number })
    .from(schema.rmas)
    .where(eq(schema.rmas.id, label.rmaId))
    .limit(1);
  const items = await db
    .select({ name: schema.items.name, qty: schema.rmaLines.qtyExpected })
    .from(schema.rmaLines)
    .innerJoin(schema.items, eq(schema.items.id, schema.rmaLines.itemId))
    .where(eq(schema.rmaLines.rmaId, label.rmaId));
  const receipts = await db
    .select({ payloadJson: schema.trackerWebhookReceipts.payloadJson, createdAt: schema.trackerWebhookReceipts.createdAt })
    .from(schema.trackerWebhookReceipts)
    .where(
      and(
        eq(schema.trackerWebhookReceipts.organizationId, label.organizationId),
        eq(schema.trackerWebhookReceipts.trackingNumber, label.trackingNumber),
      ),
    )
    .orderBy(asc(schema.trackerWebhookReceipts.createdAt));
  return c.json(
    publicReturnLabelView({
      shop: { name: org?.name ?? "", brandColor: org?.brandColor ?? null, logoUrl: org?.logoUrl ?? null },
      rmaNumber: rma?.number ?? "",
      label,
      items,
      receipts,
    }),
  );
});
