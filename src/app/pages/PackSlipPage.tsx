import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorText, type Order } from "../api";
import { Button, ErrorBanner } from "../components/ui";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { useSession } from "../session";
import { useAutoPrint } from "../print/use-auto-print";

export function PackSlipPage() {
  const { id } = useParams();
  const me = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<Order>(`/api/orders/${id}`)
      .then(setOrder)
      .catch((err: unknown) => setError(errorText(err, "Could not load the pack slip.")));
  }, [id]);

  useAutoPrint(Boolean(order));

  if (!order) return <ErrorBanner error={error} />;

  const printedAt = new Date().toLocaleString();

  return (
    <div className="print-document mx-auto max-w-2xl space-y-6 bg-card p-6 print:max-w-none print:p-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <Button variant="ghost" asChild>
          <Link to={`/outbound/orders/${order.id}`}>Back to order</Link>
        </Button>
        <Button onClick={() => window.print()}>Print pack slip</Button>
      </div>
      <ErrorBanner error={error} />
      <header className="flex flex-wrap items-start justify-between gap-6 border-b pb-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Pack slip</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold">{order.number}</h1>
          <p className="mt-2 text-lg">{order.customerName}</p>
          <p className="text-sm text-muted-foreground">{me.organization.name}</p>
          {order.shipToAddress ? (
            <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{order.shipToAddress}</p>
          ) : null}
        </div>
        <div className="text-right">
          <BarcodeLabel value={order.number} className="h-12 w-48" />
          <p className="mt-2 text-sm text-muted-foreground">Printed {printedAt}</p>
          <p className="text-sm capitalize">{order.status}</p>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Channel</dt>
          <dd>{order.source === "shopify" ? "Shopify" : "Floor"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Ordered</dt>
          <dd>{new Date(order.createdAt).toLocaleDateString()}</dd>
        </div>
        {order.trackingNumber ? (
          <div>
            <dt className="text-muted-foreground">Tracking</dt>
            <dd className="font-mono">{order.trackingNumber}</dd>
          </div>
        ) : null}
        {order.trackingCompany ? (
          <div>
            <dt className="text-muted-foreground">Carrier</dt>
            <dd>{order.trackingCompany}</dd>
          </div>
        ) : null}
      </dl>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 font-medium">SKU</th>
            <th className="py-2 font-medium">Item</th>
            <th className="py-2 text-right font-medium">Ordered</th>
            <th className="py-2 text-right font-medium">Picked</th>
            <th className="py-2 text-right font-medium">Packed</th>
          </tr>
        </thead>
        <tbody>
          {(order.lines ?? []).map((line) => (
            <tr key={line.id} className="border-b">
              <td className="py-3 font-mono">{line.sku}</td>
              <td className="py-3">{line.itemName}</td>
              <td className="py-3 text-right font-mono">{line.qty}</td>
              <td className="py-3 text-right font-mono">{line.qtyPicked ?? 0}</td>
              <td className="py-3 text-right font-mono">{line.qtyPacked ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(order.packages ?? []).length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-medium">Cartons</h2>
          {(order.packages ?? []).map((pkg) => (
            <div key={pkg.id} className="rounded-md border px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-mono font-medium">
                  {pkg.number}
                  {pkg.trackingNumber ? ` · ${pkg.trackingNumber}` : ""}
                  {pkg.shippedAt ? " · shipped" : ""}
                </p>
                <BarcodeLabel value={pkg.number} className="h-10 w-36" />
              </div>
              <ul className="text-sm">
                {(pkg.lines ?? []).map((line) => (
                  <li key={line.id} className="flex justify-between gap-3">
                    <span className="font-mono">{line.sku}</span>
                    <span className="font-mono">× {line.qty}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
      <p className="text-xs text-muted-foreground">Packed contents must match this slip before the box ships.</p>
    </div>
  );
}
