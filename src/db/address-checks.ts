import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { verifyAggregatorAddress } from "../lib/carrier-client";
import { isLiveAggregator } from "../domain/carrier-live";
import { withTimeout } from "../domain/rate-choice";
import { destColumns, resolvePlace } from "../domain/geo";
import {
  addressHash,
  addressVerdict,
  isVerifiable,
  shipToParts,
  storedVerification,
  type AddressProvider,
  type AddressVerdict,
  type AddressVerification,
} from "../domain/address-check";
import { formatShipAddress, orderAddress, type ShipAddressParts } from "../domain/ship-address";

type AddressCheckRow = typeof schema.addressChecks.$inferSelect;

/** Checks already on file for a set of orders, keyed by order and address hash. */
export type AddressChecks = Map<string, AddressCheckRow>;

type CheckOrder = {
  id: string;
  customerName: string;
  shipToAddress: string | null;
  shipToCity: string | null;
  shipToRegion: string | null;
  shipToCountry: string | null;
};

type VerifyAccount = { provider: string; mode: string; apiKey: string | null; isDefault: boolean };

const VERIFY_TIMEOUT_MS = 4000;

const checkKey = (orderId: string, hash: string) => `${orderId}:${hash}`;

export async function loadAddressChecks(db: AppDb, organizationId: string, orderIds: string[]): Promise<AddressChecks> {
  if (!orderIds.length) return new Map();
  const rows = await db
    .select()
    .from(schema.addressChecks)
    .where(and(eq(schema.addressChecks.organizationId, organizationId), inArray(schema.addressChecks.orderId, orderIds)));
  return new Map(rows.map((row) => [checkKey(row.orderId, row.addressHash), row]));
}

async function loadAddressCheck(db: AppDb, organizationId: string, orderId: string, hash: string) {
  const [row] = await db
    .select()
    .from(schema.addressChecks)
    .where(
      and(
        eq(schema.addressChecks.organizationId, organizationId),
        eq(schema.addressChecks.orderId, orderId),
        eq(schema.addressChecks.addressHash, hash),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The live EasyPost or ShipEngine account that looks addresses up, the default one first. */
function verifyAccount(connections: VerifyAccount[]): (VerifyAccount & { provider: AddressProvider; apiKey: string }) | null {
  const account = [...connections]
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    .find((row) => isLiveAggregator(row.provider, row.mode) && row.apiKey);
  return account ? (account as VerifyAccount & { provider: AddressProvider; apiKey: string }) : null;
}

async function saveAddressCheck(
  db: AppDb,
  input: { organizationId: string; orderId: string; hash: string; verification: AddressVerification },
) {
  const { verification } = input;
  const answer = {
    provider: verification.provider,
    status: verification.status,
    message: verification.message,
    suggestionJson: verification.suggestion ? JSON.stringify(verification.suggestion) : null,
    checkedAt: Date.now(),
  };
  await db
    .insert(schema.addressChecks)
    .values({ id: newId(), organizationId: input.organizationId, orderId: input.orderId, addressHash: input.hash, ...answer })
    .onConflictDoUpdate({ target: [schema.addressChecks.orderId, schema.addressChecks.addressHash], set: answer });
}

function orderParts(order: CheckOrder, shipToAddress: string | null | undefined, buildingCountry: string | null | undefined) {
  return shipToParts(orderAddress(order, shipToAddress ?? undefined), buildingCountry);
}

/**
 * Whether a label may be bought for this order to `shipToAddress`, the order's own address when unset. The local
 * checks always run. With `verify`, a live EasyPost or ShipEngine account is asked about an address it has not
 * answered for yet and its answer is kept; one that fails or runs out of time is asked again next check.
 */
export async function orderAddressVerdict(
  db: AppDb,
  organizationId: string,
  input: {
    order: CheckOrder;
    shipToAddress?: string | null;
    buildingCountry?: string | null;
    connections: VerifyAccount[];
    verify: boolean;
    checks?: AddressChecks;
  },
): Promise<AddressVerdict> {
  const { order } = input;
  const parts = orderParts(order, input.shipToAddress, input.buildingCountry);
  const hash = addressHash(parts);
  const row = input.checks
    ? (input.checks.get(checkKey(order.id, hash)) ?? null)
    : await loadAddressCheck(db, organizationId, order.id, hash);
  if (row?.overrideAt) return addressVerdict({ parts, overridden: true });
  let verification = row ? storedVerification(row) : null;
  const account = input.verify && !verification && isVerifiable(parts) ? verifyAccount(input.connections) : null;
  if (account) {
    try {
      verification = await withTimeout(
        verifyAggregatorAddress({ provider: account.provider, apiKey: account.apiKey, parts, name: order.customerName }),
        VERIFY_TIMEOUT_MS,
        "The address check ran out of time",
      );
      await saveAddressCheck(db, { organizationId, orderId: order.id, hash, verification });
    } catch (err) {
      console.warn("address check failed", err);
    }
  }
  return addressVerdict({ parts, verification });
}

/** "Ship anyway to this address": later checks of this order at this exact address let the label through. */
export async function acceptOrderAddress(
  db: AppDb,
  organizationId: string,
  input: { order: CheckOrder; shipToAddress?: string | null; buildingCountry?: string | null; userId: string },
): Promise<string> {
  const hash = addressHash(orderParts(input.order, input.shipToAddress, input.buildingCountry));
  const now = Date.now();
  const override = { overrideBy: input.userId, overrideAt: now };
  await db
    .insert(schema.addressChecks)
    .values({
      id: newId(),
      organizationId,
      orderId: input.order.id,
      addressHash: hash,
      provider: null,
      status: "unchecked",
      checkedAt: now,
      ...override,
    })
    .onConflictDoUpdate({ target: [schema.addressChecks.orderId, schema.addressChecks.addressHash], set: override });
  return hash;
}

/**
 * Writes the carrier's corrected address onto the order, and keeps the carrier's word for it so it is not asked
 * again. Null when the carrier has not offered one for the order's current address.
 */
export async function applySuggestedAddress(
  db: AppDb,
  organizationId: string,
  input: { order: CheckOrder; buildingCountry?: string | null },
): Promise<{ shipToAddress: string; suggestion: ShipAddressParts } | null> {
  const { order } = input;
  const parts = orderParts(order, null, input.buildingCountry);
  const row = await loadAddressCheck(db, organizationId, order.id, addressHash(parts));
  const verification = row ? storedVerification(row) : null;
  const { suggestion } = addressVerdict({ parts, verification });
  if (!verification || !suggestion) return null;
  const shipToAddress = formatShipAddress(suggestion);
  const dest = destColumns(
    resolvePlace({ city: suggestion.city, region: suggestion.region, postal: suggestion.postal, country: suggestion.country }),
  );
  const next = { ...order, shipToAddress, ...dest, shipToCountry: dest.shipToCountry ?? suggestion.country };
  await db
    .update(schema.orders)
    .set({ shipToAddress, ...dest, shipToCountry: next.shipToCountry })
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.organizationId, organizationId)));
  await saveAddressCheck(db, {
    organizationId,
    orderId: order.id,
    hash: addressHash(orderParts(next, null, input.buildingCountry)),
    verification: { provider: verification.provider, status: "valid", message: null, suggestion: null },
  });
  return { shipToAddress, suggestion };
}
