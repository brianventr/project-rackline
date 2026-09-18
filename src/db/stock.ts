import { and, eq, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  inventoryBalances,
  inventoryMovements,
  type MovementType,
} from "./schema";
import {
  parseBalanceKey,
  type StockPlan,
} from "../domain/inventory";
import { newId } from "../lib/ids";

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
  },
): Promise<void> {
  const statements: BatchItem<"sqlite">[] = [...((input.extra as BatchItem<"sqlite">[] | undefined) ?? [])];

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

  for (const movement of input.plan.movements) {
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
      }),
    );
  }

  if (statements.length === 0) return;
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}
