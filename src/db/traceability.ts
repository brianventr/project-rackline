import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import type { MovementDraft } from "../domain/inventory";
import { InsufficientStockError } from "../domain/inventory";
import {
  allocateFifoLots,
  allocateSerials,
  assertSerialQty,
  builtLotCode,
  generatedSerial,
  normalizeLotCode,
  normalizeSerials,
} from "../domain/lots";
import { splitCatchWeight } from "../domain/catch-weight";
import {
  addUtcDays,
  assertLotNotExpired,
  assertSameLotExpiry,
  requireExpiry,
  utcYyyymmdd,
} from "../domain/expiry";
import { badRequest } from "../lib/http";
import { newId } from "../lib/ids";
import {
  HeldStockError,
  isHoldRestrictedType,
  matchingHoldForMove,
  matchingSerialHold,
  unheldLots,
  type OpenHold,
} from "../domain/holds";

type TrackedItem = {
  id: string;
  sku: string;
  trackLot: boolean;
  trackSerial: boolean;
  catchWeight: boolean;
  trackExpiry: boolean;
};

function isProduce(type: string): boolean {
  return type === "wo_produce" || type === "kit_produce";
}

function isInbound(movement: MovementDraft): boolean {
  return Boolean(movement.toLocationId) && !movement.fromLocationId;
}

function isOutbound(movement: MovementDraft): boolean {
  return Boolean(movement.fromLocationId);
}

export async function expandMovementsForTraceability(
  db: AppDb,
  organizationId: string,
  movements: MovementDraft[],
  holds: OpenHold[] = [],
): Promise<MovementDraft[]> {
  const itemIds = [...new Set(movements.map((row) => row.itemId))];
  if (itemIds.length === 0) return movements;
  const items = await db
    .select({
      id: schema.items.id,
      sku: schema.items.sku,
      trackLot: schema.items.trackLot,
      trackSerial: schema.items.trackSerial,
      catchWeight: schema.items.catchWeight,
      trackExpiry: schema.items.trackExpiry,
    })
    .from(schema.items)
    .where(and(eq(schema.items.organizationId, organizationId), inArray(schema.items.id, itemIds)));
  const byId = new Map(items.map((row) => [row.id, row]));
  const expanded: MovementDraft[] = [];
  for (const movement of movements) {
    const item = byId.get(movement.itemId);
    if (!item || movement.type === "ship") {
      expanded.push(movement);
      continue;
    }
    expanded.push(...(await expandOne(db, organizationId, item, movement, holds)));
  }
  return expanded;
}

