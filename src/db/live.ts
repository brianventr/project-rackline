import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { getOrgWarehouse } from "../lib/org";
import { backfillOpenJobs } from "./jobs";
import { isGarageMode } from "../domain/operating-mode";
import {
  buildLiveDay,
  movementTouch,
  type LiveCheckout,
  type LiveClock,
  type LiveDay,
  type LiveJob,
  type LiveOrder,
  type LiveTouch,
  type LiveTracker,
  type LiveYard,
} from "../domain/live";
import { isValidTimeZone, startOfZonedDay } from "../domain/time-zone";

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function lineRemaining(
  db: AppDb,
  header: typeof schema.receipts | typeof schema.purchases | typeof schema.asns | typeof schema.rmas | typeof schema.vendorReturns,
  line: typeof schema.receiptLines | typeof schema.purchaseLines | typeof schema.asnLines | typeof schema.rmaLines | typeof schema.vendorReturnLines,
  headerId: typeof schema.receiptLines.receiptId | typeof schema.purchaseLines.purchaseId | typeof schema.asnLines.asnId | typeof schema.rmaLines.rmaId | typeof schema.vendorReturnLines.vendorReturnId,
  expected: typeof schema.receiptLines.qty | typeof schema.purchaseLines.qtyOrdered | typeof schema.asnLines.qtyExpected | typeof schema.rmaLines.qtyExpected | typeof schema.vendorReturnLines.qtyExpected,
  done: typeof schema.receiptLines.qtyReceived | typeof schema.purchaseLines.qtyReceived | typeof schema.asnLines.qtyReceived | typeof schema.rmaLines.qtyReceived | typeof schema.vendorReturnLines.qtyReturned,
  organizationId: string,
  warehouseId: string,
  statuses: string[],
): Promise<number> {
  const [row] = await db
    .select({
      remaining: sql<number>`coalesce(sum(case when ${expected} > ${done} then ${expected} - ${done} else 0 end), 0)`,
    })
    .from(line)
    .innerJoin(header, eq(header.id, headerId))
    .where(
      and(eq(header.organizationId, organizationId), eq(header.warehouseId, warehouseId), inArray(header.status, statuses)),
    );
  return num(row?.remaining);
}

