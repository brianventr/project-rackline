import { and, eq, inArray, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { clientBalances } from "./schema";
import type { AppDb } from "./stock";
import {
  applyClientOutbound,
  applyClientReceive,
  assertOwnStockPicks,
  clientBalanceKey,
  isClientInboundMovement,
  isClientOutboundMovement,
} from "../domain/client-stock";
import { balanceKey, type MovementDraft } from "../domain/inventory";
import { newId } from "../lib/ids";

export type ClientBalanceLoaded = Map<string, { id: string; qty: number }>;

export async function loadClientBalanceMap(
  db: AppDb,
  organizationId: string,
  keys: { locationId: string; itemId: string; clientId: string }[],
): Promise<ClientBalanceLoaded> {
  const unique = new Map<string, { locationId: string; itemId: string; clientId: string }>();
  for (const key of keys) {
    unique.set(clientBalanceKey(key.locationId, key.itemId, key.clientId), key);
  }
  const list = [...unique.values()];
  if (list.length === 0) return new Map();

  const rows = await db
    .select()
    .from(clientBalances)
    .where(
      and(
        eq(clientBalances.organizationId, organizationId),
        or(
          ...list.map((pair) =>
            and(
              eq(clientBalances.locationId, pair.locationId),
              eq(clientBalances.itemId, pair.itemId),
              eq(clientBalances.clientId, pair.clientId),
            ),
          ),
        ),
      ),
    );

  const map = new Map<string, { id: string; qty: number }>();
  for (const row of rows) {
    map.set(clientBalanceKey(row.locationId, row.itemId, row.clientId), { id: row.id, qty: row.qty });
  }
  return map;
}

export function applyClientMovementsToMap(
  loaded: ClientBalanceLoaded,
  movements: MovementDraft[],
): { next: Map<string, number>; loaded: ClientBalanceLoaded } {
  let qtyMap = new Map<string, number>();
  for (const [key, row] of loaded) {
    qtyMap.set(key, row.qty);
  }
  for (const movement of movements) {
    if (!movement.clientId) continue;
    if (isClientInboundMovement(movement.type) && movement.toLocationId) {
      qtyMap = applyClientReceive(qtyMap, {
        locationId: movement.toLocationId,
        itemId: movement.itemId,
        clientId: movement.clientId,
        qty: movement.qty,
      });
    }
    if (isClientOutboundMovement(movement.type) && movement.fromLocationId) {
      qtyMap = applyClientOutbound(qtyMap, {
        locationId: movement.fromLocationId,
        itemId: movement.itemId,
        clientId: movement.clientId,
        qty: movement.qty,
      });
    }
  }
  return { next: qtyMap, loaded };
}

export function clientBalanceStatements(
  db: AppDb,
  input: {
    organizationId: string;
    now: number;
    loaded: ClientBalanceLoaded;
    next: Map<string, number>;
  },
): BatchItem<"sqlite">[] {
  const statements: BatchItem<"sqlite">[] = [];
  const touched = new Set([...input.next.keys(), ...input.loaded.keys()]);
  for (const key of touched) {
    const qty = input.next.get(key) ?? 0;
    const existing = input.loaded.get(key);
    const parts = key.split(":");
    const locationId = parts[0]!;
    const itemId = parts[1]!;
    const clientId = parts[2]!;
    if (existing) {
      if (qty <= 0) {
        statements.push(db.delete(clientBalances).where(eq(clientBalances.id, existing.id)));
      } else if (qty !== existing.qty) {
        statements.push(
          db.update(clientBalances).set({ qty, updatedAt: input.now }).where(eq(clientBalances.id, existing.id)),
        );
      }
    } else if (qty > 0) {
      statements.push(
        db.insert(clientBalances).values({
          id: newId(),
          organizationId: input.organizationId,
          locationId,
          itemId,
          clientId,
          qty,
          updatedAt: input.now,
        }),
      );
    }
  }
  return statements;
}

/** Units all 3PL clients together own at each bay and item, keyed like inventory balances. */
export async function loadClientUnits(
  db: AppDb,
  organizationId: string,
  pairs: { locationId: string; itemId: string }[],
): Promise<Map<string, number>> {
  const units = new Map<string, number>();
  const wanted = new Set(pairs.map((pair) => balanceKey(pair.locationId, pair.itemId)));
  if (wanted.size === 0) return units;
  const rows = await db
    .select({ locationId: clientBalances.locationId, itemId: clientBalances.itemId, qty: clientBalances.qty })
    .from(clientBalances)
    .where(
      and(
        eq(clientBalances.organizationId, organizationId),
        inArray(clientBalances.locationId, [...new Set(pairs.map((pair) => pair.locationId))]),
        inArray(clientBalances.itemId, [...new Set(pairs.map((pair) => pair.itemId))]),
      ),
    );
  for (const row of rows) {
    const key = balanceKey(row.locationId, row.itemId);
    if (wanted.has(key)) units.set(key, (units.get(key) ?? 0) + Math.max(0, row.qty));
  }
  return units;
}

/** Refuses an own-stock pick that would take units a 3PL client owns. */
export async function assertOwnStockForPicks(
  db: AppDb,
  organizationId: string,
  movements: MovementDraft[],
  loaded: Map<string, { id: string; qty: number }>,
): Promise<void> {
  const ownPicks = movements.filter((movement) => movement.type === "pick" && !movement.clientId && movement.fromLocationId);
  if (ownPicks.length === 0) return;
  const clientUnits = await loadClientUnits(
    db,
    organizationId,
    ownPicks.map((movement) => ({ locationId: movement.fromLocationId!, itemId: movement.itemId })),
  );
  if (clientUnits.size === 0) return;
  const onHand = new Map([...loaded].map(([key, row]) => [key, row.qty]));
  assertOwnStockPicks(ownPicks, onHand, clientUnits);
}

export function clientKeysFromMovements(movements: MovementDraft[]): {
  locationId: string;
  itemId: string;
  clientId: string;
}[] {
  const keys: { locationId: string; itemId: string; clientId: string }[] = [];
  for (const movement of movements) {
    if (!movement.clientId) continue;
    if (isClientInboundMovement(movement.type) && movement.toLocationId) {
      keys.push({
        locationId: movement.toLocationId,
        itemId: movement.itemId,
        clientId: movement.clientId,
      });
    }
    if (isClientOutboundMovement(movement.type) && movement.fromLocationId) {
      keys.push({
        locationId: movement.fromLocationId,
        itemId: movement.itemId,
        clientId: movement.clientId,
      });
    }
  }
  return keys;
}