async function expandOne(
  db: AppDb,
  organizationId: string,
  item: TrackedItem,
  movement: MovementDraft,
  holds: OpenHold[],
): Promise<MovementDraft[]> {
  let lotCode = movement.lotCode?.trim() ? normalizeLotCode(movement.lotCode) : null;
  let serials = movement.serials?.length ? normalizeSerials(movement.serials) : [];

  if (item.trackSerial && serials.length) {
    assertSerialQty(movement.qty, serials, item.sku);
  }

  if (isHoldRestrictedType(movement.type) && movement.fromLocationId) {
    const hit = matchingHoldForMove(holds, movement.fromLocationId, item.id, lotCode);
    if (hit) {
      throw new HeldStockError(hit.sku ?? item.sku, hit.locationCode, hit.number, hit.reason);
    }
  }

  if (item.catchWeight && (movement.type === "receive" || movement.type === "pick" || movement.type === "rtv")) {
    if (movement.weightGrams == null || movement.weightGrams <= 0) {
      badRequest(`${item.sku} is catch-weight; enter weight in grams`);
    }
  }

  if (item.trackExpiry && isInbound(movement)) {
    try {
      if (movement.expiresOn == null && (isProduce(movement.type) || movement.type === "adjust")) {
        movement.expiresOn = addUtcDays(utcYyyymmdd(), 365);
      } else {
        movement.expiresOn = requireExpiry(true, item.sku, movement.expiresOn ?? undefined);
      }
    } catch (err) {
      badRequest(err instanceof Error ? err.message : "Invalid expiry");
    }
  }

  if (item.trackLot && lotCode && isOutbound(movement) && movement.fromLocationId) {
    const lots = await loadLotsAt(db, organizationId, movement.fromLocationId, item.id);
    const row = lots.find((lot) => lot.lotCode === lotCode);
    try {
      assertLotNotExpired(item.sku, lotCode, row?.expiresOn ?? null);
    } catch (err) {
      badRequest(err instanceof Error ? err.message : "Lot expired");
    }
    if (row?.expiresOn != null) movement.expiresOn = row.expiresOn;
  }

  if (item.trackLot && !lotCode && isInbound(movement)) {
    if (isProduce(movement.type) || movement.type === "adjust") {
      lotCode = builtLotCode();
    } else {
      badRequest(`${item.sku} requires a lot code`);
    }
  }

  if (item.trackSerial && serials.length === 0 && isInbound(movement)) {
    if (isProduce(movement.type) || movement.type === "adjust") {
      serials = Array.from({ length: movement.qty }, () => generatedSerial(item.sku));
    } else {
      badRequest(`${item.sku} requires ${movement.qty} serial number${movement.qty === 1 ? "" : "s"}`);
    }
  }

  if (item.trackLot && !lotCode && isOutbound(movement) && movement.fromLocationId) {
    const lots = await loadLotsAt(db, organizationId, movement.fromLocationId, item.id);
    const available = unheldLots(lots, holds, movement.fromLocationId, item.id);
    const availableQty = available.reduce((sum, row) => sum + Math.max(0, row.qty), 0);
    const onHand = lots.reduce((sum, row) => sum + Math.max(0, row.qty), 0);
    if (availableQty < movement.qty && onHand >= movement.qty) {
      const hit = holds.find(
        (hold) => hold.locationId === movement.fromLocationId && (!hold.itemId || hold.itemId === item.id),
      );
      throw new HeldStockError(item.sku, hit?.locationCode ?? movement.fromLocationId, hit?.number ?? "hold", hit?.reason ?? "QC");
    }
    const allocated = allocateFifoLots(available, movement.qty, item.sku);
    const grams = splitCatchWeight(
      movement.weightGrams ?? null,
      allocated.map((row) => row.qty),
    );
    const split: MovementDraft[] = [];
    for (let index = 0; index < allocated.length; index += 1) {
      const row = allocated[index]!;
      const piece: MovementDraft = {
        ...movement,
        qty: row.qty,
        lotCode: row.lotCode,
        serials: null,
        weightGrams: grams[index],
        expiresOn: row.expiresOn ?? movement.expiresOn ?? null,
      };
      const withSerials = await attachOutboundSerials(db, organizationId, item, piece, [], holds);
      split.push(...withSerials);
    }
    return split;
  }

  if (isOutbound(movement)) {
    return attachOutboundSerials(db, organizationId, item, { ...movement, lotCode, serials }, serials, holds);
  }

  return [{ ...movement, lotCode, serials: serials.length ? serials : null }];
}

async function attachOutboundSerials(
  db: AppDb,
  organizationId: string,
  item: TrackedItem,
  movement: MovementDraft,
  provided: string[],
  holds: OpenHold[],
): Promise<MovementDraft[]> {
  if (!item.trackSerial) {
    return [movement];
  }
  let serials = provided.length ? provided : movement.serials?.length ? normalizeSerials(movement.serials) : [];
  const blocked = (serial: string) => matchingSerialHold(holds, item.id, serial, movement.fromLocationId);
  const named = serials.map((serial) => blocked(serial)).find((hit) => hit);
  if (named) {
    throw new HeldStockError(item.sku, named.locationCode, named.number, named.reason);
  }
  if (serials.length === 0 && movement.fromLocationId) {
    const onHand = await loadSerialsAt(db, organizationId, movement.fromLocationId, item.id);
    const free = onHand.filter((serial) => !blocked(serial));
    if (free.length < movement.qty && onHand.length >= movement.qty) {
      const hit = holds.find((hold) => hold.serialCode && hold.itemId === item.id && hold.locationId === movement.fromLocationId);
      throw new HeldStockError(item.sku, hit?.locationCode ?? movement.fromLocationId, hit?.number ?? "hold", hit?.reason ?? "Recall");
    }
    serials = allocateSerials(free, movement.qty, item.sku);
  } else if (serials.length) {
    assertSerialQty(movement.qty, serials, item.sku);
  }
  return [{ ...movement, serials: serials.length ? serials : null }];
}

