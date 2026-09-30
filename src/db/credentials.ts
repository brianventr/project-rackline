import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { readStoredSecret } from "../lib/secret-box";

type CarrierRow = typeof schema.carrierConnections.$inferSelect;
type ShopifyRow = typeof schema.shopifyConnections.$inferSelect;

/** The sealing key, asked for only when a row has something to open. */
export type SecretSource = () => string;

/** Carrier columns sealed at rest. FedEx keeps its OAuth client secret in the meter number. */
export const CARRIER_SECRET_FIELDS = ["apiKey", "apiSecret", "meterNumber"] as const;
export type CarrierSecretField = (typeof CARRIER_SECRET_FIELDS)[number];

/** Sealing plain text in place is a convenience; a read must not fail because of it. */
async function reseal(write: Promise<unknown>): Promise<void> {
  try {
    await write;
  } catch (err) {
    console.warn("credential reseal failed", err);
  }
}

/**
 * A carrier row with its API key, secret, and meter number in the clear. Values still stored as plain
 * text are sealed in place, unless another write changed them since this read.
 */
export async function openCarrierRow(db: AppDb, secret: SecretSource, row: CarrierRow): Promise<CarrierRow> {
  if (!CARRIER_SECRET_FIELDS.some((field) => row[field])) return row;
  const key = secret();
  const opened = { ...row };
  const resealed: Partial<Record<CarrierSecretField, string>> = {};
  for (const field of CARRIER_SECRET_FIELDS) {
    const read = await readStoredSecret(key, row[field]);
    opened[field] = read.value;
    if (read.reseal) resealed[field] = read.reseal;
  }
  const fields = Object.keys(resealed) as CarrierSecretField[];
  if (fields.length > 0) {
    await reseal(
      db
        .update(schema.carrierConnections)
        .set(resealed)
        .where(
          and(
            eq(schema.carrierConnections.id, row.id),
            ...fields.map((field) => eq(schema.carrierConnections[field], row[field]!)),
          ),
        ),
    );
  }
  return opened;
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
          and(eq(schema.shopifyConnections.id, row.id), eq(schema.shopifyConnections.accessToken, row.accessToken)),
        ),
    );
  }
  return { ...row, accessToken: token.value };
}
