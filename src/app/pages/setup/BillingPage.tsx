import { useEffect, useState } from "react";
import { api } from "../../api";
import { Button, Card, ErrorBanner, PageHeader } from "../../components/ui";

type BillingPayload = {
  account: { plan: string; status: string } | null;
  invoices: { id: string; number: string; amountCents: number; status: string }[];
  clientCount: number;
  feePerClientCents: number;
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

  return (
    <div>
      <PageHeader eyebrow="Setup" title="Billing" description="3PL plan and draft invoices (stub)." />
      <ErrorBanner error={error} />
      {data ? (
        <Card className="space-y-4 max-w-lg">
          <p className="text-sm">
            Plan <span className="font-mono">{data.account?.plan ?? "—"}</span> · {data.clientCount} clients · fee{" "}
            {data.feePerClientCents / 100} USD / client
          </p>
          <Button onClick={() => void generate()}>Generate draft invoice</Button>
          <ul className="text-sm space-y-1">
            {data.invoices.map((inv) => (
              <li key={inv.id}>
                {inv.number} — {(inv.amountCents / 100).toFixed(2)} ({inv.status})
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