async function loadLotsAt(db: AppDb, organizationId: string, locationId: string, itemId: string) {
  const rows = await db
    .select({
      lotCode: schema.lotBalances.lotCode,
      qty: schema.lotBalances.qty,
      expiresOn: schema.lotBalances.expiresOn,
    })
    .from(schema.lotBalances)
    .where(
      and(
        eq(schema.lotBalances.organizationId, organizationId),
        eq(schema.lotBalances.locationId, locationId),
        eq(schema.lotBalances.itemId, itemId),
      ),
    );
  return rows.filter((row) => row.qty > 0);
}

async function loadSerialsAt(db: AppDb, organizationId: string, locationId: string, itemId: string) {
  const rows = await db
    .select({ serialCode: schema.serials.serialCode })
    .from(schema.serials)
    .where(
      and(
        eq(schema.serials.organizationId, organizationId),
        eq(schema.serials.locationId, locationId),
        eq(schema.serials.itemId, itemId),
        eq(schema.serials.status, "on_hand"),
      ),
    );
  return rows.map((row) => row.serialCode);
}

export async function appendTraceabilityStatements(
  db: AppDb,
  input: {
    organizationId: string;
    now: number;
    movements: MovementDraft[];
    statements: BatchItem<"sqlite">[];
  },
): Promise<void> {
  const lotKeys = new Map<string, { locationId: string; itemId: string; lotCode: string }>();
  const serialKeys: { itemId: string; serialCode: string }[] = [];
  for (const movement of input.movements) {
    if (movement.type === "ship") continue;
    const lotCode = movement.lotCode?.trim() ? normalizeLotCode(movement.lotCode) : null;
    if (lotCode) {
      if (movement.fromLocationId) {
        lotKeys.set(`${movement.fromLocationId}:${movement.itemId}:${lotCode}`, {
          locationId: movement.fromLocationId,
          itemId: movement.itemId,
          lotCode,
        });
      }
      if (movement.toLocationId) {
        lotKeys.set(`${movement.toLocationId}:${movement.itemId}:${lotCode}`, {
          locationId: movement.toLocationId,
          itemId: movement.itemId,
          lotCode,
        });
      }
    }
    for (const serial of movement.serials ?? []) {
      serialKeys.push({ itemId: movement.itemId, serialCode: serial });
    }
  }

  const existingLots = new Map<string, { id: string; qty: number; expiresOn: number | null }>();
  const lotExpiry = new Map<string, number | null>();
  const lotList = [...lotKeys.values()];
  if (lotList.length > 0) {
    const rows = await db
      .select()
      .from(schema.lotBalances)
      .where(
        and(
          eq(schema.lotBalances.organizationId, input.organizationId),
          inArray(
            schema.lotBalances.itemId,
            [...new Set(lotList.map((row) => row.itemId))],
          ),
        ),
      );
    for (const row of rows) {
      existingLots.set(`${row.locationId}:${row.itemId}:${row.lotCode}`, {
        id: row.id,
        qty: row.qty,
        expiresOn: row.expiresOn ?? null,
      });
      const identity = `${row.itemId}:${row.lotCode}`;
      if (!lotExpiry.has(identity) || lotExpiry.get(identity) == null) {
        lotExpiry.set(identity, row.expiresOn ?? null);
      }
    }
  }

  const existingSerials = new Map<string, { id: string; locationId: string | null; status: string }>();
  if (serialKeys.length > 0) {
    const rows = await db
      .select()
      .from(schema.serials)
      .where(
        and(
          eq(schema.serials.organizationId, input.organizationId),
          inArray(
            schema.serials.itemId,
            [...new Set(serialKeys.map((row) => row.itemId))],
          ),
        ),
      );
    for (const row of rows) {
      existingSerials.set(`${row.itemId}:${row.serialCode}`, {
        id: row.id,
        locationId: row.locationId,
        status: row.status,
      });
    }
  }

  const lotQty = new Map<string, number>();
  for (const [key, row] of existingLots) {
    lotQty.set(key, row.qty);
  }

  for (const movement of input.movements) {
    if (movement.type === "ship") continue;
    const lotCode = movement.lotCode?.trim() ? normalizeLotCode(movement.lotCode) : null;
    if (lotCode) {
      const identity = `${movement.itemId}:${lotCode}`;
      const known = lotExpiry.get(identity) ?? null;
      if (isInbound(movement) && movement.expiresOn != null) {
        try {
          assertSameLotExpiry(movement.itemId, lotCode, known, movement.expiresOn);
        } catch (err) {
          badRequest(err instanceof Error ? err.message : "Lot expiry mismatch");
        }
        lotExpiry.set(identity, movement.expiresOn);
      } else if (movement.expiresOn == null && known != null) {
        movement.expiresOn = known;
      }
      if (movement.fromLocationId) {
        applyLotDelta(lotQty, movement.fromLocationId, movement.itemId, lotCode, -movement.qty);
      }
      if (movement.toLocationId) {
        applyLotDelta(lotQty, movement.toLocationId, movement.itemId, lotCode, movement.qty);
      }
    }

    const serials = movement.serials ?? [];
    for (const serialCode of serials) {
      const key = `${movement.itemId}:${serialCode}`;
      const existing = existingSerials.get(key);
      if (isInbound(movement) || (movement.type === "adjust" && movement.toLocationId && !movement.fromLocationId)) {
        if (existing && existing.status === "on_hand") {
          badRequest(`Serial ${serialCode} is already on hand`);
        }
        if (existing) {
          input.statements.push(
            db
              .update(schema.serials)
              .set({
                locationId: movement.toLocationId ?? null,
                status: "on_hand",
                updatedAt: input.now,
              })
              .where(eq(schema.serials.id, existing.id)),
          );
          existingSerials.set(key, {
            id: existing.id,
            locationId: movement.toLocationId ?? null,
            status: "on_hand",
          });
        } else {
          const id = newId();
          input.statements.push(
            db.insert(schema.serials).values({
              id,
              organizationId: input.organizationId,
              itemId: movement.itemId,
              serialCode,
              locationId: movement.toLocationId ?? null,
              status: "on_hand",
              updatedAt: input.now,
            }),
          );
          existingSerials.set(key, { id, locationId: movement.toLocationId ?? null, status: "on_hand" });
        }
        continue;
      }

      if (movement.fromLocationId && movement.toLocationId) {
        if (!existing || existing.status !== "on_hand") {
          badRequest(`Serial ${serialCode} is not on hand`);
        }
        input.statements.push(
          db
            .update(schema.serials)
            .set({ locationId: movement.toLocationId, status: "on_hand", updatedAt: input.now })
            .where(eq(schema.serials.id, existing.id)),
        );
        existingSerials.set(key, { id: existing.id, locationId: movement.toLocationId, status: "on_hand" });
        continue;
      }

      if (movement.fromLocationId) {
        if (!existing || existing.status !== "on_hand") {
          badRequest(`Serial ${serialCode} is not on hand`);
        }
        const status = movement.type === "pick" || movement.type === "rtv" ? "shipped" : "consumed";
        input.statements.push(
          db
            .update(schema.serials)
            .set({ locationId: null, status, updatedAt: input.now })
            .where(eq(schema.serials.id, existing.id)),
        );
        existingSerials.set(key, { id: existing.id, locationId: null, status });
      }
    }
  }

  for (const [key, qty] of lotQty) {
    const [locationId, itemId, lotCode] = splitLotKey(key);
    const existing = existingLots.get(key);
    const expiresOn = lotExpiry.get(`${itemId}:${lotCode}`) ?? existing?.expiresOn ?? null;
    if (existing) {
      input.statements.push(
        db
          .update(schema.lotBalances)
          .set({ qty, updatedAt: input.now, expiresOn })
          .where(eq(schema.lotBalances.id, existing.id)),
      );
    } else {
      input.statements.push(
        db.insert(schema.lotBalances).values({
          id: newId(),
          organizationId: input.organizationId,
          locationId,
          itemId,
          lotCode,
          qty,
          expiresOn,
          updatedAt: input.now,
        }),
      );
    }
  }
}

function applyLotDelta(
  qty: Map<string, number>,
  locationId: string,
  itemId: string,
  lotCode: string,
  delta: number,
): void {
  const key = `${locationId}:${itemId}:${lotCode}`;
  const current = qty.get(key) ?? 0;
  const next = current + delta;
  if (next < 0) {
    throw new InsufficientStockError(lotCode, current, Math.abs(delta));
  }
  qty.set(key, next);
}

function splitLotKey(key: string): [string, string, string] {
  const first = key.indexOf(":");
  const second = key.indexOf(":", first + 1);
  return [key.slice(0, first), key.slice(first + 1, second), key.slice(second + 1)];
}
