import { and, eq, gte, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { docNumber, newId } from "../lib/ids";
import { syncDocumentJob } from "./jobs";
import { atpOnHand } from "./allocations";
import { ABC_WINDOW_DAYS, DAY_MS } from "../domain/abc";
import { proposeSlotting } from "../domain/slotting";

export type SlottingTransferLink = { id: string; number: string };

export type SlottingProposal = {
  itemId: string;
  sku: string;
  itemName: string;
  units: number;
  fromLocationId: string;
  fromCode: string;
  toLocationId: string;
  toCode: string;
  qty: number;
  transfer: SlottingTransferLink | null;
};

export type SlottingResult = {
  created: number;
  proposals: SlottingProposal[];
};

const OPEN_TRANSFER = ["draft", "in_progress"] as const;

function transferKey(itemId: string, toLocationId: string): string {
  return `${itemId}:${toLocationId}`;
}

async function movementUnits(
  db: AppDb,
  organizationId: string,
  warehouseId: string,
  now: number,
): Promise<Map<string, number>> {
  const since = now - ABC_WINDOW_DAYS * DAY_MS;
  const fromLoc = alias(schema.locations, "slot_from_loc");
  const toLoc = alias(schema.locations, "slot_to_loc");
  const moves = await db
    .select({
      itemId: schema.inventoryMovements.itemId,
      qty: schema.inventoryMovements.qty,
      fromWarehouseId: fromLoc.warehouseId,
      toWarehouseId: toLoc.warehouseId,
    })
    .from(schema.inventoryMovements)
    .leftJoin(fromLoc, eq(fromLoc.id, schema.inventoryMovements.fromLocationId))
    .leftJoin(toLoc, eq(toLoc.id, schema.inventoryMovements.toLocationId))
    .where(
      and(
        eq(schema.inventoryMovements.organizationId, organizationId),
        gte(schema.inventoryMovements.createdAt, since),
        inArray(schema.inventoryMovements.type, ["pick", "ship"]),
      ),
    );
  const units = new Map<string, number>();
  for (const row of moves) {
    if (row.fromWarehouseId !== warehouseId && row.toWarehouseId !== warehouseId) continue;
    units.set(row.itemId, (units.get(row.itemId) ?? 0) + Math.max(0, row.qty));
  }
  return units;
}

async function openTransfersByItemDest(
  db: AppDb,
  organizationId: string,
  warehouseId: string,
): Promise<Map<string, SlottingTransferLink>> {
  const rows = await db
    .select({
      id: schema.transfers.id,
      number: schema.transfers.number,
      itemId: schema.transferLines.itemId,
      toLocationId: schema.transfers.toLocationId,
    })
    .from(schema.transferLines)
    .innerJoin(schema.transfers, eq(schema.transfers.id, schema.transferLines.transferId))
    .where(
      and(
        eq(schema.transfers.organizationId, organizationId),
        eq(schema.transfers.warehouseId, warehouseId),
        inArray(schema.transfers.status, [...OPEN_TRANSFER]),
      ),
    );
  const out = new Map<string, SlottingTransferLink>();
  for (const row of rows) {
    const key = transferKey(row.itemId, row.toLocationId);
    if (!out.has(key)) out.set(key, { id: row.id, number: row.number });
  }
  return out;
}

/** Proposals from current stock. Does not write. Attaches an open transfer when one already exists. */
export async function previewSlotting(
  db: AppDb,
  input: { organizationId: string; warehouseId: string; now?: number },
): Promise<SlottingResult> {
  const now = input.now ?? Date.now();
  const [locations, balances, items, units, open] = await Promise.all([
    db
      .select({
        locationId: schema.locations.id,
        code: schema.locations.code,
        slotRole: schema.locations.slotRole,
        maxQty: schema.locations.maxQty,
      })
      .from(schema.locations)
      .where(
        and(eq(schema.locations.organizationId, input.organizationId), eq(schema.locations.warehouseId, input.warehouseId)),
      ),
    db
      .select({
        locationId: schema.inventoryBalances.locationId,
        itemId: schema.inventoryBalances.itemId,
        qty: schema.inventoryBalances.qty,
      })
      .from(schema.inventoryBalances)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
      .where(
        and(
          eq(schema.inventoryBalances.organizationId, input.organizationId),
          eq(schema.locations.warehouseId, input.warehouseId),
        ),
      ),
    db
      .select({ id: schema.items.id, sku: schema.items.sku, name: schema.items.name })
      .from(schema.items)
      .where(eq(schema.items.organizationId, input.organizationId)),
    movementUnits(db, input.organizationId, input.warehouseId, now),
    openTransfersByItemDest(db, input.organizationId, input.warehouseId),
  ]);

  const available = await atpOnHand(db, input.organizationId, balances, { warehouseId: input.warehouseId });
  const names = new Map(items.map((item) => [item.id, item]));
  const codes = new Map(locations.map((row) => [row.locationId, row.code]));
  const moves = proposeSlotting({
    skus: items.map((item) => ({ itemId: item.id, units: units.get(item.id) ?? 0 })),
    bays: locations.map((row) => ({ locationId: row.locationId, slotRole: row.slotRole, maxQty: row.maxQty })),
    stock: available,
  });

  return {
    created: 0,
    proposals: moves.map((move) => {
      const item = names.get(move.itemId);
      return {
        itemId: move.itemId,
        sku: item?.sku ?? move.itemId,
        itemName: item?.name ?? "",
        units: move.units,
        fromLocationId: move.fromLocationId,
        fromCode: codes.get(move.fromLocationId) ?? move.fromLocationId,
        toLocationId: move.toLocationId,
        toCode: codes.get(move.toLocationId) ?? move.toLocationId,
        qty: move.qty,
        transfer: open.get(transferKey(move.itemId, move.toLocationId)) ?? null,
      };
    }),
  };
}

/** Opens one draft transfer per proposal that does not already have an open transfer to that destination. */
export async function planSlotting(
  db: AppDb,
  input: { organizationId: string; warehouseId: string; now?: number },
): Promise<SlottingResult> {
  const preview = await previewSlotting(db, input);
  const now = input.now ?? Date.now();
  let created = 0;
  for (const proposal of preview.proposals) {
    if (proposal.transfer) continue;
    const id = newId();
    const number = docNumber("XFR");
    await db.batch([
      db.insert(schema.transfers).values({
        id,
        organizationId: input.organizationId,
        warehouseId: input.warehouseId,
        number,
        status: "draft",
        fromLocationId: proposal.fromLocationId,
        toLocationId: proposal.toLocationId,
        notes: "Slotting",
        createdAt: now,
      }),
      db.insert(schema.transferLines).values({
        id: newId(),
        transferId: id,
        itemId: proposal.itemId,
        qty: proposal.qty,
        qtyMoved: 0,
      }),
    ]);
    await syncDocumentJob(db, {
      organizationId: input.organizationId,
      warehouseId: input.warehouseId,
      refType: "transfer",
      refId: id,
      status: "draft",
      number,
      title: "Slotting",
      fromLocationId: proposal.fromLocationId,
      toLocationId: proposal.toLocationId,
      itemId: proposal.itemId,
      qty: proposal.qty,
      createdAt: now,
    });
    proposal.transfer = { id, number };
    created += 1;
  }
  return { created, proposals: preview.proposals };
}
