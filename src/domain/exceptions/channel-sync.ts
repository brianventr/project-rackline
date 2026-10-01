import { asSentence } from "../error-copy";
import { CHANNELS, isChannelId } from "../channels/adapter";
import { BOTH_MODES, exceptionItem, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** Live WooCommerce and Etsy connections whose last order pull failed: new orders stop arriving. */
export const CHANNEL_SYNC_SOURCE: ExceptionSourceInfo = { id: "channel-sync", label: "Channel sync", modes: BOTH_MODES };

export const SYNC_CHANNEL = { id: "sync-channel", label: "Sync now" } as const;

export type ChannelSyncRow = {
  id: string;
  channel: string;
  externalShop: string | null;
  /** Null when the channel files orders into the org's first building. */
  warehouseId: string | null;
  lastSyncError: string;
  /** The last pull that worked. A failed pull leaves it alone. */
  lastSyncAt: number | null;
  createdAt: number;
};

export function channelSyncProblems(rows: readonly ChannelSyncRow[]): ExceptionItem[] {
  return rows.map((row) => {
    const name = isChannelId(row.channel) ? CHANNELS[row.channel].name : row.channel;
    const shop = row.externalShop ? ` (${row.externalShop})` : "";
    return exceptionItem({
      source: CHANNEL_SYNC_SOURCE.id,
      key: row.channel,
      kind: "channel_sync_failed",
      kindLabel: "Channel sync failed",
      severity: "blocking",
      title: `${name} orders are not coming in`,
      detail: `${asSentence(row.lastSyncError)} New ${name}${shop} orders wait until a sync works. Fix the connection in Channels, then sync now.`,
      warehouseId: row.warehouseId,
      createdAt: row.lastSyncAt ?? row.createdAt,
      link: "/setup/channels",
      ownerOnly: true,
      action: SYNC_CHANNEL,
    });
  });
}
