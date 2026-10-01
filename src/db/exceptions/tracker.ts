import { and, asc, eq, gte, inArray, lte, max, ne, notExists, or, sql, type SQLWrapper } from "drizzle-orm";
import { DAY_MS, SOURCE_LIMIT } from "../../domain/exceptions/inbox";
import {
  STUCK_IN_TRANSIT_DAYS,
  TRACKER_SOURCE,
  TRACKER_WINDOW_MS,
  trackerProblems,
  trackerRawStatus,
  type TrackerRow,
} from "../../domain/exceptions/tracker";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

const ID_CHUNK = 90;

export const trackerSource: ExceptionSource = {
  ...TRACKER_SOURCE,
  async load({ db, organizationId, warehouseId, now }) {
    const o = schema.orders;
    const p = schema.orderPackages;
    const since = now - TRACKER_WINDOW_MS;
    const stuckSince = now - STUCK_IN_TRANSIT_DAYS * DAY_MS;
    const troubled = (status: SQLWrapper, at: SQLWrapper) =>
      and(gte(at, since), or(eq(status, "exception"), and(inArray(status, ["pre_transit", "in_transit"]), lte(at, stuckSince))));
    const exceptionsFirst = (status: SQLWrapper) => sql`case when ${status} = 'exception' then 0 else 1 end`;
    const openOrder = and(eq(o.organizationId, organizationId), eq(o.warehouseId, warehouseId), ne(o.status, "cancelled"));

    const [packages, orders] = await Promise.all([
      db
        .select({
          orderId: o.id,
          orderNumber: o.number,
          customerName: o.customerName,
          warehouseId: o.warehouseId,
          packageId: p.id,
          packageNumber: p.number,
          trackingNumber: p.trackingNumber,
          trackerStatus: p.trackerStatus,
          trackerUpdatedAt: p.trackerUpdatedAt,
        })
        .from(p)
        .innerJoin(o, eq(o.id, p.orderId))
        .where(and(eq(p.organizationId, organizationId), openOrder, troubled(p.trackerStatus, p.trackerUpdatedAt)))
        .orderBy(exceptionsFirst(p.trackerStatus), asc(p.trackerUpdatedAt))
        .limit(SOURCE_LIMIT + 1),
      db
        .select({
          orderId: o.id,
          orderNumber: o.number,
          customerName: o.customerName,
          warehouseId: o.warehouseId,
          trackingNumber: o.trackingNumber,
          trackerStatus: o.trackerStatus,
          trackerUpdatedAt: o.trackerUpdatedAt,
        })
        .from(o)
        .where(
          and(
            openOrder,
            troubled(o.trackerStatus, o.trackerUpdatedAt),
            notExists(db.select({ id: p.id }).from(p).where(eq(p.orderId, o.id))),
          ),
        )
        .orderBy(exceptionsFirst(o.trackerStatus), asc(o.trackerUpdatedAt))
        .limit(SOURCE_LIMIT + 1),
    ]);
    const rows: TrackerRow[] = [...packages, ...orders.map((row) => ({ ...row, packageId: null, packageNumber: null }))];

    const numbers = [
      ...new Set(rows.flatMap((row) => (row.trackerStatus === "exception" && row.trackingNumber ? [row.trackingNumber] : []))),
    ];
    const receipts = schema.trackerWebhookReceipts;
    const chunks: string[][] = [];
    for (let i = 0; i < numbers.length; i += ID_CHUNK) chunks.push(numbers.slice(i, i + ID_CHUNK));
    // SQLite fills the bare `payload_json` from the row that holds max(created_at).
    const latest = await Promise.all(
      chunks.map((chunk) =>
        db
          .select({ trackingNumber: receipts.trackingNumber, payloadJson: receipts.payloadJson, at: max(receipts.createdAt) })
          .from(receipts)
          .where(and(eq(receipts.organizationId, organizationId), inArray(receipts.trackingNumber, chunk)))
          .groupBy(receipts.trackingNumber),
      ),
    );
    const rawStatus = new Map<string, string>();
    for (const row of latest.flat()) {
      const raw = trackerRawStatus(row.payloadJson);
      if (row.trackingNumber && raw) rawStatus.set(row.trackingNumber, raw);
    }
    return trackerProblems(rows, rawStatus, now);
  },
};
