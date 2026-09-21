import { useEffect, useState } from "react";
import { api } from "../../api";
import { Button, Card, ErrorBanner, PageHeader } from "../../components/ui";

type InvoiceLine = {
  kind: string;
  label: string;
  qty: number;
  amountCents: number;
  refId?: string;
  refNumber?: string;
};

type BillingPayload = {
  account: { plan: string; status: string } | null;
  invoices: {
    id: string;
    number: string;
    amountCents: number;
    status: string;
    clientCode: string | null;
    clientName: string | null;
    emailedAt: number | null;
    lines: InvoiceLine[];
  }[];
  clientCount: number;
  periodDays: number;
};

export function BillingPage() {
  const [data, setData] = useState<BillingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setData(await api<BillingPayload>("/api/billing"));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function generate() {
    setError(null);
    try {
      await api("/api/billing/invoices/generate", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    }
  }

  async function issue(id: string) {
    setError(null);
    try {
      await api(`/api/billing/invoices/${id}/issue`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Issue failed");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Billing"
        description="Draft one invoice per client from the rate card on that client. Issue emails it when mail is configured."
      />
      <ErrorBanner error={error} />
      {data ? (
        <Card className="max-w-xl space-y-4">
          <p className="text-sm">
            Plan <span className="font-mono">{data.account?.plan ?? "—"}</span> · {data.clientCount} clients · activity
            window {data.periodDays} days. A missing rate is not billed. House stock stays off the invoice.
          </p>
          <Button onClick={() => void generate()}>Generate draft invoices</Button>
          <ul className="space-y-3 text-sm">
            {data.invoices.map((inv) => (
              <li key={inv.id}>
                <p>
                  {inv.number}
                  {inv.clientCode ? ` · ${inv.clientCode}` : ""} — {(inv.amountCents / 100).toFixed(2)} ({inv.status}
                  {inv.emailedAt ? ", emailed" : ""})
                </p>
                {inv.lines.length > 0 ? (
                  <ul className="mt-1 text-muted-foreground">
                    {inv.lines.map((line) => (
                      <li key={`${inv.id}-${line.kind}-${line.refId ?? "none"}`}>
                        {line.label}
                        {line.refNumber ? ` · ${line.refNumber}` : ""} × {line.qty} · {(line.amountCents / 100).toFixed(2)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {inv.status === "draft" ? (
                  <Button className="mt-2" variant="secondary" onClick={() => void issue(inv.id)}>
                    Issue
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
