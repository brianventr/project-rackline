import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type ScanHit, type WorkOrder } from "../../api";
import { Button, Card, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canCompleteWorkOrder } from "@/domain/status";

export function FloorAssemblePage() {
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [active, setActive] = useState<WorkOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const next = await api<WorkOrder[]>("/api/work-orders");
    setOrders(next.filter((row) => canCompleteWorkOrder(row.status)));
    const wanted = params.get("id");
    if (wanted) setActive(next.find((row) => row.id === wanted) ?? (await api<WorkOrder>(`/api/work-orders/${wanted}`)));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "workOrder") void api<WorkOrder>(`/api/work-orders/${hit.workOrder.id}`).then(setActive);
        else setError("Scan a work order.");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function complete() {
    if (!active) return;
    setError(null);
    try {
      if (active.status === "draft") {
        await api(`/api/work-orders/${active.id}/start`, { method: "POST" });
      }
      const completed = await api<WorkOrder>(`/api/work-orders/${active.id}/complete`, { method: "POST" });
      setActive(completed);
      setDone(`${completed.number} completed.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    }
  }

  return (
    <FloorFrame title="Assemble" description="Scan the work order, confirm the bins, complete the build." error={error}>
      <FloorScanBox label="Scan work order" placeholder="WO-DEMO1" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open work orders</p>
          <ul className="space-y-2 text-sm">
            {orders.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => setActive(row)}>
                  <span className="font-mono">{row.number}</span> {row.sku} × {row.qty} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {orders.length === 0 ? <li className="text-muted-foreground">Nothing on the bench.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>
            Build {active.sku} × {active.qty}
          </p>
          {canCompleteWorkOrder(active.status) ? (
            <Button onClick={() => void complete()}>Complete work order</Button>
          ) : (
            <p>Already completed.</p>
          )}
        </Card>
      )}
    </FloorFrame>
  );
}
