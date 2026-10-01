import { and, desc, eq, gte, inArray, max, notInArray, or } from "drizzle-orm";
import { CARRIER_SOURCE, CARRIER_WINDOW_MS, carrierProblems, type CarrierEventRow } from "../../domain/exceptions/carrier";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

const KINDS = ["buy", "void"];
/** Orders with the newest failures. One `inArray` chunk, so the source costs two queries. */
const ORDER_LIMIT = 90;

export const carrierSource: ExceptionSource = {
  ...CARRIER_SOURCE,
  loadLimit: ORDER_LIMIT,
  async load({ db, organizationId, warehouseId, now }) {
    const e = schema.carrierOutboundEvents;
    const o = schema.orders;
    const since = now - CARRIER_WINDOW_MS;
    const latest = max(e.createdAt);
    const failed = await db
      .select({ orderId: o.id, latest })
      .from(e)
      .innerJoin(o, eq(o.id, e.orderId))
      .where(
        and(
          eq(e.organizationId, organizationId),
          eq(o.warehouseId, warehouseId),
          eq(e.status, "failed"),
          inArray(e.kind, KINDS),
          gte(e.createdAt, since),
          or(eq(e.kind, "void"), notInArray(o.status, ["shipped", "cancelled"])),
        ),
      )
      .groupBy(o.id)
      .orderBy(desc(latest))
      .limit(ORDER_LIMIT);
    if (failed.length === 0) return [];

    const events: CarrierEventRow[] = await db
      .select({
        id: e.id,
        orderId: o.id,
        orderNumber: o.number,
        orderStatus: o.status,
        warehouseId: o.warehouseId,
        kind: e.kind,
        status: e.status,
        requestJson: e.requestJson,
        responseJson: e.responseJson,
        createdAt: e.createdAt,
      })
      .from(e)
      .innerJoin(o, eq(o.id, e.orderId))
      .where(
        and(
          eq(e.organizationId, organizationId),
          inArray(
            e.orderId,
            failed.map((row) => row.orderId),
          ),
          inArray(e.kind, KINDS),
          gte(e.createdAt, since),
        ),
      );
    return carrierProblems(events);
  },
};
