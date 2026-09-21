import { useState } from "react";
import { api, type RecallOrder } from "../api";
import { Button, Card, Field, Input } from "./ui";

export function RecallOrders({ orders }: { orders: RecallOrder[] }) {
  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">No orders have shipped this lot or serial.</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {orders.map((order) => (
        <li key={order.orderId}>
          <span className="font-mono">{order.number}</span> · {order.source} · qty {order.qty} ·{" "}
          {order.open ? "Open" : order.status}
          {order.tracking.length ? (
            <span className="text-muted-foreground">
              {" "}
              · {order.tracking.map((row) => row.number).join(", ")}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function RecallPanel({ title = "Recall" }: { title?: string }) {
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<RecallOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    setError(null);
    try {
      const result = await api<{ orders: RecallOrder[] }>(`/api/recall?q=${encodeURIComponent(query.trim())}`);
      setOrders(result.orders);
    } catch (err) {
      setOrders(null);
      setError(err instanceof Error ? err.message : "Recall failed");
    }
  }

  return (
    <Card className="space-y-3">
      <p className="text-sm font-medium">{title}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup();
        }}
      >
        <Field label="Lot or serial">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="LOT-2026-A or LAMP-1008" required />
        </Field>
        <Button type="submit">Find orders</Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {orders ? <RecallOrders orders={orders} /> : null}
    </Card>
  );
}
