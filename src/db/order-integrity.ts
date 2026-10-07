import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { isUniqueViolation } from "../lib/db-errors";

export async function noteShopifySignal(
  db: AppDb,
  input: {
    organizationId: string;
    shopifyOrderId: string;
    shopifyOrderName?: string | null;
    kind: "paid" | "cancel" | "missing_sku";
    sku?: string | null;
    payload?: unknown;
    now?: number;
  },
): Promise<void> {
  const sku = (input.sku ?? "").trim().toUpperCase();
  try {
    await db.insert(schema.shopifyOrderSignals).values({
      id: newId(),
      organizationId: input.organizationId,
      shopifyOrderId: input.shopifyOrderId,
      shopifyOrderName: input.shopifyOrderName?.trim() || null,
      kind: input.kind,
      sku,
      payloadJson: input.payload == null ? null : JSON.stringify(input.payload),
      receivedAt: input.now ?? Date.now(),
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}

export async function loadPaidSignalPayload(
  db: AppDb,
  organizationId: string,
  shopifyOrderId: string,
): Promise<unknown | null> {
  const [row] = await db
    .select({ payloadJson: schema.shopifyOrderSignals.payloadJson })
    .from(schema.shopifyOrderSignals)
    .where(
      and(
        eq(schema.shopifyOrderSignals.organizationId, organizationId),
        eq(schema.shopifyOrderSignals.shopifyOrderId, shopifyOrderId),
        eq(schema.shopifyOrderSignals.kind, "paid"),
      ),
    )
    .limit(1);
  if (!row?.payloadJson) return null;
  try {
    return JSON.parse(row.payloadJson) as unknown;
  } catch {
    return null;
  }
}
