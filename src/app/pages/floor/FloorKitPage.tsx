import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Factory } from "lucide-react";
import { api, errorText, type KitBuild, type ScanHit } from "../../api";
import { confirmedQty } from "@/domain/step-confirm";
import { Button, Card, DoneBanner, Field, Input, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { Skeleton } from "@/components/ui/skeleton";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow, type ScanReport } from "./floor-ui";
import { canCompleteKit, canDekit } from "@/domain/status";
import { AsBuiltList } from "../../components/as-built";
import { KitRecipeCard } from "../../components/kit-recipe";
import { StepGate, stepShortfall } from "../../components/step-gate";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FloorKitPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("kit");
  const [params] = useSearchParams();
  const [kits, setKits] = useState<KitBuild[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<KitBuild | null>(null);
  const [serials, setSerials] = useState("");
  const [thisQty, setThisQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function applyKit(kit: KitBuild, resetQty = true) {
    setActive(kit);
    if (resetQty) setThisQty(String(kit.remaining ?? Math.max(0, kit.qty - (kit.qtyCompleted ?? 0))));
  }

  const activeRef = useRef(active);
  activeRef.current = active;

  /** Open a kit unless a teammate has claimed it. Resolves true when it opened. */
  async function openKit(id: string, nextJobs = jobs): Promise<boolean> {
    try {
      const kit = await api<KitBuild>(`/api/kits/${id}`);
      return openFloorRow(kit, me.user.id, jobForRef(nextJobs, "kit", kit.id, "kit"), applyKit, setError);
    } catch (err) {
      setError(errorText(err, "Could not open that kit."));
      return false;
    }
  }

  async function load() {
    const next = await api<KitBuild[]>("/api/kits");
    setKits(next.filter((row) => canCompleteKit(row.status) || canDekit(row.status)));
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      await openKit(wanted, nextJobs);
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load open kits.")))
      .finally(() => setLoaded(true));
  }, []);

  const onScan = useCallback((raw: string, report?: ScanReport) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then(async (hit) => {
        const open = activeRef.current;
        if (open && hit.kind === "item") {
          const ordered = [...(open.steps ?? [])].sort((a, b) => a.seq - b.seq);
          const step = ordered.find(
            (row) => row.componentItemId === hit.item.id && confirmedQty(open.confirmations ?? [], row.id) < open.qty,
          );
          if (!step) {
            setError("That scan does not confirm a step.");
            report?.(false);
            return;
          }
          const room = open.qty - confirmedQty(open.confirmations ?? [], step.id);
          const packQty = hit.pack?.qty && hit.pack.qty > 0 ? hit.pack.qty : 1;
          try {
            const updated = await api<KitBuild>(`/api/kits/${open.id}/steps/confirm`, {
              method: "POST",
              body: JSON.stringify({ stepId: step.id, code: raw, qty: Math.min(packQty, room) }),
            });
            applyKit(updated, false);
            report?.(true);
          } catch (err) {
            setError(errorText(err, "Could not confirm that step."));
            report?.(false);
          }
          return;
        }
        if (hit.kind === "kit") {
          report?.(await openKit(hit.kit.id));
          return;
        }
        setError("Scan a kit document.");
        report?.(false);
      })
      .catch((err) => {
        setError(errorText(err, "That barcode did not scan. Try again."));
        report?.(false);
      });
  }, [jobs, me.user.id]);

  async function confirmStep(body: { stepId?: string; code?: string; qty?: number }) {
    if (!active) return;
    setError(null);
    try {
      const updated = await api<KitBuild>(`/api/kits/${active.id}/steps/confirm`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      applyKit(updated, false);
    } catch (err) {
      setError(errorText(err, "Could not confirm that step."));
    }
  }

  async function complete() {
    if (!active) return;
    setError(null);
    try {
      const completed = await api<KitBuild>(`/api/kits/${active.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ qty: Number(thisQty), serials: serials || undefined }),
      });
      applyKit(completed);
      const label = (completed as KitBuild & { kitLabel?: string | null }).kitLabel;
      setDone(label ? `${completed.number} completed ${thisQty}. Kit label includes the serial.` : `${completed.number} completed ${thisQty}.`);
      if (label) {
        const blob = new Blob([label], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${completed.number}.zpl`;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      await load();
    } catch (err) {
      setError(errorText(err, "Could not complete the kit."));
    }
  }

  async function dekit() {
    if (!active) return;
    setError(null);
    try {
      const reversed = await api<KitBuild>(`/api/kits/${active.id}/dekit`, { method: "POST" });
      applyKit(reversed);
      setDone(`${reversed.number} dekitted.`);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not dekit this kit."));
    }
  }

  const remaining = active ? (active.remaining ?? Math.max(0, active.qty - (active.qtyCompleted ?? 0))) : 0;
  const posted = Number(thisQty);
  const postedQty = Number.isInteger(posted) && posted > 0 ? posted : 0;
  const stepProblem = active
    ? stepShortfall(active.steps, active.confirmations, active.qtyCompleted ?? 0, postedQty)
    : null;

  return (
    <FloorFrame title="Kit" description="Complete remaining qty from the recipe, or dekit a finished build." error={error}>
      <FloorScanBox label={active ? "Scan component or kit" : "Scan kit"} placeholder="KIT-DEMO1" onScan={onScan} ready={loaded} />
      <DoneBanner>{done}</DoneBanner>
      {!active ? (
        loaded ? (
          <ClaimList
            title="Open kits"
            empty="Nothing to kit."
            emptyBody="Kits created in the office show up here to build."
            emptyIcon={Factory}
            emptyAction={
              <Button variant="secondary" className="h-11" asChild>
                <Link to="/make/kits">Office kits</Link>
              </Button>
            }
            rows={kits}
            userId={me.user.id}
            jobFor={(row) => jobForRef(jobs, "kit", row.id, "kit")}
            onOpen={(row) => void openKit(row.id)}
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
            Kit {active.sku} · completed {active.qtyCompleted ?? 0}/{active.qty}
          </p>
          <KitRecipeCard
            sku={active.sku}
            itemName={active.itemName}
            imageUrl={active.imageUrl}
            components={active.components}
            steps={canCompleteKit(active.status) && remaining > 0 ? undefined : active.steps}
          />
          {canCompleteKit(active.status) && remaining > 0 ? (
            <StepGate
              steps={active.steps}
              confirmations={active.confirmations}
              qtyCompleted={active.qtyCompleted ?? 0}
              postedQty={postedQty}
              documentQty={active.qty}
              onConfirm={(body) => void confirmStep(body)}
            />
          ) : null}
          {canCompleteKit(active.status) && remaining > 0 ? (
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
          ) : null}
          {active.trackSerial && canCompleteKit(active.status) && remaining > 0 ? (
            <Field label="Finished serials (optional)">
              <Input
                className="h-11 text-base"
                value={serials}
                onChange={(e) => setSerials(e.target.value)}
                placeholder="LAMP-2001"
              />
            </Field>
          ) : null}
          {canCompleteKit(active.status) && remaining > 0 ? (
            <>
              <Button
                className="h-14 w-full text-lg sm:w-auto"
                disabled={postedQty <= 0 || Boolean(stepProblem)}
                onClick={() => void complete()}
              >
                Complete kit
              </Button>
              {stepProblem ? <p className="text-sm text-muted-foreground">{stepProblem}</p> : null}
            </>
          ) : canDekit(active.status) ? (
            <div className="space-y-3">
              <p>
                Completed. <Term id="dekit">Dekit</Term> restores components and consumes the finished SKU.
              </p>
              <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void dekit()}>
                Dekit
              </Button>
              <AsBuiltList
                title="As-built"
                empty="No component lots were recorded."
                rows={active.asBuilt ?? []}
                mode="from"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <p>{active.status === "dekitted" ? "Dekitted." : "Already completed."}</p>
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
            <Link className={textLink} to={`/make/kits/${active.id}`}>
              Office kit
            </Link>
          </div>
        </Card>
      )}
    </FloorFrame>
  );
}
