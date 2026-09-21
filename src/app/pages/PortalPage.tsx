import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table } from "../components/ui";

type PortalRequest = {
  id: string;
  sku: string;
  itemName: string;
  qty: number;
  status: string;
  refType: string | null;
  refNumber: string | null;
};

type PortalPayload = {
  client: { code: string; name: string };
  recipes: { itemId: string; sku: string; itemName: string; itemType: string }[];
  requests: PortalRequest[];
  stock: { sku: string; itemName: string; locationCode: string; qty: number }[];
  runway: { sku: string; itemName: string; onHand: number; shippedUnits: number; days: number | null }[];
  orders: { id: string; number: string; status: string; source: string; customerName: string }[];
  invoices: { id: string; number: string; amountCents: number; issuedAt: number | null }[];
};

export function PortalPage() {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [pending, setPending] = useState(false);

  function load() {
    return api<PortalPayload>("/api/portal").then((next) => {
      setData(next);
      setItemId((current) => current || next.recipes[0]?.itemId || "");
    });
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function ask(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api("/api/portal/requests", {
        method: "POST",
        body: JSON.stringify({ itemId, qty: Number(qty) }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request a build");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Brand"
        title={data ? data.client.name : "Your stock"}
        description="Ask for a build, then see on-hand, runway, open orders, and issued invoices."
      />
      <ErrorBanner error={error} />
      {data ? (
        <>
          <Card>
            <p className="mb-2 text-sm font-medium">Ask for a build</p>
            <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(event) => void ask(event)}>
              <Field label="Recipe">
                <Select className="h-8 w-56 text-sm" value={itemId} onChange={(event) => setItemId(event.target.value)} required>
                  {data.recipes.length ? null : <option value="">No recipes</option>}
                  {data.recipes.map((recipe) => (
                    <option key={recipe.itemId} value={recipe.itemId}>
                      {recipe.sku} · {recipe.itemName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Qty">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={qty}
                  onChange={(event) => setQty(event.target.value)}
                  required
                />
              </Field>
              <Button type="submit" disabled={pending || !itemId}>
                Request
              </Button>
            </form>
            <Table columns={["SKU", "Qty", "Status", "Document"]}>
              {data.requests.length ? (
                data.requests.map((row) => (
                  <tr key={row.id}>
                    <td className="px-2.5 py-1.5 font-mono">{row.sku}</td>
                    <td className="px-2.5 py-1.5 font-mono">{row.qty}</td>
                    <td className="px-2.5 py-1.5">{row.status}</td>
                    <td className="px-2.5 py-1.5 font-mono">{row.refNumber ?? "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-2.5 py-1.5 text-muted-foreground" colSpan={4}>
                    No build requests yet.
                  </td>
                </tr>
              )}
            </Table>
          </Card>
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
