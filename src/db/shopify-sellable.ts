import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { newId } from "../lib/ids";
import { applyHoldsToOnHand } from "../domain/holds";
import {
  computeSellable,
  demoInventoryItemGid,
  demoShopifyLocationGid,
  isOpenPickStatus,
  remainingToPickQty,
} from "../domain/shopify-sellable";
import { INVENTORY_SET_QUANTITIES_MUTATION, buildInventorySetQuantitiesInput } from "../domain/shopify";
import { loadOpenHolds, loadHeldLotQuantities } from "./holds";
import {
  ShopifyApiError,
  createShopifyGraphqlClient,
  fetchShopifyLocations,
  lookupInventoryItemBySku,
  setShopifyAvailableQuantities,
} from "../lib/shopify-client";

export type SellableRow = {
  itemId: string;
  sku: string;
  name: string;
  onHand: number;
  held: number;
  remainingToPick: number;
  available: number;
  sellable: number;
  shopifyInventoryItemGid: string | null;
};

export type SellableSyncResult = {
  status: "synced" | "demo" | "skipped" | "failed";
  locationGid: string | null;
  rows: Array<{ sku: string; sellable: number; inventoryItemId: string }>;
  skipped: Array<{ sku: string; reason: string }>;
  error?: string | null;
  code?: string | null;
};

async function recordOutbound(
  db: AppDb,
  input: {
    organizationId: string;
    kind: string;
    status: string;
    request: unknown;
    response: unknown;
  },
) {
  await db.insert(schema.shopifyOutboundEvents).values({
    id: newId(),
    organizationId: input.organizationId,
    orderId: null,
    kind: input.kind,
    status: input.status,
    requestJson: JSON.stringify(input.request),
    responseJson: input.response == null ? null : JSON.stringify(input.response),
    createdAt: Date.now(),
  });
}

export async function loadSellableRows(
  db: AppDb,
  organizationId: string,
  itemIds?: string[],
): Promise<SellableRow[]> {
  const items = await db
    .select({
      id: schema.items.id,
      sku: schema.items.sku,
      name: schema.items.name,
      shopifyInventoryItemGid: schema.items.shopifyInventoryItemGid,
    })
    .from(schema.items)
    .where(
      and(
        eq(schema.items.organizationId, organizationId),
        itemIds?.length ? inArray(schema.items.id, itemIds) : undefined,
      ),
    );
  if (items.length === 0) return [];

  const balances = await db
    .select({
      itemId: schema.inventoryBalances.itemId,
      locationId: schema.inventoryBalances.locationId,
      qty: schema.inventoryBalances.qty,
    })
    .from(schema.inventoryBalances)
    .where(
      and(
        eq(schema.inventoryBalances.organizationId, organizationId),
        itemIds?.length ? inArray(schema.inventoryBalances.itemId, itemIds) : undefined,
      ),
    );

  const holds = await loadOpenHolds(db, organizationId);
  const lotQtys = await loadHeldLotQuantities(db, organizationId, holds);
  const availableRows = applyHoldsToOnHand(balances, holds, lotQtys);

  const onHandByItem = new Map<string, number>();
  const availableByItem = new Map<string, number>();
  for (const row of balances) {
    onHandByItem.set(row.itemId, (onHandByItem.get(row.itemId) ?? 0) + Math.max(0, row.qty));
  }
  for (const row of availableRows) {
    availableByItem.set(row.itemId, (availableByItem.get(row.itemId) ?? 0) + Math.max(0, row.qty));
  }

  const openLines = await db
    .select({
      itemId: schema.orderLines.itemId,
      qty: schema.orderLines.qty,
      qtyPicked: schema.orderLines.qtyPicked,
      status: schema.orders.status,
    })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .where(
      and(
        eq(schema.orders.organizationId, organizationId),
        itemIds?.length ? inArray(schema.orderLines.itemId, itemIds) : undefined,
      ),
    );

  const remainingByItem = new Map<string, number>();
  for (const line of openLines) {
    if (!isOpenPickStatus(line.status)) continue;
    remainingByItem.set(
      line.itemId,
      (remainingByItem.get(line.itemId) ?? 0) + remainingToPickQty(line.qty, line.qtyPicked),
    );
  }

  return items.map((item) => {
    const onHand = onHandByItem.get(item.id) ?? 0;
    const available = availableByItem.get(item.id) ?? 0;
    const held = Math.max(0, onHand - available);
    const remainingToPick = remainingByItem.get(item.id) ?? 0;
    const next = computeSellable({ onHand, held, remainingToPick });
    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      shopifyInventoryItemGid: item.shopifyInventoryItemGid,
      ...next,
    };
  });
}

async function resolveInventoryItemGid(
  db: AppDb,
  item: SellableRow,
  mode: string,
  client: ReturnType<typeof createShopifyGraphqlClient> | null,
): Promise<string | null> {
  if (item.shopifyInventoryItemGid) return item.shopifyInventoryItemGid;
  if (mode !== "live") {
    const gid = demoInventoryItemGid(item.sku);
    await db.update(schema.items).set({ shopifyInventoryItemGid: gid }).where(eq(schema.items.id, item.itemId));
    return gid;
  }
  if (!client) return null;
  try {
    const gid = await lookupInventoryItemBySku(client, item.sku);
    if (!gid) return null;
    await db.update(schema.items).set({ shopifyInventoryItemGid: gid }).where(eq(schema.items.id, item.itemId));
    return gid;
  } catch {
    return null;
  }
}

