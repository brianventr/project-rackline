import { BOTH_MODES, DAY_MS, exceptionItem, type ExceptionItem, type ExceptionSourceInfo } from "./inbox";

/** A signed webhook the receiver did not accept. Send again posts the same body. */
export const WEBHOOK_SOURCE: ExceptionSourceInfo = { id: "webhooks", label: "Webhooks", modes: BOTH_MODES };

export const RESEND_WEBHOOK = { id: "resend-webhook", label: "Send again" };

export const WEBHOOK_WINDOW_MS = 30 * DAY_MS;

export type WebhookFailureRow = {
  id: string;
  event: string;
  url: string;
  error: string | null;
  responseCode: number | null;
  createdAt: number;
};

export function webhookResendPath(key: string): string | null {
  if (!key || key.includes("/")) return null;
  return `/integrations/webhooks/deliveries/${key}/send`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the receiver";
  }
}

export function webhookProblems(rows: readonly WebhookFailureRow[]): ExceptionItem[] {
  return rows.map((row) => {
    const why = row.error?.trim()
      ? row.error.trim()
      : row.responseCode
        ? `The receiver responded ${row.responseCode}.`
        : "The receiver did not answer.";
    return exceptionItem({
      source: WEBHOOK_SOURCE.id,
      key: row.id,
      kind: "webhook_failed",
      kindLabel: "Webhook failed",
      severity: "warning",
      title: `${row.event} did not reach ${hostOf(row.url)}`,
      detail: `${why} Send again when the receiver is up.`,
      createdAt: row.createdAt,
      link: "/setup/integrations",
      ownerOnly: true,
      action: RESEND_WEBHOOK,
    });
  });
}
