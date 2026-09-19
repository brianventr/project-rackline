import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type Order, type ScanHit } from "../../api";
import { Button, Card, Field, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canPickOrder } from "@/domain/status";

export function FloorPickPage() {
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextOrders, nextLocations] = await Promise.all([
      api<Order[]>("/api/orders"),
      api<Location[]>("/api/locations"),
    ]);
    setOrders(nextOrders.filter((row) => canPickOrder(row.status)));
    setLocations(nextLocations);
    const storage = nextLocations.find((row) => row.type === "storage") ?? nextLocations[0];
    if (storage) setLocationId(storage.id);
    const wanted = params.get("id");
    if (wanted) setActive(nextOrders.find((row) => row.id === wanted) ?? (await api<Order>(`/api/orders/${wanted}`)));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "order") {
          void api<Order>(`/api/orders/${hit.order.id}`).then(setActive);
          return;
        }
        if (hit.kind === "location") {
          setLocationId(hit.location.id);
          return;
        }
        setError("Scan an order or a pick bay.");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function pick() {
    if (!active) return;
    setError(null);
    try {
      if (active.status === "open" || active.status === "draft") {
        await api(`/api/orders/${active.id}/start`, { method: "POST" });
      }
      const picked = await api<Order>(`/api/orders/${active.id}/pick`, {
        method: "POST",
        body: JSON.stringify({ locationId }),
      });
      setActive(picked);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pick failed");
    }
  }

  return (
    <FloorFrame title="Pick" description="Scan the order, go to the bay, confirm the pick." error={error}>
      <FloorScanBox label="Scan order or bay" placeholder="ORD-DEMO1 or A-01-01" onScan={onScan} />
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open orders</p>
          <ul className="space-y-2 text-sm">
            {orders.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => setActive(row)}>
                  <span className="font-mono">{row.number}</span> {row.customerName} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {orders.length === 0 ? <li className="text-muted-foreground">Nothing to pick.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>{active.customerName}</p>
          <ul className="text-sm">
            {(active.lines ?? []).map((line) => (
              <li key={line.id}>
                {line.sku} × {line.qty}
              </li>
            ))}
          </ul>
          <Field label="Pick from">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          {canPickOrder(active.status) ? (
            <Button onClick={() => void pick()}>Pick order</Button>
          ) : (
            <Link className="font-medium underline" to={`/floor/pack?id=${active.id}`}>
              Go pack
            </Link>
          )}
        </Card>
      )}
    </FloorFrame>
  );
}
