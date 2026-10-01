import { api } from "../api";
import { Button, Card, ErrorBanner } from "../components/ui";
import { Muted, RelativeTime } from "../components/cells";
import { useApiQuery } from "../query";
import { useWrite } from "../use-write";

type CustomerEmailRow = {
  id: string;
  orderId: string | null;
  rmaId: string | null;
  event: string;
  eventLabel: string;
  recipient: string | null;
  status: string;
  reason: string | null;
  providerId: string | null;
  logged: boolean;
  createdAt: number;
};

function statusLabel(row: CustomerEmailRow): string {
  if (row.status === "sent" && row.logged) return "Logged";
  if (row.status === "sent") return "Sent";
  if (row.status === "skipped") return "Skipped";
  if (row.status === "failed") return "Failed";
  return row.status;
}

/** Emails Rackline sent, skipped, or failed for this order, with an owner resend. */
export function CustomerEmailsCard({ orderId, owner }: { orderId: string; owner: boolean }) {
  const emails = useApiQuery<{ emails: CustomerEmailRow[] }>(`/api/orders/${encodeURIComponent(orderId)}/customer-emails`);
  const write = useWrite();
  const rows = emails.data?.emails ?? [];

  async function resend(row: CustomerEmailRow) {
    const path = row.rmaId
      ? `/api/returns/${encodeURIComponent(row.rmaId)}/customer-emails/return-label`
      : `/api/orders/${encodeURIComponent(orderId)}/customer-emails/${encodeURIComponent(row.event)}/resend`;
    await write.run(
      "Resend email",
      () => api<{ logged?: boolean }>(path, { method: "POST", body: "{}" }),
      (result) => (result.logged ? "Email logged. Mail is not configured." : "Email sent."),
    );
    void emails.refetch();
  }

  return (
    <Card className="space-y-2">
      <p className="text-sm font-medium">Customer emails</p>
      <ErrorBanner error={write.error ?? emails.error?.message ?? null} />
      {rows.length === 0 ? (
        <Muted>No customer emails yet.</Muted>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{row.eventLabel}</span>
                <span className="text-muted-foreground"> · {statusLabel(row)}</span>
                {row.recipient ? <span className="block text-xs text-muted-foreground">{row.recipient}</span> : null}
                {row.reason ? <span className="block text-xs text-muted-foreground">{row.reason}</span> : null}
                <span className="block text-xs text-muted-foreground">
                  <RelativeTime at={row.createdAt} />
                </span>
              </span>
              {owner ? (
                <Button size="xs" variant="outline" disabled={write.busy} onClick={() => void resend(row)}>
                  Resend
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
