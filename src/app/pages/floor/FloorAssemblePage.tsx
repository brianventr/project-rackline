import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Hammer } from "lucide-react";
import { api, errorText, type ScanHit, type WorkOrder } from "../../api";
import { Button, Card, DoneBanner, Field, Input, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { Skeleton } from "@/components/ui/skeleton";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow, type ScanReport } from "./floor-ui";
import { canCompleteWorkOrder } from "@/domain/status";
import { AsBuiltList } from "../../components/as-built";
import { KitRecipeCard } from "../../components/kit-recipe";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FloorAssemblePage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("assemble");
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<WorkOrder | null>(null);
  const [thisQty, setThisQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function applyOrder(order: WorkOrder) {
    setActive(order);
    setThisQty(String(order.remaining ?? Math.max(0, order.qty - (order.qtyCompleted ?? 0))));
  }

  /** Open a work order unless a teammate has claimed it. Resolves true when it opened. */
  async function openOrder(id: string, nextJobs = jobs): Promise<boolean> {
    try {
      const order = await api<WorkOrder>(`/api/work-orders/${id}`);
      return openFloorRow(order, me.user.id, jobForRef(nextJobs, "workOrder", order.id, "assemble"), applyOrder, setError);
    } catch (err) {
      setError(errorText(err, "Could not open that work order."));
      return false;
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
    load()
      .catch((err) => setError(errorText(err, "Could not load open work orders.")))
      .finally(() => setLoaded(true));
  }, []);

  const onScan = useCallback((raw: string, report?: ScanReport) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then(async (hit) => {
        if (hit.kind === "workOrder") {
          report?.(await openOrder(hit.workOrder.id));
          return;
        }
        setError("Scan a work order.");
        report?.(false);
      })
      .catch((err) => {
        setError(errorText(err, "That barcode did not scan. Try again."));
        report?.(false);
      });
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
      setError(errorText(err, "Could not complete the work order."));
    }
  }

  const remaining = active ? (active.remaining ?? Math.max(0, active.qty - (active.qtyCompleted ?? 0))) : 0;

  return (
    <FloorFrame title="Assemble" description="Scan the work order, confirm the bins, complete remaining qty." error={error}>
      <FloorScanBox label="Scan work order" placeholder="WO-DEMO1" onScan={onScan} ready={loaded} />
      <DoneBanner>{done}</DoneBanner>
      {!active ? (
        loaded ? (
          <ClaimList
            title="Open work orders"
            empty="Nothing on the bench."
            emptyBody="Work orders created in the office show up here to build."
            emptyIcon={Hammer}
            emptyAction={
              <Button variant="secondary" className="h-11" asChild>
                <Link to="/make/work-orders">Office work orders</Link>
              </Button>
            }
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
          <Skeleton className="h-40 w-full rounded-xl motion-reduce:animate-none" />
        )
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 text-xl font-semibold">{active.number}</h2>
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
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={remaining}
                  className="h-11 text-base"
                  value={thisQty}
                  onChange={(e) => setThisQty(e.target.value)}
                />
              </Field>
              <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void complete()}>
                Complete work order
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <p>
                Already completed. The <Term id="as-built">as-built</Term> list shows which component lots went in.
              </p>
              <AsBuiltList
                title="As-built"
                empty="No component lots were recorded."
                rows={active.asBuilt ?? []}
                mode="from"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-x-5">
            <button type="button" className={textLink} onClick={() => setActive(null)}>
              Back to list
            </button>
            <Link className={textLink} to={`/make/work-orders/${active.id}`}>
              Office work order
            </Link>
          </div>
        </Card>
      )}
    </FloorFrame>
  );
}