export async function syncShopifySellable(
  db: AppDb,
  organizationId: string,
  options?: { itemIds?: string[]; strict?: boolean },
): Promise<SellableSyncResult> {
  const [connection] = await db
    .select()
    .from(schema.shopifyConnections)
    .where(eq(schema.shopifyConnections.organizationId, organizationId))
    .limit(1);
  if (!connection) {
    if (options?.strict) {
      return { status: "skipped", locationGid: null, rows: [], skipped: [], error: "Shopify is not connected", code: "NOT_CONNECTED" };
    }
    return { status: "skipped", locationGid: null, rows: [], skipped: [] };
  }

  const rows = await loadSellableRows(db, organizationId, options?.itemIds);
  const live = connection.mode === "live" && Boolean(connection.accessToken);
  const locationGid = connection.shopifyLocationGid || (live ? null : demoShopifyLocationGid());
  if (live && !locationGid) {
    const error = "Set a Shopify location before pushing sellable qty.";
    await recordOutbound(db, {
      organizationId,
      kind: "inventorySetQuantities",
      status: "failed",
      request: { itemIds: rows.map((row) => row.sku) },
      response: { error, code: "MISSING_LOCATION" },
    });
    return { status: "failed", locationGid: null, rows: [], skipped: [], error, code: "MISSING_LOCATION" };
  }

  const client =
    live && connection.accessToken
      ? createShopifyGraphqlClient({
          shopDomain: connection.shopDomain,
          accessToken: connection.accessToken,
          apiVersion: connection.apiVersion,
        })
      : null;

  const quantities: Array<{ sku: string; sellable: number; inventoryItemId: string }> = [];
  const skipped: Array<{ sku: string; reason: string }> = [];
  for (const row of rows) {
    const gid = await resolveInventoryItemGid(db, row, connection.mode, client);
    if (!gid) {
      skipped.push({ sku: row.sku, reason: "No Shopify inventory item for this SKU" });
      continue;
    }
    quantities.push({ sku: row.sku, sellable: row.sellable, inventoryItemId: gid });
  }

  const request = {
    query: INVENTORY_SET_QUANTITIES_MUTATION,
    variables: {
      input: buildInventorySetQuantitiesInput({
        locationId: locationGid!,
        quantities: quantities.map((row) => ({ inventoryItemId: row.inventoryItemId, quantity: row.sellable })),
      }),
    },
  };

  if (!live || !client) {
    await recordOutbound(db, {
      organizationId,
      kind: "inventorySetQuantities",
      status: "demo",
      request,
      response: { mode: "demo", locationGid, quantities, skipped },
    });
    return { status: "demo", locationGid, rows: quantities, skipped };
  }

  if (quantities.length === 0) {
    await recordOutbound(db, {
      organizationId,
      kind: "inventorySetQuantities",
      status: "skipped",
      request,
      response: { skipped },
    });
    return { status: "skipped", locationGid, rows: [], skipped };
  }

  try {
    const response = await setShopifyAvailableQuantities(client, {
      locationId: locationGid!,
      quantities: quantities.map((row) => ({ inventoryItemId: row.inventoryItemId, quantity: row.sellable })),
    });
    await recordOutbound(db, {
      organizationId,
      kind: "inventorySetQuantities",
      status: "ok",
      request,
      response,
    });
    return { status: "synced", locationGid, rows: quantities, skipped };
  } catch (err) {
    const message = err instanceof ShopifyApiError ? err.message : err instanceof Error ? err.message : "Inventory sync failed";
    await recordOutbound(db, {
      organizationId,
      kind: "inventorySetQuantities",
      status: "failed",
      request,
      response: err instanceof ShopifyApiError ? err.body : { error: message },
    });
    return { status: "failed", locationGid, rows: quantities, skipped, error: message };
  }
}

export async function scheduleShopifySellableSync(
  db: AppDb,
  organizationId: string,
  itemIds?: string[],
): Promise<void> {
  try {
    await syncShopifySellable(db, organizationId, { itemIds });
  } catch {
    // Stock posts must not fail because Shopify was unreachable.
  }
}

export async function listShopifyLocationsForOrg(db: AppDb, organizationId: string) {
  const [connection] = await db
    .select()
    .from(schema.shopifyConnections)
    .where(eq(schema.shopifyConnections.organizationId, organizationId))
    .limit(1);
  if (!connection) return [];
  if (connection.mode !== "live" || !connection.accessToken) {
    return [{ id: demoShopifyLocationGid(), name: "Main (demo)", fulfillsOnlineOrders: true }];
  }
  const client = createShopifyGraphqlClient({
    shopDomain: connection.shopDomain,
    accessToken: connection.accessToken,
    apiVersion: connection.apiVersion,
  });
  return fetchShopifyLocations(client);
}
