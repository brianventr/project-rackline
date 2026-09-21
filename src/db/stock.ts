import { and, eq, inArray, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  inventoryBalances,
  inventoryMovements,
  locations,
  type MovementType,
} from "./schema";
import {
  chainPlans,
  parseBalanceKey,
  planReceive,
  type MovementDraft,
  type StockPlan,
} from "../domain/inventory";
import { returnReceiveSteps, type ReturnDisposition } from "../domain/return-disposition";
import { newId } from "../lib/ids";
import { appendTraceabilityStatements, expandMovementsForTraceability } from "./traceability";
import { appendAsBuiltStatements } from "./as-built";
import { assertOutboundNotHeld, loadOpenHolds } from "./holds";
import { assertOutboundAtp } from "./allocations";
import { warehousesForMovements } from "../domain/multi-warehouse";
import {
  applyClientMovementsToMap,
  clientBalanceStatements,
  clientKeysFromMovements,
  loadClientBalanceMap,
} from "./client-stock";
import { loadOpenAssignmentForOperator } from "./equipment";
export type AppDb = DrizzleD1Database<typeof import("./schema")>;

export async function loadBalanceMap(
  db: AppDb,
  organizationId: string,
  pairs: { locationId: string; itemId: string }[],
): Promise<Map<string, { id: string; qty: number }>> {
  const unique = new Map<string, { locationId: string; itemId: string }>();
  for (const pair of pairs) {
    unique.set(`${pair.locationId}:${pair.itemId}`, pair);
  }
  const list = [...unique.values()];
  if (list.length === 0) return new Map();

  const rows = await db
    .select()
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.organizationId, organizationId),
        or(
          ...list.map((pair) =>
            and(
              eq(inventoryBalances.locationId, pair.locationId),
              eq(inventoryBalances.itemId, pair.itemId),
            ),
          ),
        ),
      ),
    );

  const map = new Map<string, { id: string; qty: number }>();
  for (const row of rows) {
    map.set(`${row.locationId}:${row.itemId}`, { id: row.id, qty: row.qty });
  }
  return map;
}

export function qtyMap(loaded: Map<string, { id: string; qty: number }>): Map<string, number> {
  const next = new Map<string, number>();
  for (const [key, value] of loaded) {
    next.set(key, value.qty);
  }
  return next;
}

