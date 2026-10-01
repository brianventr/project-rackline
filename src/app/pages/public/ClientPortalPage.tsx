import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../../api";
import { PublicLoading, PublicMessage, PublicShell, useNoIndex } from "./public-page";

type PortalView = {
  organizationName: string;
  client: { code: string; name: string };
  stock: { sku: string; name: string; qty: number }[];
  orders: { number: string; status: string; city: string | null }[];
  shipments: { orderNumber: string; carrier: string | null; trackingNumber: string | null; status: string }[];
  invoices: {
    number: string;
    amountCents: number;
    status: string;
    periodStart: number;
    periodEnd: number;
    lines: { kind: string; label: string; qty: number; unitCents: number; amountCents: number }[];
  }[];
};

function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function day(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

/** `/portal/c/:token`: one client's stock, open orders, shipments, and invoices. No sign-in. */
export function ClientPortalPage() {
  const { token = "" } = useParams();
  const [view, setView] = useState<PortalView | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<PortalView>(`/api/portal/c/${encodeURIComponent(token)}`)
      .then(setView)
      .catch((err: unknown) => (err instanceof ApiError && err.status === 404 ? setMissing(true) : setFailed(true)));
  }, [token]);

  useNoIndex(view ? `${view.client.name} · ${view.organizationName}` : "Client portal");

  if (missing || failed) {
    return (
      <PublicShell shop={null}>
        <PublicMessage
          title={missing ? "We could not find that portal" : "The portal did not load"}
          body={
            missing
              ? "Ask the warehouse for a new link. An old link stops working when they rotate it."
              : "Check your connection and refresh the page."
          }
        />
      </PublicShell>
    );
  }
  if (!view) return <PublicLoading />;

  return (
    <PublicShell shop={{ name: view.organizationName, brandColor: null, logoUrl: null }}>
      <section className="space-y-1">
        <p className="text-sm text-muted-foreground">{view.client.code}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{view.client.name}</h1>
      </section>

      <Section title="On hand">
        {view.stock.length === 0 ? (
          <Empty>No pieces on hand.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">SKU</th>
                <th className="py-1 font-medium">Name</th>
                <th className="py-1 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {view.stock.map((row) => (
                <tr key={row.sku} className="border-t">
                  <td className="py-1 font-mono">{row.sku}</td>
                  <td className="py-1">{row.name}</td>
                  <td className="py-1 text-right font-mono">{row.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Open orders">
        {view.orders.length === 0 ? (
          <Empty>No open orders.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {view.orders.map((row) => (
              <li key={row.number} className="flex items-baseline justify-between gap-3">
                <span className="font-mono">{row.number}</span>
                <span className="text-muted-foreground">
                  {row.status}
                  {row.city ? ` · ${row.city}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent shipments">
        {view.shipments.length === 0 ? (
          <Empty>No shipments yet.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {view.shipments.map((row) => (
              <li key={`${row.orderNumber}-${row.trackingNumber ?? ""}`}>
                <span className="font-mono">{row.orderNumber}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {row.carrier || "Carrier"} · {row.trackingNumber || "No tracking"} · {row.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Invoices">
        {view.invoices.length === 0 ? (
          <Empty>No invoices yet.</Empty>
        ) : (
          <ul className="space-y-3 text-sm">
            {view.invoices.map((row) => (
              <li key={row.number}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono">{row.number}</span>
                  <span>
                    {money(row.amountCents)} · {row.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {day(row.periodStart)} – {day(row.periodEnd)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PublicShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-xs">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
