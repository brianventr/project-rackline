import { useState } from "react";
import { api, type RecallOrder } from "../api";
import { Button, Card, Field, Input } from "./ui";

type Held = { number: string; sku: string; locationCode: string; lotCode: string | null; serialCode: string | null };

export function HoldRemainderButton({ code }: { code: string }) {
  const [held, setHeld] = useState<Held[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function hold() {
    setError(null);
    setPending(true);
    try {
      const result = await api<{ created: Held[] }>("/api/recall/hold", {
        method: "POST",
        body: JSON.stringify({ q: code }),
      });
      setHeld(result.created);
    } catch (err) {
      setHeld(null);
      setError(err instanceof Error ? err.message : "Could not hold");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" disabled={pending || !code.trim()} onClick={() => void hold()}>
        Hold what's left
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {held ? (
        <p className="text-sm text-muted-foreground">
          {held.length
            ? `Held ${held.map((row) => `${row.number} ${row.sku} @ ${row.locationCode}`).join(", ")}`
            : "Already on hold."}
        </p>
      ) : null}
    </div>
  );
}

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
  const [lookedUp, setLookedUp] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    setError(null);
    const needle = query.trim();
    try {
      const result = await api<{ orders: RecallOrder[] }>(`/api/recall?q=${encodeURIComponent(needle)}`);
      setOrders(result.orders);
      setLookedUp(needle);
    } catch (err) {
      setOrders(null);
      setLookedUp("");
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
      {lookedUp ? <HoldRemainderButton code={lookedUp} /> : null}
    </Card>
  );
}
