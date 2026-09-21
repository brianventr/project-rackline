import { useEffect, useState } from "react";
import { api } from "../../api";
import { Button, Card, ErrorBanner, PageHeader } from "../../components/ui";

type InvoiceLine = { kind: string; label: string; qty: number; amountCents: number };

type BillingPayload = {
  account: { plan: string; status: string } | null;
  invoices: {
    id: string;
    number: string;
    amountCents: number;
    status: string;
    clientCode: string | null;
    clientName: string | null;
    lines: InvoiceLine[];
  }[];
  clientCount: number;
  rates: { storageCentsPerPiece: number; pickCentsPerUnit: number; cartonCents: number };
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

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Billing"
        description="Draft one invoice per 3PL client from on-hand pieces, picks, and shipped cartons."
      />
      <ErrorBanner error={error} />
      {data ? (
        <Card className="space-y-4 max-w-lg">
          <p className="text-sm">
            Plan <span className="font-mono">{data.account?.plan ?? "—"}</span> · {data.clientCount} clients · storage{" "}
            {data.rates.storageCentsPerPiece}¢/piece · picks {data.rates.pickCentsPerUnit}¢/unit · cartons{" "}
            {(data.rates.cartonCents / 100).toFixed(2)} USD · picks and cartons cover {data.periodDays} days
          </p>
          <Button onClick={() => void generate()}>Generate draft invoices</Button>
          <ul className="space-y-3 text-sm">
            {data.invoices.map((inv) => (
              <li key={inv.id}>
                <p>
                  {inv.number}
                  {inv.clientCode ? ` · ${inv.clientCode}` : ""} — {(inv.amountCents / 100).toFixed(2)} ({inv.status})
                </p>
                {inv.lines.length > 0 ? (
                  <ul className="mt-1 text-muted-foreground">
                    {inv.lines.map((line) => (
                      <li key={`${inv.id}-${line.kind}`}>
                        {line.label} × {line.qty} · {(line.amountCents / 100).toFixed(2)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
