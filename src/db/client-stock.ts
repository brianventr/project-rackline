import { and, eq, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { clientBalances } from "./schema";
import type { AppDb } from "./stock";
import {
  applyClientOutbound,
  applyClientReceive,
  clientBalanceKey,
  isClientInboundMovement,
  isClientOutboundMovement,
} from "../domain/client-stock";
import type { MovementDraft } from "../domain/inventory";
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
