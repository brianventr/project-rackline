import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, ErrorBanner, PageHeader, Table } from "../components/ui";

type PortalPayload = {
  client: { code: string; name: string };
  stock: { sku: string; itemName: string; locationCode: string; qty: number }[];
  runway: { sku: string; itemName: string; onHand: number; shippedUnits: number; days: number | null }[];
  orders: { id: string; number: string; status: string; source: string; customerName: string }[];
  invoices: { id: string; number: string; amountCents: number; issuedAt: number | null }[];
};

export function PortalPage() {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PortalPayload>("/api/portal")
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Brand"
        title={data ? data.client.name : "Your stock"}
        description="On-hand, runway, open orders, and issued invoices for this brand."
      />
      <ErrorBanner error={error} />
      {data ? (
        <>
          <Card>
            <p className="mb-2 text-sm font-medium">On hand</p>
            <Table columns={["SKU", "Item", "Bay", "Qty"]}>
              {data.stock.length ? (
                data.stock.map((row) => (
                  <tr key={`${row.sku}-${row.locationCode}`}>
                    <td className="px-2.5 py-1.5 font-mono">{row.sku}</td>
                    <td className="px-2.5 py-1.5">{row.itemName}</td>
                    <td className="px-2.5 py-1.5 font-mono">{row.locationCode}</td>
                    <td className="px-2.5 py-1.5 font-mono">{row.qty}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-2.5 py-1.5 text-muted-foreground" colSpan={4}>
                    Nothing on hand.
                  </td>
                </tr>
              )}
            </Table>
          </Card>
          <Card>
            <p className="mb-2 text-sm font-medium">Runway</p>
            <Table columns={["SKU", "On hand", "Shipped 30d", "Days"]}>
              {data.runway.length ? (
                data.runway.map((row) => (
                  <tr key={row.sku}>
                    <td className="px-2.5 py-1.5 font-mono">{row.sku}</td>
                    <td className="px-2.5 py-1.5 font-mono">{row.onHand}</td>
                    <td className="px-2.5 py-1.5 font-mono">{row.shippedUnits}</td>
                    <td className="px-2.5 py-1.5 font-mono">{row.days === null ? "—" : row.days}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-2.5 py-1.5 text-muted-foreground" colSpan={4}>
                    No client stock to cover.
                  </td>
                </tr>
              )}
            </Table>
          </Card>
          <Card>
            <p className="mb-2 text-sm font-medium">Open orders</p>
            <Table columns={["Order", "Customer", "Source", "Status"]}>
              {data.orders.length ? (
                data.orders.map((order) => (
                  <tr key={order.id}>
                    <td className="px-2.5 py-1.5 font-mono">{order.number}</td>
                    <td className="px-2.5 py-1.5">{order.customerName}</td>
                    <td className="px-2.5 py-1.5">{order.source}</td>
                    <td className="px-2.5 py-1.5">{order.status}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-2.5 py-1.5 text-muted-foreground" colSpan={4}>
                    No open orders.
                  </td>
                </tr>
              )}
            </Table>
          </Card>
          <Card>
            <p className="mb-2 text-sm font-medium">Issued invoices</p>
            <Table columns={["Invoice", "Amount"]}>
              {data.invoices.length ? (
                data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-2.5 py-1.5 font-mono">{invoice.number}</td>
                    <td className="px-2.5 py-1.5 font-mono">{(invoice.amountCents / 100).toFixed(2)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-2.5 py-1.5 text-muted-foreground" colSpan={2}>
                    No issued invoices.
                  </td>
                </tr>
              )}
            </Table>
          </Card>
        </>
      ) : null}
    </div>
  );
}
