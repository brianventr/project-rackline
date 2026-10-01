import { asSentence } from "../error-copy";
import { canRetryPostBack, CHANNELS, isChannelId } from "../channels/adapter";
import { BOTH_MODES, exceptionItem, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** WooCommerce and Etsy orders whose tracking did not reach the channel. A `manual` post-back is by design, not a failure. */
export const POST_BACK_SOURCE: ExceptionSourceInfo = { id: "post-back", label: "Tracking post-back", modes: BOTH_MODES };

export const RETRY_POST_BACK = { id: "retry-post-back", label: "Retry post-back" } as const;

export type PostBackRow = {
  id: string;
  number: string;
  source: string;
  status: string;
  channelSyncStatus: string;
  channelSyncError: string | null;
  customerName: string;
  warehouseId: string;
  shippedAt: number | null;
  createdAt: number;
};

export function postBackProblems(rows: readonly PostBackRow[]): ExceptionItem[] {
  return rows.filter(canRetryPostBack).map((row) => {
    const channel = isChannelId(row.source) ? CHANNELS[row.source].name : "the channel";
    const why = row.channelSyncError ? `${asSentence(row.channelSyncError)} ` : "";
    return exceptionItem({
      source: POST_BACK_SOURCE.id,
      key: row.id,
      kind: "post_back_failed",
      kindLabel: "Post-back failed",
      severity: "warning",
      title: `${channel} was not told order ${row.number} shipped`,
      detail: `${why}${row.customerName} gets no tracking from ${channel} until it posts. Retry, or mark it shipped in ${channel}.`,
      warehouseId: row.warehouseId,
      orderId: row.id,
      createdAt: row.shippedAt ?? row.createdAt,
      link: `/outbound/orders/${row.id}`,
      action: RETRY_POST_BACK,
    });
  });
}
