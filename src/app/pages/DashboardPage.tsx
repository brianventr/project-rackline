import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Dashboard } from "../api";
import { Card, ErrorBanner, PageHeader } from "../components/ui";

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>("/api/dashboard")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  const stats = data
    ? [
        { label: "Units on hand", value: data.onHandUnits },
        { label: "Bin rows", value: data.binRows },
        { label: "SKUs", value: data.skuCount },
        { label: "Open receipts", value: data.openReceipts },
        { label: "Open orders", value: data.openOrders },
        { label: "Open work orders", value: data.openWorkOrders },
        { label: "Shopify to pick", value: data.shopifyOpenOrders },
      ]
    : [];

  return (
    <div>
      <PageHeader
        eyebrow="Bay 00"
        title="Floor board"
        description="A snapshot of stock, inbound, outbound, and the assembly bench."
      />
      <ErrorBanner error={error} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="font-mono text-xs uppercase tracking-widest text-muted">{stat.label}</p>
            <p className="mt-2 font-mono text-3xl tabular">{stat.value}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Recent movements</h2>
          {data?.recent.length ? (
            <ul className="space-y-2 text-sm">
              {data.recent.map((row) => (
                <li key={row.id} className="flex justify-between gap-4 border-b border-line/70 py-2 last:border-0">
                  <span>
                    <span className="font-mono text-xs uppercase text-muted">{row.type}</span>{" "}
                    <span className="font-medium">{row.sku}</span>
                  </span>
                  <span className="font-mono tabular">{row.qty}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No ledger activity yet.</p>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Floor shortcuts</h2>
          <div className="grid gap-2">
            <Link className="rounded-lg bg-ink px-4 py-3 text-sm font-semibold text-paper" to="/receipts">
              Post a receipt
            </Link>
            <Link className="rounded-lg border border-line px-4 py-3 text-sm font-semibold" to="/work-orders">
              Complete a work order
            </Link>
            <Link className="rounded-lg border border-line px-4 py-3 text-sm font-semibold" to="/orders">
              Pick and ship
            </Link>
            <Link className="rounded-lg border border-line px-4 py-3 text-sm font-semibold" to="/shopify">
              Shopify channel
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