export async function persistStockPlan(
  db: AppDb,
  input: {
    organizationId: string;
    createdBy: string;
    now: number;
    loaded: Map<string, { id: string; qty: number }>;
    plan: StockPlan;
    extra?: BatchItem<"sqlite">[];
    skipShopifySync?: boolean;
  },
): Promise<void> {
  const statements: BatchItem<"sqlite">[] = [...((input.extra as BatchItem<"sqlite">[] | undefined) ?? [])];
  const expanded: MovementDraft[] = await expandMovementsForTraceability(
    db,
    input.organizationId,
    input.plan.movements,
    await loadOpenHolds(db, input.organizationId),
  );

  const locationIds = [
    ...new Set(
      expanded.flatMap((movement) => [movement.fromLocationId, movement.toLocationId].filter(Boolean) as string[]),
    ),
  ];
  const locationWarehouseId = new Map<string, string>();
  if (locationIds.length > 0) {
    const locRows = await db
      .select({ id: locations.id, warehouseId: locations.warehouseId })
      .from(locations)
      .where(
        and(eq(locations.organizationId, input.organizationId), inArray(locations.id, locationIds)),
      );
    for (const row of locRows) locationWarehouseId.set(row.id, row.warehouseId);
  }
  const warehouseScope = warehousesForMovements(expanded, locationWarehouseId);
  const holds =
    warehouseScope.size === 0
      ? await loadOpenHolds(db, input.organizationId)
      : (
          await Promise.all(
            [...warehouseScope].map((warehouseId) => loadOpenHolds(db, input.organizationId, warehouseId)),
          )
        ).flat();

  const movements = expanded;
  assertOutboundNotHeld(movements, holds);
  await assertOutboundAtp(db, input.organizationId, movements, input.loaded, warehouseScope);

  const clientKeys = clientKeysFromMovements(movements);
  const clientLoaded = await loadClientBalanceMap(db, input.organizationId, clientKeys);
  const clientApplied = applyClientMovementsToMap(clientLoaded, movements);
  statements.push(
    ...clientBalanceStatements(db, {
      organizationId: input.organizationId,
      now: input.now,
      loaded: clientApplied.loaded,
      next: clientApplied.next,
    }),
  );
  const custody = await loadOpenAssignmentForOperator(db, input.organizationId, input.createdBy);
  for (const [key, qty] of input.plan.balances) {
    const { locationId, itemId } = parseBalanceKey(key);
    const existing = input.loaded.get(key);
    if (existing) {
      statements.push(
        db
          .update(inventoryBalances)
          .set({ qty, updatedAt: input.now })
          .where(eq(inventoryBalances.id, existing.id)),
      );
    } else {
      statements.push(
        db.insert(inventoryBalances).values({
          id: newId(),
          organizationId: input.organizationId,
          locationId,
          itemId,
          qty,
          updatedAt: input.now,
        }),
      );
    }
  }

  for (const movement of movements) {
    statements.push(
      db.insert(inventoryMovements).values({
        id: newId(),
        organizationId: input.organizationId,
        type: movement.type as MovementType,
        itemId: movement.itemId,
        qty: movement.qty,
        fromLocationId: movement.fromLocationId ?? null,
        toLocationId: movement.toLocationId ?? null,
        refType: movement.refType,
        refId: movement.refId,
        reason: movement.reason ?? null,
        createdAt: input.now,
        createdBy: input.createdBy,
        lotCode: movement.lotCode ?? null,
        serialsJson: movement.serials?.length ? JSON.stringify(movement.serials) : null,
        weightGrams: movement.weightGrams ?? null,
        expiresOn: movement.expiresOn ?? null,
        clientId: movement.clientId ?? null,
        equipmentId: custody?.equipmentId ?? null,
        assignmentId: custody?.id ?? null,
      }),
    );
  }

  await appendTraceabilityStatements(db, {
    organizationId: input.organizationId,
    now: input.now,
    movements,
    statements,
  });
  appendAsBuiltStatements(db, {
    organizationId: input.organizationId,
    now: input.now,
    movements,
    statements,
  });

  if (statements.length === 0) return;
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  if (!input.skipShopifySync) {
    const itemIds = [...new Set(input.plan.movements.map((movement) => movement.itemId))];
    if (itemIds.length > 0) {
      const { scheduleShopifySellableSync } = await import("./shopify-sellable");
      await scheduleShopifySellableSync(db, input.organizationId, itemIds);
    }
  }
}

export async function postReceiveLines(
  db: AppDb,
  input: {
    organizationId: string;
    createdBy: string;
    now: number;
    locationId: string;
    refType: string;
    refId: string;
    clientId?: string | null;
    lines: {
      itemId: string;
      sku?: string;
      qty: number;
      lotCode?: string | null;
      serials?: string[] | null;
      weightGrams?: number | null;
      expiresOn?: number | null;
      disposition?: ReturnDisposition;
    }[];
    extra?: BatchItem<"sqlite">[];
  },
): Promise<void> {
  const loaded = await loadBalanceMap(
    db,
    input.organizationId,
    input.lines.map((line) => ({ locationId: input.locationId, itemId: line.itemId })),
  );
  const plan = chainPlans(
    qtyMap(loaded),
    input.lines.flatMap((line) => {
      if (input.refType === "return") {
        return returnReceiveSteps({
          itemId: line.itemId,
          sku: line.sku ?? line.itemId,
          locationId: input.locationId,
          qty: line.qty,
          refId: input.refId,
          disposition: line.disposition ?? "restock",
          lotCode: line.lotCode,
          serials: line.serials,
          weightGrams: line.weightGrams,
          expiresOn: line.expiresOn,
        });
      }
      return [
        (balances: Map<string, number>) =>
          planReceive({
            itemId: line.itemId,
            locationId: input.locationId,
            qty: line.qty,
            refId: input.refId,
            refType: input.refType,
            lotCode: line.lotCode,
            serials: line.serials,
            weightGrams: line.weightGrams,
            expiresOn: line.expiresOn,
            clientId: input.clientId,
            balances,
          }),
      ];
    }),
  );
  await persistStockPlan(db, {
    organizationId: input.organizationId,
    createdBy: input.createdBy,
    now: input.now,
    loaded,
    plan,
    extra: input.extra,
  });
}
