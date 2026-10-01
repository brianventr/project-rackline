import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../lib/types";
import { badRequest, notFound } from "../lib/http";
import { loadCustomsLines } from "../db/customs";
import { resolveParcel } from "../domain/carrier-live";
import {
  customsFormKind,
  customsGaps,
  declaredCustoms,
  labelCountries,
  parseCustomsPatch,
  quoteCustoms,
} from "../domain/customs";
import { buildingAddress, crossesBorder, orderAddress } from "../domain/ship-address";

export const customsRoute = new Hono<AppEnv>();

const ITEM_CUSTOMS = {
  id: schema.items.id,
  sku: schema.items.sku,
  hsCode: schema.items.hsCode,
  originCountry: schema.items.originCountry,
  customsDescription: schema.items.customsDescription,
  customsValueCents: schema.items.customsValueCents,
};

customsRoute.patch("/items/:id/customs", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) badRequest("Invalid JSON");
  const parsed = parseCustomsPatch(body);
  if (!parsed.ok) badRequest(parsed.error);
  if (Object.keys(parsed.patch).length === 0) badRequest("Nothing to update");
  const [row] = await c
    .get("db")
    .update(schema.items)
    .set(parsed.patch)
    .where(and(eq(schema.items.id, c.req.param("id")), eq(schema.items.organizationId, c.get("organizationId")!)))
    .returning(ITEM_CUSTOMS);
  if (!row) notFound("Item not found");
  return c.json(row);
});

/** The declaration that prints with a label: what its purchase sent, or what the items say now when none was sent. */
customsRoute.get("/orders/:id/customs", async (c) => {
  const db = c.get("db");
  const organizationId = c.get("organizationId")!;
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, c.req.param("id")), eq(schema.orders.organizationId, organizationId)))
    .limit(1);
  if (!order) notFound("Order not found");
  const packageId = c.req.query("packageId");
  let label = { trackingNumber: order.trackingNumber, formUrl: order.customsFormUrl, weightOz: order.packageWeightOz };
  let lines: Array<{ itemId: string; qty: number }>;
  if (packageId) {
    const [pkg] = await db
      .select({
        id: schema.orderPackages.id,
        trackingNumber: schema.orderPackages.trackingNumber,
        customsFormUrl: schema.orderPackages.customsFormUrl,
        weightOz: schema.orderPackages.weightOz,
      })
      .from(schema.orderPackages)
      .where(and(eq(schema.orderPackages.id, packageId), eq(schema.orderPackages.orderId, order.id)))
      .limit(1);
    if (!pkg) notFound("Carton not found");
    label = { trackingNumber: pkg.trackingNumber, formUrl: pkg.customsFormUrl, weightOz: pkg.weightOz };
    lines = await db
      .select({ itemId: schema.orderPackageLines.itemId, qty: schema.orderPackageLines.qty })
      .from(schema.orderPackageLines)
      .where(eq(schema.orderPackageLines.packageId, pkg.id));
  } else {
    lines = await db
      .select({ itemId: schema.orderLines.itemId, qty: schema.orderLines.qty })
      .from(schema.orderLines)
      .where(eq(schema.orderLines.orderId, order.id));
  }
  const [warehouse] = await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, order.warehouseId)).limit(1);
  const { from, to } = labelCountries({ shipFrom: buildingAddress(warehouse), shipTo: orderAddress(order) });
  const base = { fromCountry: from, toCountry: to, formUrl: null, formKind: null, declaration: null, declared: false, gaps: [] };
  if (!crossesBorder(from, to)) return c.json({ international: false, ...base });

  const events = label.trackingNumber
    ? await db
        .select({ requestJson: schema.carrierOutboundEvents.requestJson, responseJson: schema.carrierOutboundEvents.responseJson })
        .from(schema.carrierOutboundEvents)
        .where(
          and(
            eq(schema.carrierOutboundEvents.organizationId, organizationId),
            eq(schema.carrierOutboundEvents.orderId, order.id),
            eq(schema.carrierOutboundEvents.kind, "buy"),
            eq(schema.carrierOutboundEvents.status, "ok"),
          ),
        )
        .orderBy(desc(schema.carrierOutboundEvents.createdAt))
        .limit(25)
    : [];
  const declared = declaredCustoms(events, label.trackingNumber);
  const customsLines = declared ? [] : await loadCustomsLines(db, organizationId, lines);
  const gaps = declared ? [] : customsGaps(customsLines);
  let declaration = declared;
  if (!declaration && !gaps.length) {
    const [org] = await db
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1);
    declaration = quoteCustoms({
      fromCountry: from,
      toCountry: to,
      lines: customsLines,
      parcelWeightOz: resolveParcel({ weightOz: label.weightOz ?? undefined }).weightOz,
      signer: org?.name || warehouse?.name || "Shipper",
      invoiceNumber: order.number,
    });
  }
  return c.json({
    ...base,
    international: true,
    formUrl: label.formUrl,
    formKind: declaration ? customsFormKind(declaration.valueCents) : null,
    declaration,
    declared: Boolean(declared),
    gaps,
  });
});
