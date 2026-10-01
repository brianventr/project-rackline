import { and, eq, isNull, ne, or } from "drizzle-orm";
import { CHANNEL_SYNC_SOURCE, channelSyncProblems, SYNC_CHANNEL } from "../../domain/exceptions/channel-sync";
import * as schema from "../schema";
import type { ExceptionSource } from "./source";

export const channelSyncSource: ExceptionSource = {
  ...CHANNEL_SYNC_SOURCE,
  loadLimit: null,
  async load({ db, organizationId, warehouseId }) {
    const ch = schema.channelConnections;
    const rows = await db
      .select({
        id: ch.id,
        channel: ch.channel,
        externalShop: ch.externalShop,
        warehouseId: ch.warehouseId,
        lastSyncError: ch.lastSyncError,
        lastSyncAt: ch.lastSyncAt,
        createdAt: ch.createdAt,
      })
      .from(ch)
      .where(
        and(
          eq(ch.organizationId, organizationId),
          eq(ch.status, "active"),
          eq(ch.mode, "live"),
          ne(ch.lastSyncError, ""),
          or(isNull(ch.warehouseId), eq(ch.warehouseId, warehouseId)),
        ),
      );
    return channelSyncProblems(rows.flatMap(({ lastSyncError, ...row }) => (lastSyncError ? [{ ...row, lastSyncError }] : [])));
  },
  action(item, actionId) {
    if (actionId !== SYNC_CHANNEL.id) return null;
    return { path: `/channels/${encodeURIComponent(item.key)}/sync` };
  },
};
