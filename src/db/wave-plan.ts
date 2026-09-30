import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import * as schema from "./schema";
import type { AppDb } from "./stock";
import { getOrgWarehouse } from "../lib/org";
import { loadPromiseFacts } from "./promise";
import { planPromises, cutoffLabel } from "../domain/promise";
import { isValidTimeZone } from "../domain/time-zone";
import { enabledServicesFromConnections, resolveService } from "../domain/carriers";
import {
  ANY_CARRIER,
  cutoffFor,
  parseCarrierCutoffs,
  planWaves,
  type WaveGroup,
  type WavePlanOrder,
  type WaveWaiting,
} from "../domain/wave-plan";

export type WavePlanView = {
  asOf: number;
  timeZone: string;
  cutoffs: { carrier: string; minutes: number; label: string; set: boolean }[];
  groups: (WaveGroup & { zoneName: string | null; clientName: string | null })[];
  waiting: WaveWaiting[];
  unwaved: number;
};

export async function loadWavePlan(db: AppDb, organizationId: string, warehouseId: string): Promise<WavePlanView> {
  const warehouse = await getOrgWarehouse(db, organizationId, warehouseId);
  const timeZone = isValidTimeZone(warehouse.timeZone) ? warehouse.timeZone : "UTC";
  const cutoffs = parseCarrierCutoffs(warehouse.carrierCutoffsJson);
  const facts = await loadPromiseFacts(db, organizationId, warehouseId, { cutoffMinutes: cutoffFor(cutoffs, null) });
  const promiseById = new Map(planPromises(facts.input).board.orders.map((row) => [row.orderId, row]));
  const now = facts.input.now;

  const [orders, lines, faces, zones, clients, connections] = await Promise.all([
    db
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        clientId: schema.orders.clientId,
        carrierService: schema.orders.carrierService,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          eq(schema.orders.warehouseId, warehouseId),
          inArray(schema.orders.status, ["draft", "open"]),
          isNull(schema.orders.waveId),
        ),
      ),
    db
      .select({ orderId: schema.orderLines.orderId, itemId: schema.orderLines.itemId, qty: schema.orderLines.qty })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .where(
        and(
          eq(schema.orders.organizationId, organizationId),
          eq(schema.orders.warehouseId, warehouseId),
          inArray(schema.orders.status, ["draft", "open"]),
          isNull(schema.orders.waveId),
        ),
      ),
    db
      .select({
        itemId: schema.inventoryBalances.itemId,
        qty: schema.inventoryBalances.qty,
        zoneId: schema.locations.zoneId,
      })
      .from(schema.inventoryBalances)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.inventoryBalances.locationId))
      .where(
        and(
          eq(schema.inventoryBalances.organizationId, organizationId),
          eq(schema.locations.warehouseId, warehouseId),
          gt(schema.inventoryBalances.qty, 0),
          isNotNull(schema.locations.zoneId),
        ),
      ),
    db
      .select({ id: schema.zones.id, name: schema.zones.name })
      .from(schema.zones)
      .where(and(eq(schema.zones.organizationId, organizationId), eq(schema.zones.warehouseId, warehouseId))),
    db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.organizationId, organizationId)),
    db.select().from(schema.carrierConnections).where(eq(schema.carrierConnections.organizationId, organizationId)),
  ]);

  // The zone an item is picked from is where most of it sits.
  const zoneByItem = new Map<string, { zoneId: string; qty: number }>();
  for (const face of faces) {
    const best = zoneByItem.get(face.itemId);
    if (face.zoneId && (!best || face.qty > best.qty)) zoneByItem.set(face.itemId, { zoneId: face.zoneId, qty: face.qty });
  }
  const linesByOrder = new Map<string, { itemId: string; qty: number }[]>();
  for (const line of lines) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push(line);
    linesByOrder.set(line.orderId, list);
  }
  const defaultCarrier = resolveService(warehouse.defaultCarrierService)?.company ?? null;

  const planOrders: WavePlanOrder[] = orders.map((row) => {
    const own = linesByOrder.get(row.id) ?? [];
    const promise = promiseById.get(row.id);
    return {
      id: row.id,
      number: row.number,
      clientId: row.clientId,
      carrier: resolveService(row.carrierService)?.company ?? defaultCarrier,
      zoneIds: [...new Set(own.map((line) => zoneByItem.get(line.itemId)?.zoneId).filter((id): id is string => Boolean(id)))],
      units: own.reduce((sum, line) => sum + line.qty, 0),
      promise: promise ? { code: promise.code, promisedAt: promise.promisedAt, reason: promise.reason } : null,
    };
  });

  const plan = planWaves({ now, timeZone, cutoffs, orders: planOrders });
  const zoneName = new Map(zones.map((row) => [row.id, row.name]));
  const clientName = new Map(clients.map((row) => [row.id, row.name]));
  const carriers = new Set<string>([
    ...enabledServicesFromConnections(connections)
      .map((service) => service.company)
      .filter((company) => company !== "Rackline"),
    ...Object.keys(cutoffs).filter((key) => key !== ANY_CARRIER),
    ...planOrders.map((row) => row.carrier).filter((c): c is string => Boolean(c)),
  ]);

  return {
    asOf: now,
    timeZone,
    cutoffs: [ANY_CARRIER, ...[...carriers].sort()].map((carrier) => {
      const minutes = cutoffFor(cutoffs, carrier === ANY_CARRIER ? null : carrier);
      return { carrier, minutes, label: cutoffLabel(minutes), set: carrier in cutoffs };
    }),
    groups: plan.groups.map((group) => ({
      ...group,
      zoneName: group.zoneId ? (zoneName.get(group.zoneId) ?? null) : null,
      clientName: group.clientId ? (clientName.get(group.clientId) ?? null) : null,
    })),
    waiting: plan.waiting,
    unwaved: orders.length,
  };
}
