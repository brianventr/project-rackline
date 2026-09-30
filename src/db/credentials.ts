import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { readStoredSecret } from "../lib/secret-box";

type CarrierRow = typeof schema.carrierConnections.$inferSelect;
type ShopifyRow = typeof schema.shopifyConnections.$inferSelect;

/** The sealing key, asked for only when a row has something to open. */
export type SecretSource = () => string;

function unchanged(column: SQLiteColumn, value: string | null): SQL {
  return value === null ? isNull(column) : eq(column, value);
}

/** Sealing plain text in place is a convenience; a read must not fail because of it. */
async function reseal(write: Promise<unknown>): Promise<void> {
  try {
    await write;
  } catch (err) {
    console.warn("credential reseal failed", err);
  }
}

/**
 * A carrier row with its API key and secret in the clear. Keys still stored as plain text are sealed
 * in place, unless another write changed them since this read.
 */
export async function openCarrierRow(db: AppDb, secret: SecretSource, row: CarrierRow): Promise<CarrierRow> {
  if (!row.apiKey && !row.apiSecret) return row;
  const key = secret();
  const [apiKey, apiSecret] = await Promise.all([readStoredSecret(key, row.apiKey), readStoredSecret(key, row.apiSecret)]);
  if (apiKey.reseal || apiSecret.reseal) {
    await reseal(
      db
        .update(schema.carrierConnections)
        .set({ apiKey: apiKey.reseal ?? row.apiKey, apiSecret: apiSecret.reseal ?? row.apiSecret })
        .where(
          and(
            eq(schema.carrierConnections.id, row.id),
            unchanged(schema.carrierConnections.apiKey, row.apiKey),
            unchanged(schema.carrierConnections.apiSecret, row.apiSecret),
          ),
        ),
    );
  }
  return { ...row, apiKey: apiKey.value, apiSecret: apiSecret.value };
}

/**
 * A Shopify connection with its Admin token in the clear. A token still stored as plain text is sealed
 * in place, unless another write changed it since this read.
 */
export async function openShopifyRow(db: AppDb, secret: SecretSource, row: ShopifyRow): Promise<ShopifyRow> {
  if (!row.accessToken) return row;
  const token = await readStoredSecret(secret(), row.accessToken);
  if (token.reseal) {
    await reseal(
      db
        .update(schema.shopifyConnections)
        .set({ accessToken: token.reseal })
        .where(
          and(
            eq(schema.shopifyConnections.id, row.id),
            unchanged(schema.shopifyConnections.accessToken, row.accessToken),
          ),
        ),
    );
  }
  return { ...row, accessToken: token.value };
}
