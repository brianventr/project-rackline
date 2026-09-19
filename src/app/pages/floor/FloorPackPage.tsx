import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Order, type ScanHit } from "../../api";
import { Button, Card, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canPackOrder } from "@/domain/status";

export function FloorPackPage() {
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [packedIds, setPackedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const next = await api<Order[]>("/api/orders");
    setOrders(next.filter((row) => canPackOrder(row.status)));
    const wanted = params.get("id");
    if (wanted) setActive(next.find((row) => row.id === wanted) ?? (await api<Order>(`/api/orders/${wanted}`)));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback(
    (raw: string) => {
      setError(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((hit) => {
          if (hit.kind === "order") {
            void api<Order>(`/api/orders/${hit.order.id}`).then((order) => {
              setActive(order);
              setPackedIds([]);
            });
            return;
          }
          if (hit.kind === "item" && active) {
            const line = (active.lines ?? []).find(
              (row) => row.itemId === hit.item.id || row.sku === hit.item.sku,
            );
            if (!line) {
              setError(`${hit.item.sku} is not on this order.`);
              return;
            }
            setPackedIds((current) => (current.includes(line.id) ? current : [...current, line.id]));
            return;
          }
          setError("Scan a picked order, then scan each SKU to verify.");
        })
        .catch((err: Error) => setError(err.message));
    },
    [active],
  );

  async function pack() {
    if (!active) return;
    setError(null);
    try {
      if (active.status === "picked") {
        await api(`/api/orders/${active.id}/start-pack`, { method: "POST" });
      }
      const packed = await api<Order>(`/api/orders/${active.id}/pack`, { method: "POST" });
      setActive(packed);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pack failed");
    }
  }

  const lines = active?.lines ?? [];
  const allVerified = lines.length > 0 && lines.every((line) => packedIds.includes(line.id));

  return (
    <FloorFrame title="Pack" description="Scan the tote or order, verify each line, close the box." error={error}>
      <FloorScanBox label="Scan order or SKU" placeholder="ORD-… or LAMP" onScan={onScan} />
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Ready to pack</p>
          <ul className="space-y-2 text-sm">
            {orders.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => { setActive(row); setPackedIds([]); }}>
                  <span className="font-mono">{row.number}</span> {row.customerName} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {orders.length === 0 ? <li className="text-muted-foreground">Nothing to pack.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <ul className="space-y-2 text-sm">
            {lines.map((line) => (
              <li key={line.id} className="flex justify-between">
                <span>
                  {line.sku} × {line.qtyPicked ?? line.qty}
                </span>
                <span>{packedIds.includes(line.id) ? "Verified" : "Scan to verify"}</span>
              </li>
            ))}
          </ul>
          {canPackOrder(active.status) ? (
            <div className="flex flex-wrap items-center gap-4">
              <Button disabled={!allVerified && lines.length > 0} onClick={() => void pack()}>
                Pack complete
              </Button>
              <Link className="font-medium underline" to={`/outbound/orders/${active.id}/pack-slip`}>
                Print pack slip
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              <Link className="font-medium underline" to={`/floor/ship?id=${active.id}`}>
                Go ship
              </Link>
              <Link className="font-medium underline" to={`/outbound/orders/${active.id}/pack-slip`}>
                Pack slip
              </Link>
            </div>
          )}
        </Card>
      )}
    </FloorFrame>
  );
}
