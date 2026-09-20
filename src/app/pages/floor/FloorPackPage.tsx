import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Order, type ScanHit } from "../../api";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canPackOrder, canStartPack } from "@/domain/status";
import { hasUnpacked } from "@/domain/partial-pack";

export function FloorPackPage() {
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function applyOrder(order: Order) {
    setActive(order);
    setQtys(packQtyDefaults(order));
  }

  async function load() {
    const next = await api<Order[]>("/api/orders");
    setOrders(
      next.filter(
        (row) =>
          canPackOrder(row.status) &&
          hasUnpacked(
            (row.lines ?? []).map((line) => ({
              lineId: line.id,
              sku: line.sku,
              qtyPicked: line.qtyPicked ?? 0,
              qtyPacked: line.qtyPacked ?? 0,
            })),
          ),
      ),
    );
    const wanted = params.get("id");
    if (wanted) applyOrder(next.find((row) => row.id === wanted) ?? (await api<Order>(`/api/orders/${wanted}`)));
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
            void api<Order>(`/api/orders/${hit.order.id}`).then(applyOrder);
            return;
          }
          if (hit.kind === "item" && active) {
            const line = (active.lines ?? []).find((row) => row.itemId === hit.item.id || row.sku === hit.item.sku);
            if (!line) {
              setError(`${hit.item.sku} is not on this order.`);
              return;
            }
            setQtys((current) => ({ ...current, [line.id]: String(line.packRemaining ?? 0) }));
            return;
          }
          setError("Scan a picked order, then scan a SKU to pack remaining qty.");
        })
        .catch((err: Error) => setError(err.message));
    },
    [active],
  );

  async function pack() {
    if (!active) return;
    setError(null);
    try {
      if (canStartPack(active.status)) {
        const started = await api<Order>(`/api/orders/${active.id}/start-pack`, { method: "POST" });
        applyOrder(started);
      }
      const lines = (active.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(qtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      const packed = await api<Order>(`/api/orders/${active.id}/pack`, {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
      applyOrder(packed);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pack failed");
    }
  }

  const remaining =
    active &&
    hasUnpacked(
      (active.lines ?? []).map((line) => ({
        lineId: line.id,
        sku: line.sku,
        qtyPicked: line.qtyPicked ?? 0,
        qtyPacked: line.qtyPacked ?? 0,
      })),
    );
  const thisPack = Object.values(qtys).some((value) => Number(value) > 0);

  return (
    <FloorFrame title="Pack" description="Scan the tote, pack remaining qty, print a pack slip, close the box." error={error}>
      <FloorScanBox label="Scan order or SKU" placeholder="ORD-… or LAMP" onScan={onScan} />
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Ready to pack</p>
          <ul className="space-y-2 text-sm">
            {orders.map((row) => (
              <li key={row.id}>
                <button
                  className="w-full text-left"
                  onClick={() => {
                    void api<Order>(`/api/orders/${row.id}`).then(applyOrder);
                  }}
                >
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
          <ul className="space-y-3 text-sm">
            {(active.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="flex justify-between gap-3">
                  <span>
                    {line.sku} × {line.qty}
                    <span className="text-muted-foreground">
                      {" "}
                      · picked {line.qtyPicked ?? 0} · packed {line.qtyPacked ?? 0}
                    </span>
                  </span>
                </div>
                {(line.packRemaining ?? 0) > 0 ? (
                  <Field label={`This pack (remaining ${line.packRemaining})`}>
                    <Input
                      type="number"
                      min={0}
                      max={line.packRemaining}
                      value={qtys[line.id] ?? "0"}
                      onChange={(e) => setQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                    />
                  </Field>
                ) : (
                  <p className="text-muted-foreground">Packed</p>
                )}
              </li>
            ))}
          </ul>
          {canPackOrder(active.status) && remaining ? (
            <div className="flex flex-wrap items-center gap-4">
              <Button disabled={!thisPack} onClick={() => void pack()}>
                Pack remaining
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

function packQtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.packRemaining ?? 0)]));
}
