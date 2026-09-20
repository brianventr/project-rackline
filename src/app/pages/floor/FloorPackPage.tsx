import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Order, type ScanHit } from "../../api";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow } from "./floor-ui";
import { canPackOrder, canStartPack, canCancelOrder } from "@/domain/status";
import { hasUnpacked } from "@/domain/partial-pack";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

export function FloorPackPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("pack");
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
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      const match = next.find((row) => row.id === wanted) ?? (await api<Order>(`/api/orders/${wanted}`));
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "order", match.id, "pack"), applyOrder, setError);
    }
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
            void api<Order>(`/api/orders/${hit.order.id}`).then((order) =>
              openFloorRow(order, me.user.id, jobForRef(jobs, "order", order.id, "pack"), applyOrder, setError),
            );
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
    [active, jobs, me.user.id],
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

  async function cancel() {
    if (!active) return;
    setError(null);
    try {
      const next = await api<Order>(`/api/orders/${active.id}/cancel`, { method: "POST" });
      applyOrder(next);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
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
        <ClaimList
          title="Ready to pack"
          empty="Nothing to pack."
          rows={orders}
          userId={me.user.id}
          jobFor={(row) => jobForRef(jobs, "order", row.id, "pack")}
          onOpen={(row) =>
            openFloorRow(row, me.user.id, jobForRef(jobs, "order", row.id, "pack"), (order) => {
              void api<Order>(`/api/orders/${order.id}`).then(applyOrder);
            }, setError)
          }
          render={(row) => (
            <>
              <span className="font-mono">{row.number}</span> {row.customerName} <StatusBadge status={row.status} />
            </>
          )}
        />
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
              {canCancelOrder(active.status) ? (
                <Button variant="secondary" onClick={() => void cancel()}>
                  Cancel order
                </Button>
              ) : null}
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
