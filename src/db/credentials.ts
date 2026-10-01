import { and, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { readStoredSecret, sealSecret, secretFingerprint } from "../lib/secret-box";

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

/** A tracker webhook secret as stored: sealed, plus the fingerprint a webhook looks up. */
export async function sealWebhookSecret(
  secret: SecretSource,
  plain: string | null | undefined,
): Promise<{ webhookSecret: string | null; webhookSecretFp: string | null }> {
  const value = plain?.trim() || null;
  if (!value) return { webhookSecret: null, webhookSecretFp: null };
  return {
    webhookSecret: await sealSecret(secret(), value),
    webhookSecretFp: await secretFingerprint(value),
  };
}

/**
 * A carrier row with its API key, secret, meter number, and tracker webhook secret in the clear.
 * Values still stored as plain text are sealed in place, unless another write changed them since this
 * read. A plain webhook secret also gains its fingerprint on that write.
 */
export async function openCarrierRow(db: AppDb, secret: SecretSource, row: CarrierRow): Promise<CarrierRow> {
  const keyFields = CARRIER_SECRET_FIELDS.filter((field) => row[field]);
  const hasWebhook = Boolean(row.webhookSecret);
  if (keyFields.length === 0 && !hasWebhook) return row;
  const key = secret();
  const opened = { ...row };
  const patch: Partial<Pick<CarrierRow, CarrierSecretField | "webhookSecret" | "webhookSecretFp">> = {};
  for (const field of keyFields) {
    const read = await readStoredSecret(key, row[field]);
    opened[field] = read.value;
    if (read.reseal) patch[field] = read.reseal;
  }
  if (hasWebhook) {
    const read = await readStoredSecret(key, row.webhookSecret);
    opened.webhookSecret = read.value;
    if (read.reseal && read.value) {
      patch.webhookSecret = read.reseal;
      patch.webhookSecretFp = await secretFingerprint(read.value);
    } else if (read.value && !row.webhookSecretFp) {
      patch.webhookSecretFp = await secretFingerprint(read.value);
    }
  }
  const touched = Object.keys(patch) as (keyof typeof patch)[];
  if (touched.length > 0) {
    await reseal(
      db
        .update(schema.carrierConnections)
        .set(patch)
        .where(
          and(
            eq(schema.carrierConnections.id, row.id),
            ...keyFields
              .filter((field) => patch[field])
              .map((field) => eq(schema.carrierConnections[field], row[field]!)),
            ...(patch.webhookSecret || patch.webhookSecretFp
              ? [eq(schema.carrierConnections.webhookSecret, row.webhookSecret!)]
              : []),
          ),
        ),
    );
  }
  return opened;
}

/**
 * A Shopify connection with its Admin token and webhook secret in the clear. A value still stored as
 * plain text is sealed in place, unless another write changed it since this read. A secret this
 * deployment cannot open comes back empty so a later save does not seal the ciphertext.
 */
export async function openShopifyRow(db: AppDb, secret: SecretSource, row: ShopifyRow): Promise<ShopifyRow> {
  if (!row.accessToken && !row.webhookSecret) return row;
  const key = secret();
  const token = row.accessToken ? await readStoredSecret(key, row.accessToken) : { value: row.accessToken, reseal: null };
  const hook = row.webhookSecret ? await readStoredSecret(key, row.webhookSecret) : { value: row.webhookSecret, reseal: null };
  const patch: Partial<Pick<ShopifyRow, "accessToken" | "webhookSecret">> = {};
  if (token.reseal) patch.accessToken = token.reseal;
  if (hook.reseal) patch.webhookSecret = hook.reseal;
  if (patch.accessToken || patch.webhookSecret) {
    await reseal(
      db
        .update(schema.shopifyConnections)
        .set(patch)
        .where(
          and(
            eq(schema.shopifyConnections.id, row.id),
            ...(patch.accessToken && row.accessToken
              ? [eq(schema.shopifyConnections.accessToken, row.accessToken)]
              : []),
            ...(patch.webhookSecret ? [eq(schema.shopifyConnections.webhookSecret, row.webhookSecret)] : []),
          ),
        ),
    );
  }
  return { ...row, accessToken: token.value, webhookSecret: hook.value ?? "" };
}