export async function loadLiveDay(db: AppDb, organizationId: string, warehouseId: string, asOf: number): Promise<LiveDay> {
  const warehouse = await getOrgWarehouse(db, organizationId, warehouseId);
  await backfillOpenJobs(db, organizationId, warehouseId);
  const [org] = await db
    .select({ operatingMode: schema.organizations.operatingMode })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1);
  const timeZone = isValidTimeZone(warehouse.timeZone) ? warehouse.timeZone : "UTC";
  const dayStart = startOfZonedDay(asOf, timeZone);

  const fromLoc = alias(schema.locations, "live_from_loc");
  const toLoc = alias(schema.locations, "live_to_loc");
  const dockLoc = alias(schema.locations, "live_dock_loc");

  const [
    members,
    locations,
    movementRows,
    packRows,
    laborRows,
    jobRows,
    clockRows,
    checkoutRows,
    orderRows,
    workOrders,
    kits,
    receiptRemaining,
    purchaseRemaining,
    asnRemaining,
    rmaRemaining,
    rtvRemaining,
    transferRemaining,
    replenishRemaining,
    countRows,
    yardRows,
    trackerOrders,
    trackerPackages,
  ] = await Promise.all([
    db
      .select({ userId: schema.user.id, name: schema.user.name })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(eq(schema.memberships.organizationId, organizationId)),
    db
      .select({
        id: schema.locations.id,
        code: schema.locations.code,
        posX: schema.locations.posX,
        posY: schema.locations.posY,
      })
      .from(schema.locations)
      .where(and(eq(schema.locations.organizationId, organizationId), eq(schema.locations.warehouseId, warehouseId))),
    db
      .select({
        id: schema.inventoryMovements.id,
        type: schema.inventoryMovements.type,
        qty: schema.inventoryMovements.qty,
        createdAt: schema.inventoryMovements.createdAt,
        createdBy: schema.inventoryMovements.createdBy,
        fromLocationId: schema.inventoryMovements.fromLocationId,
        toLocationId: schema.inventoryMovements.toLocationId,
        refType: schema.inventoryMovements.refType,
        sku: schema.items.sku,
      })
      .from(schema.inventoryMovements)
      .leftJoin(schema.items, eq(schema.items.id, schema.inventoryMovements.itemId))
      .leftJoin(fromLoc, eq(fromLoc.id, schema.inventoryMovements.fromLocationId))
      .leftJoin(toLoc, eq(toLoc.id, schema.inventoryMovements.toLocationId))
      .where(
        and(
          eq(schema.inventoryMovements.organizationId, organizationId),
          gte(schema.inventoryMovements.createdAt, dayStart),
          lte(schema.inventoryMovements.createdAt, asOf),
          or(eq(fromLoc.warehouseId, warehouseId), eq(toLoc.warehouseId, warehouseId)),
        ),
      ),
    db
      .select({
        id: schema.packEvents.id,
        userId: schema.packEvents.userId,
        qty: schema.packEvents.qty,
        createdAt: schema.packEvents.createdAt,
        sku: schema.items.sku,
      })
      .from(schema.packEvents)
      .leftJoin(schema.items, eq(schema.items.id, schema.packEvents.itemId))
      .where(
        and(
          eq(schema.packEvents.organizationId, organizationId),
          eq(schema.packEvents.warehouseId, warehouseId),
          gte(schema.packEvents.createdAt, dayStart),
          lte(schema.packEvents.createdAt, asOf),
        ),
      ),
    db
      .select({
        id: schema.laborEvents.id,
        userId: schema.laborEvents.userId,
        verb: schema.laborEvents.verb,
        refType: schema.laborEvents.refType,
        createdAt: schema.laborEvents.createdAt,
      })
      .from(schema.laborEvents)
      .where(
        and(
          eq(schema.laborEvents.organizationId, organizationId),
          eq(schema.laborEvents.warehouseId, warehouseId),
          gte(schema.laborEvents.createdAt, dayStart),
          lte(schema.laborEvents.createdAt, asOf),
        ),
      ),
    db
      .select()
      .from(schema.floorJobs)
      .where(
        and(
          eq(schema.floorJobs.organizationId, organizationId),
          eq(schema.floorJobs.warehouseId, warehouseId),
          inArray(schema.floorJobs.status, ["open", "claimed"]),
        ),
      ),
    db
      .select()
      .from(schema.laborClocks)
      .where(
        and(
          eq(schema.laborClocks.organizationId, organizationId),
          eq(schema.laborClocks.warehouseId, warehouseId),
          isNull(schema.laborClocks.endedAt),
        ),
      ),
    db
      .select({
        operatorUserId: schema.equipmentAssignments.operatorUserId,
        equipmentCode: schema.equipment.code,
      })
      .from(schema.equipmentAssignments)
      .innerJoin(schema.equipment, eq(schema.equipment.id, schema.equipmentAssignments.equipmentId))
      .where(
        and(
          eq(schema.equipmentAssignments.organizationId, organizationId),
          eq(schema.equipmentAssignments.warehouseId, warehouseId),
          eq(schema.equipmentAssignments.status, "open"),
        ),
      ),
    db
      .select({ id: schema.orders.id, status: schema.orders.status })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          eq(schema.orders.warehouseId, warehouseId),
          sql`${schema.orders.status} not in ('shipped', 'cancelled')`,
        ),
      ),
    db
      .select({ qty: schema.workOrders.qty, qtyCompleted: schema.workOrders.qtyCompleted })
      .from(schema.workOrders)
      .where(
        and(
          eq(schema.workOrders.organizationId, organizationId),
          eq(schema.workOrders.warehouseId, warehouseId),
          inArray(schema.workOrders.status, ["draft", "in_progress"]),
        ),
      ),
    db
      .select({ qty: schema.kitBuilds.qty, qtyCompleted: schema.kitBuilds.qtyCompleted })
      .from(schema.kitBuilds)
      .where(
        and(
          eq(schema.kitBuilds.organizationId, organizationId),
          eq(schema.kitBuilds.warehouseId, warehouseId),
          inArray(schema.kitBuilds.status, ["draft", "in_progress"]),
        ),
      ),
    lineRemaining(
      db,
      schema.receipts,
      schema.receiptLines,
      schema.receiptLines.receiptId,
      schema.receiptLines.qty,
      schema.receiptLines.qtyReceived,
      organizationId,
      warehouseId,
      ["draft", "receiving"],
    ),
    lineRemaining(
      db,
      schema.purchases,
      schema.purchaseLines,
      schema.purchaseLines.purchaseId,
      schema.purchaseLines.qtyOrdered,
      schema.purchaseLines.qtyReceived,
      organizationId,
      warehouseId,
      ["draft", "ordered", "receiving"],
    ),
    lineRemaining(
      db,
      schema.asns,
      schema.asnLines,
      schema.asnLines.asnId,
      schema.asnLines.qtyExpected,
      schema.asnLines.qtyReceived,
      organizationId,
      warehouseId,
      ["draft", "expected", "receiving"],
    ),
    lineRemaining(
      db,
      schema.rmas,
      schema.rmaLines,
      schema.rmaLines.rmaId,
      schema.rmaLines.qtyExpected,
      schema.rmaLines.qtyReceived,
      organizationId,
      warehouseId,
      ["open", "receiving"],
    ),
    lineRemaining(
      db,
      schema.vendorReturns,
      schema.vendorReturnLines,
      schema.vendorReturnLines.vendorReturnId,
      schema.vendorReturnLines.qtyExpected,
      schema.vendorReturnLines.qtyReturned,
      organizationId,
      warehouseId,
      ["open", "returning"],
    ),
    (async () => {
      const [row] = await db
        .select({
          remaining: sql<number>`coalesce(sum(case when ${schema.transferLines.qty} > ${schema.transferLines.qtyMoved} then ${schema.transferLines.qty} - ${schema.transferLines.qtyMoved} else 0 end), 0)`,
        })
        .from(schema.transferLines)
        .innerJoin(schema.transfers, eq(schema.transfers.id, schema.transferLines.transferId))
        .where(
          and(
            eq(schema.transfers.organizationId, organizationId),
            eq(schema.transfers.warehouseId, warehouseId),
            inArray(schema.transfers.status, ["draft", "in_progress"]),
          ),
        );
      return num(row?.remaining);
    })(),
    (async () => {
      const [row] = await db
        .select({
          remaining: sql<number>`coalesce(sum(case when ${schema.replenishments.qty} > ${schema.replenishments.qtyMoved} then ${schema.replenishments.qty} - ${schema.replenishments.qtyMoved} else 0 end), 0)`,
        })
        .from(schema.replenishments)
        .where(
          and(
            eq(schema.replenishments.organizationId, organizationId),
            eq(schema.replenishments.warehouseId, warehouseId),
            inArray(schema.replenishments.status, ["draft", "in_progress"]),
          ),
        );
      return num(row?.remaining);
    })(),
    db
      .select({ id: schema.cycleCounts.id })
      .from(schema.cycleCounts)
      .where(
        and(
          eq(schema.cycleCounts.organizationId, organizationId),
          eq(schema.cycleCounts.warehouseId, warehouseId),
          inArray(schema.cycleCounts.status, ["draft", "counting"]),
        ),
      ),
    db
      .select({
        id: schema.yardVisits.id,
        number: schema.yardVisits.number,
        status: schema.yardVisits.status,
        carrierName: schema.yardVisits.carrierName,
        trailerNumber: schema.yardVisits.trailerNumber,
        eta: schema.yardVisits.eta,
        dockCode: dockLoc.code,
        checkedOutAt: schema.yardVisits.checkedOutAt,
      })
      .from(schema.yardVisits)
      .leftJoin(dockLoc, eq(dockLoc.id, schema.yardVisits.dockLocationId))
      .where(
        and(
          eq(schema.yardVisits.organizationId, organizationId),
          eq(schema.yardVisits.warehouseId, warehouseId),
          or(
            inArray(schema.yardVisits.status, ["expected", "checked_in", "at_dock"]),
            and(eq(schema.yardVisits.status, "checked_out"), gte(schema.yardVisits.checkedOutAt, dayStart)),
          ),
        ),
      ),
    db
      .select({ id: schema.orders.id, number: schema.orders.number })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          eq(schema.orders.warehouseId, warehouseId),
          eq(schema.orders.trackerStatus, "exception"),
          sql`${schema.orders.status} != 'cancelled'`,
        ),
      ),
    db
      .select({
        orderId: schema.orders.id,
        number: schema.orders.number,
        packageId: schema.orderPackages.id,
        packageNumber: schema.orderPackages.number,
      })
      .from(schema.orderPackages)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderPackages.orderId))
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          eq(schema.orders.warehouseId, warehouseId),
          eq(schema.orderPackages.trackerStatus, "exception"),
          sql`${schema.orders.status} != 'cancelled'`,
        ),
      ),
  ]);

  const orderIds = orderRows.map((row) => row.id);
  const orderLineRows = orderIds.length
    ? await db
        .select({
          orderId: schema.orderLines.orderId,
          qty: schema.orderLines.qty,
          qtyPicked: schema.orderLines.qtyPicked,
          qtyPacked: schema.orderLines.qtyPacked,
        })
        .from(schema.orderLines)
        .where(inArray(schema.orderLines.orderId, orderIds))
    : [];
  const linesByOrder = new Map<string, LiveOrder["lines"]>();
  for (const line of orderLineRows) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push({ qty: line.qty, qtyPicked: line.qtyPicked, qtyPacked: line.qtyPacked });
    linesByOrder.set(line.orderId, list);
  }
  const orders: LiveOrder[] = orderRows.map((row) => ({ status: row.status, lines: linesByOrder.get(row.id) ?? [] }));

  const countIds = countRows.map((row) => row.id);
  const countLines = countIds.length
    ? await db
        .select({ cycleCountId: schema.cycleCountLines.cycleCountId, entered: schema.cycleCountLines.entered })
        .from(schema.cycleCountLines)
        .where(inArray(schema.cycleCountLines.cycleCountId, countIds))
    : [];
  const countRemainingById = new Map<string, { lines: number; open: number }>();
  for (const id of countIds) countRemainingById.set(id, { lines: 0, open: 0 });
  for (const line of countLines) {
    const bucket = countRemainingById.get(line.cycleCountId) ?? { lines: 0, open: 0 };
    bucket.lines += 1;
    if (!line.entered) bucket.open += 1;
    countRemainingById.set(line.cycleCountId, bucket);
  }
  const counts = [...countRemainingById.values()].reduce((sum, bucket) => sum + (bucket.lines === 0 ? 1 : bucket.open), 0);

  const touches: LiveTouch[] = [];
  for (const row of movementRows) {
    const mapped = movementTouch(row);
    if (!mapped) continue;
    touches.push({
      id: row.id,
      at: row.createdAt,
      userId: row.createdBy,
      qty: mapped.sign * Math.abs(row.qty),
      flow: mapped.flow,
      bayId: mapped.bayId,
      sku: row.sku,
      verb: mapped.verb,
      refType: row.refType,
    });
  }
  for (const row of packRows) {
    touches.push({
      id: `pack:${row.id}`,
      at: row.createdAt,
      userId: row.userId,
      qty: row.qty,
      flow: "outbound",
      bayId: null,
      sku: row.sku,
      verb: "pack",
      refType: "order",
    });
  }
  for (const row of laborRows) {
    touches.push({
      id: `labor:${row.id}`,
      at: row.createdAt,
      userId: row.userId,
      qty: 0,
      flow: null,
      bayId: null,
      sku: null,
      verb: row.verb,
      refType: row.refType,
    });
  }

  const jobs: LiveJob[] = jobRows.map((job) => ({
    id: job.id,
    verb: job.verb,
    refType: job.refType,
    refId: job.refId,
    status: job.status,
    number: job.number,
    title: job.title,
    assigneeId: job.assigneeId,
    claimedAt: job.claimedAt,
    dueAt: job.dueAt,
    fromLocationId: job.fromLocationId,
  }));
  const clocks: LiveClock[] = clockRows.map((clock) => ({
    userId: clock.userId,
    verb: clock.verb,
    refType: clock.refType,
    refId: clock.refId,
    startedAt: clock.startedAt,
    number: null,
  }));
  const checkouts: LiveCheckout[] = checkoutRows;
  const yards: LiveYard[] = yardRows.map((yard) => ({
    id: yard.id,
    number: yard.number,
    status: yard.status,
    carrierName: yard.carrierName,
    trailerNumber: yard.trailerNumber,
    eta: yard.eta,
    dockCode: yard.dockCode,
    checkedOutAt: yard.checkedOutAt,
  }));
  const packageOrders = new Set(trackerPackages.map((row) => row.orderId));
  const trackers: LiveTracker[] = [
    ...trackerPackages.map((row) => ({
      orderId: row.orderId,
      number: row.number,
      packageId: row.packageId,
      packageNumber: row.packageNumber,
    })),
    ...trackerOrders
      .filter((row) => !packageOrders.has(row.id))
      .map((row) => ({ orderId: row.id, number: row.number, packageId: null, packageNumber: null })),
  ];

  return buildLiveDay({
    asOf,
    timeZone,
    garage: isGarageMode(org?.operatingMode),
    warehouse: { id: warehouse.id, name: warehouse.name },
    members,
    locations,
    touches,
    jobs,
    clocks,
    checkouts,
    orders,
    workOrders,
    kits,
    remaining: {
      receipts: receiptRemaining,
      purchases: purchaseRemaining,
      asns: asnRemaining,
      rmas: rmaRemaining,
      rtvs: rtvRemaining,
      transfers: transferRemaining,
      replenishments: replenishRemaining,
      counts,
    },
    yards,
    trackers,
  });
}
