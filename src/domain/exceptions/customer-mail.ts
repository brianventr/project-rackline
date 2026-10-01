import { CUSTOMER_MAIL_EVENT_LABELS, isCustomerMailEvent, type CustomerMailEvent } from "../customer-mail";
import { BOTH_MODES, DAY_MS, exceptionItem, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** Customer emails the provider rejected. Resend tries the same row again. */
export const CUSTOMER_MAIL_SOURCE: ExceptionSourceInfo = { id: "customer-mail", label: "Customer emails", modes: BOTH_MODES };

export const RESEND_CUSTOMER_MAIL = { id: "resend-customer-email", label: "Resend" };

export const CUSTOMER_MAIL_WINDOW_MS = 30 * DAY_MS;

export type CustomerMailProblemRow = {
  orderId: string | null;
  rmaId: string | null;
  event: string;
  status: string;
  reason: string | null;
  orderNumber: string | null;
  rmaNumber: string | null;
  warehouseId: string | null;
  updatedAt: number;
};

/** `order:<id>:<event>` or `rma:<id>:<event>`, which is also the resend path. */
export function customerMailProblemKey(row: Pick<CustomerMailProblemRow, "orderId" | "rmaId" | "event">): string | null {
  if (!isCustomerMailEvent(row.event)) return null;
  if (row.event === "return_label" && row.rmaId) return `rma:${row.rmaId}:${row.event}`;
  if (row.orderId) return `order:${row.orderId}:${row.event}`;
  return null;
}

export function customerMailResendPath(key: string): string | null {
  const [kind, id, event] = key.split(":");
  if (!id || !event || !isCustomerMailEvent(event)) return null;
  if (kind === "order") return `/orders/${id}/customer-emails/${event}/resend`;
  if (kind === "rma") return `/returns/${id}/customer-emails/${event}/resend`;
  return null;
}

export function customerMailProblems(rows: readonly CustomerMailProblemRow[]): ExceptionItem[] {
  const items: ExceptionItem[] = [];
  for (const row of rows) {
    if (row.status !== "failed") continue;
    const key = customerMailProblemKey(row);
    if (!key || !row.warehouseId) continue;
    const event = row.event as CustomerMailEvent;
    const label = CUSTOMER_MAIL_EVENT_LABELS[event].toLowerCase();
    const which = row.orderNumber ? `order ${row.orderNumber}` : row.rmaNumber ? `return ${row.rmaNumber}` : "this order";
    const why = row.reason?.trim() ? `${row.reason.trim()} ` : "";
    items.push(
      exceptionItem({
        source: CUSTOMER_MAIL_SOURCE.id,
        key,
        kind: "customer_email_failed",
        kindLabel: "Customer email failed",
        severity: "warning",
        title: `The ${label} email for ${which} did not send`,
        detail: `${why}Resend it from here, or from the order.`,
        warehouseId: row.warehouseId,
        orderId: row.orderId,
        link: row.orderId ? `/outbound/orders/${row.orderId}` : `/outbound/returns/${row.rmaId}`,
        ownerOnly: true,
        action: RESEND_CUSTOMER_MAIL,
        createdAt: row.updatedAt,
      }),
    );
  }
  return items;
}
