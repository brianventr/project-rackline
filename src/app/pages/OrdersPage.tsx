import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Item, type Location, type Me, type Order } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";

type Line = { itemId: string; qty: string };

export function OrdersPage({ me }: { me: Me }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [pickLocation, setPickLocation] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCompany, setTrackingCompany] = useState("");
  const [error, setError] = useState<string | null>(null);
  const warehouseId = me.warehouses[0]?.id;

  async function load() {
    const [nextOrders, nextItems, nextLocations] = await Promise.all([
      api<Order[]>("/api/orders"),
      api<Item[]>("/api/items"),
      api<Location[]>("/api/locations"),
    ]);
    setOrders(nextOrders);
    setItems(nextItems);
    setLocations(nextLocations);
    if (!pickLocation) {
      const storage = nextLocations.find((location) => location.type === "storage") ?? nextLocations[0];
      if (storage) setPickLocation(storage.id);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          customerName,
          lines: lines
            .filter((line) => line.itemId)
            .map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      setCustomerName("");
      setLines([{ itemId: "", qty: "1" }]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create order");
    }
  }

  async function pick(id: string) {
    setError(null);
    try {
      await api(`/api/orders/${id}/pick`, {
        method: "POST",
        body: JSON.stringify({ locationId: pickLocation }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pick failed");
    }
  }

  async function ship(id: string) {
    setError(null);
    try {
      await api(`/api/orders/${id}/ship`, {
        method: "POST",
        body: JSON.stringify({
          trackingNumber: trackingNumber || undefined,
          trackingCompany: trackingCompany || undefined,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ship failed");
    }
  }

  async function retryShopify(id: string) {
    setError(null);
    try {
      await api(`/api/orders/${id}/shopify/fulfill`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Shopify fulfill failed");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Outbound"
        title="Orders"
        description="Shopify checkouts arrive as drafts. Pick decrements the bin. Ship records the outbound movement and posts fulfillment back to Shopify."
      />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="space-y-4" onSubmit={onSubmit(create)}>
          <Field label="Customer">
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
          </Field>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[1fr_120px]">
                <Select
                  value={line.itemId}
                  onChange={(e) =>
                    setLines((current) =>
                      current.map((row, i) => (i === index ? { ...row, itemId: e.target.value } : row)),
                    )
                  }
                >
                  <option value="">Select SKU</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) =>
                    setLines((current) =>
                      current.map((row, i) => (i === index ? { ...row, qty: e.target.value } : row)),
                    )
                  }
                />
              </div>
            ))}
            <Button variant="ghost" onClick={() => setLines((current) => [...current, { itemId: "", qty: "1" }])}>
              Add line
            </Button>
          </div>
          <Button type="submit">Create floor order</Button>
        </form>
      </Card>
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Field label="Pick from location">
          <Select value={pickLocation} onChange={(e) => setPickLocation(e.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} — {location.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tracking number">
          <Input
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="Optional for Shopify"
          />
        </Field>
        <Field label="Carrier">
          <Input
            value={trackingCompany}
            onChange={(e) => setTrackingCompany(e.target.value)}
            placeholder="UPS, USPS…"
          />
        </Field>
      </div>
      <Table columns={["Number", "Channel", "Customer", "Lines", "Status", "Shopify", ""]}>
        {orders.map((order) => (
          <tr key={order.id}>
            <td className="px-4 py-3 font-mono">{order.number}</td>
            <td className="px-4 py-3">
              {order.source === "shopify" ? (
                <Link className="font-medium text-warn underline-offset-2 hover:underline" to="/shopify">
                  Shopify
                </Link>
              ) : (
                <span className="text-muted-foreground">Floor</span>
              )}
            </td>
            <td className="px-4 py-3">{order.customerName}</td>
            <td className="px-4 py-3 text-sm">{summarizeLines(order.lines)}</td>
            <td className="px-4 py-3">
              <StatusBadge status={order.status} />
            </td>
            <td className="px-4 py-3">
              {order.source === "shopify" ? (
                <div>
                  <StatusBadge status={order.shopifySyncStatus || "inbound"} />
                  {order.shopifySyncError ? (
                    <p className="mt-1 max-w-xs text-xs text-bad">{order.shopifySyncError}</p>
                  ) : null}
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="px-4 py-3 text-right">
              <div className="flex justify-end gap-2">
                {order.status === "draft" ? <Button onClick={() => pick(order.id)}>Pick</Button> : null}
                {order.status === "picked" ? (
                  <Button onClick={() => ship(order.id)}>
                    {order.source === "shopify" ? "Ship & fulfill" : "Ship"}
                  </Button>
                ) : null}
                {order.status === "shipped" && order.source === "shopify" && order.shopifySyncStatus === "failed" ? (
                  <Button variant="secondary" onClick={() => retryShopify(order.id)}>
                    Retry Shopify
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
