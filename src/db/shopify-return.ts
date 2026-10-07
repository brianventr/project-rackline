import { eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { isUniqueViolation } from "../lib/db-errors";
import {
  SHOPIFY_FULFILLMENT_LINES,
  SHOPIFY_RETURN_CREATE,
  matchReturnLines,
  type ShopifyReturnLine,
} from "../domain/shopify-return";
import type { ShopifyGraphqlClient } from "../lib/shopify-client";

export async function enqueueShopifyReturn(
  db: AppDb,
  input: {
    organizationId: string;
    rmaId: string;
    lines: ShopifyReturnLine[];
    now: number;
  },
): Promise<void> {
  const [rma] = await db
    .select({ orderId: schema.rmas.orderId, number: schema.rmas.number })
    .from(schema.rmas)
    .where(eq(schema.rmas.id, input.rmaId))
    .limit(1);
  if (!rma?.orderId) return;
  const [order] = await db
    .select({ shopifyOrderGid: schema.orders.shopifyOrderGid, source: schema.orders.source })
    .from(schema.orders)
    .where(eq(schema.orders.id, rma.orderId))
    .limit(1);
  if (!order?.shopifyOrderGid || order.source !== "shopify") return;
  try {
    await db.insert(schema.eventOutbox).values({
      id: newId(),
      organizationId: input.organizationId,
      destination: "shopify_return",
      idempotencyKey: `shopify_return:${input.rmaId}`,
      payloadJson: JSON.stringify({ orderGid: order.shopifyOrderGid, rma: rma.number, lines: input.lines }),
      attempts: 0,
      status: "pending",
      createdAt: input.now,
      updatedAt: input.now,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}

export async function sendShopifyReturn(client: ShopifyGraphqlClient, payload: { orderGid?: string; lines?: ShopifyReturnLine[] }): Promise<void> {
  const orderGid = payload.orderGid;
  const lines = payload.lines ?? [];
  if (!orderGid || lines.length === 0) throw new Error("Shopify order is missing, so the return was not opened");
  const data = await client.graphql<{
    order?: {
      fulfillments?: { fulfillmentLineItems?: { nodes?: { id: string; quantity: number; lineItem?: { sku?: string | null } }[] } }[];
    };
  }>(SHOPIFY_FULFILLMENT_LINES, { id: orderGid });
  const fulfilled = (data.order?.fulfillments ?? []).flatMap((fulfillment) =>
    (fulfillment.fulfillmentLineItems?.nodes ?? []).map((node) => ({
      id: node.id,
      sku: node.lineItem?.sku ?? null,
      quantity: node.quantity,
    })),
  );
  const matched = matchReturnLines(lines, fulfilled);
  if (matched.length === 0) throw new Error("No fulfilled Shopify line matches this return");
  const result = await client.graphql<{ returnCreate?: { userErrors?: { message?: string }[] } }>(SHOPIFY_RETURN_CREATE, {
    returnInput: { orderId: orderGid, returnLineItems: matched },
  });
  const userError = result.returnCreate?.userErrors?.find((item) => item.message)?.message;
  if (userError) throw new Error(userError);
}
