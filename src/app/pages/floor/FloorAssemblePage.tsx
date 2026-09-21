import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type ScanHit, type WorkOrder } from "../../api";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow } from "./floor-ui";
import { canCompleteWorkOrder } from "@/domain/status";
import { AsBuiltList } from "../../components/as-built";
import { KitRecipeCard } from "../../components/kit-recipe";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

export function FloorAssemblePage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("assemble");
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [active, setActive] = useState<WorkOrder | null>(null);
  const [thisQty, setThisQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function applyOrder(order: WorkOrder) {
    setActive(order);
    setThisQty(String(order.remaining ?? Math.max(0, order.qty - (order.qtyCompleted ?? 0))));
  }

  async function openOrder(id: string, nextJobs = jobs) {
    try {
      const order = await api<WorkOrder>(`/api/work-orders/${id}`);
      openFloorRow(order, me.user.id, jobForRef(nextJobs, "workOrder", order.id, "assemble"), applyOrder, setError);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load work order");
    }
  }

  async function load() {
    const next = await api<WorkOrder[]>("/api/work-orders");
    setOrders(next.filter((row) => canCompleteWorkOrder(row.status)));
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      await openOrder(wanted, nextJobs);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "workOrder") {
          void openOrder(hit.workOrder.id);
        } else setError("Scan a work order.");
      })
      .catch((err: Error) => setError(err.message));
  }, [jobs, me.user.id]);

  async function complete() {
    if (!active) return;
    setError(null);
    try {
      if (active.status === "draft") {
        await api(`/api/work-orders/${active.id}/start`, { method: "POST" });
      }
      const completed = await api<WorkOrder>(`/api/work-orders/${active.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ qty: Number(thisQty) }),
      });
      applyOrder(completed);
      setDone(`${completed.number} completed ${thisQty}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    }
  }

  const remaining = active ? (active.remaining ?? Math.max(0, active.qty - (active.qtyCompleted ?? 0))) : 0;

  return (
    <FloorFrame title="Assemble" description="Scan the work order, confirm the bins, complete remaining qty." error={error}>
      <FloorScanBox label="Scan work order" placeholder="WO-DEMO1" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <ClaimList
          title="Open work orders"
          empty="Nothing on the bench."
          rows={orders}
          userId={me.user.id}
          jobFor={(row) => jobForRef(jobs, "workOrder", row.id, "assemble")}
          onOpen={(row) => void openOrder(row.id)}
          render={(row) => (
            <>
              <span className="font-mono">{row.number}</span> {row.sku} {row.qtyCompleted ?? 0}/{row.qty}{" "}
              <StatusBadge status={row.status} />
            </>
          )}
        />
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>
            Build {active.sku} · completed {active.qtyCompleted ?? 0}/{active.qty}
          </p>
          <KitRecipeCard
            sku={active.sku}
            itemName={active.itemName}
            imageUrl={active.imageUrl}
            components={active.components}
            steps={active.steps}
            checkable
          />
          {canCompleteWorkOrder(active.status) && remaining > 0 ? (
            <>
              <Field label={`This complete (remaining ${remaining})`}>
                <Input type="number" min={1} max={remaining} value={thisQty} onChange={(e) => setThisQty(e.target.value)} />
              </Field>
              <Button onClick={() => void complete()}>Complete work order</Button>
            </>
          ) : (
            <div className="space-y-3">
              <p>Already completed.</p>
              <AsBuiltList
                title="As-built"
                empty="No component lots were recorded."
                rows={active.asBuilt ?? []}
                mode="from"
              />
            </div>
          )}
        </Card>
      )}
    </FloorFrame>
  );
}
