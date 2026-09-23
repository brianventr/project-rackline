import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownToLine } from "lucide-react";
import { api, errorText, type ReplenishSuggestion, type Replenishment, type ScanHit } from "../../api";
import { Button, Card, DoneBanner, Field, Input, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow, type ScanReport } from "./floor-ui";
import { canPostReplenishment } from "@/domain/status";
import { remainingToReplenish } from "@/domain/partial-replenish";
import { useWarehouse } from "../../warehouse";
import { useSession } from "../../session";
import { jobForRef, jobForSuggestion, useOpenJobs } from "../../jobs";

export function FloorReplenishPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("replenish");
  const [params] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const [docs, setDocs] = useState<Replenishment[]>([]);
  const [suggestions, setSuggestions] = useState<ReplenishSuggestion[]>([]);
  const [active, setActive] = useState<Replenishment | null>(null);
  const [thisQty, setThisQty] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [serials, setSerials] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function applyDoc(doc: Replenishment) {
    setActive(doc);
    setThisQty(String(doc.remaining ?? remainingToReplenish(doc.qty, doc.qtyMoved ?? 0)));
  }

  async function load() {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    const [nextDocs, nextSuggestions] = await Promise.all([
      api<Replenishment[]>("/api/replenishments"),
      api<ReplenishSuggestion[]>(`/api/replenishments/suggestions${query}`),
    ]);
    setDocs(nextDocs.filter((row) => canPostReplenishment(row.status)));
    setSuggestions(nextSuggestions);
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      const match = nextDocs.find((row) => row.id === wanted) ?? (await api<Replenishment>(`/api/replenishments/${wanted}`));
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "replenishment", match.id, "replenish"), applyDoc, setError);
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load replenishments.")))
      .finally(() => setLoaded(true));
  }, [warehouseId]);

  const onScan = useCallback((raw: string, report?: ScanReport) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then(async (hit) => {
        if (hit.kind === "replenishment") {
          const doc = await api<Replenishment>(`/api/replenishments/${hit.replenishment.id}`);
          report?.(
            openFloorRow(doc, me.user.id, jobForRef(jobs, "replenishment", doc.id, "replenish"), applyDoc, setError),
          );
          return;
        }
        setError("Scan a replenishment document, or pick a suggestion.");
        report?.(false);
      })
      .catch((err) => {
        setError(errorText(err, "That barcode did not scan. Try again."));
        report?.(false);
      });
  }, [jobs, me.user.id]);

  async function queueSuggestion(row: ReplenishSuggestion) {
    const job = jobForSuggestion(jobs, "replenishSuggestion", row.fromLocationId, row.itemId, row.toLocationId);
    if (job && job.assigneeId && job.assigneeId !== me.user.id) {
      setError(`This job is claimed by ${job.assigneeName || "another teammate"}`);
      return;
    }
    setError(null);
    try {
      const created = await api<Replenishment>("/api/replenishments", {
        method: "POST",
        body: JSON.stringify({
          warehouseId: row.warehouseId,
          itemId: row.itemId,
          qty: row.qty,
          fromLocationId: row.fromLocationId,
          toLocationId: row.toLocationId,
        }),
      });
      applyDoc(created);
    } catch (err) {
      setError(errorText(err, "Could not queue the replenishment."));
    }
  }

  async function post() {
    if (!active) return;
    setError(null);
    try {
      if (active.status === "draft") {
        await api(`/api/replenishments/${active.id}/start`, { method: "POST" });
      }
      const posted = await api<Replenishment>(`/api/replenishments/${active.id}/post`, {
        method: "POST",
        body: JSON.stringify({
          qty: Number(thisQty),
          lotCode: lotCode || undefined,
          serials: serials || undefined,
        }),
      });
      applyDoc(posted);
      setDone(`${posted.number} moved ${thisQty} ${posted.sku} ${posted.fromCode} → ${posted.toCode}.`);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not post the move."));
    }
  }

  const remaining = active ? (active.remaining ?? remainingToReplenish(active.qty, active.qtyMoved ?? 0)) : 0;

  return (
    <FloorFrame title="Replenish" description="Pull remaining qty from bulk onto a pick face that's below pick min." error={error}>
      <FloorScanBox label="Scan replenishment" placeholder="RPL-…" onScan={onScan} ready={loaded} />
      <DoneBanner>{done}</DoneBanner>
      {!active ? (
        <div className="grid gap-4 md:grid-cols-2">
          <ClaimList
            loading={!loaded}
            title="Open replenishments"
            empty="Nothing queued."
            emptyBody="Replenishments queued in the office or from a suggestion wait here until they are moved."
            emptyIcon={ArrowDownToLine}
            rows={docs}
            userId={me.user.id}
            jobFor={(row) => jobForRef(jobs, "replenishment", row.id, "replenish")}
            onOpen={(row) =>
              openFloorRow(row, me.user.id, jobForRef(jobs, "replenishment", row.id, "replenish"), applyDoc, setError)
            }
            render={(row) => (
              <>
                <span className="font-mono">{row.number}</span> {row.sku} × {row.qtyMoved ?? 0}/{row.qty}{" "}
                <StatusBadge status={row.status} />
              </>
            )}
          />
          <ClaimList
            loading={!loaded}
            title="Suggested now"
            empty="Pick faces are at min."
            emptyBody="A pick face that drops below its pick min shows here with a bulk bay to pull from."
            emptyIcon={ArrowDownToLine}
            rows={suggestions.map((row) => ({ ...row, id: `${row.itemId}:${row.toLocationId}` }))}
            userId={me.user.id}
            jobFor={(row) => jobForSuggestion(jobs, "replenishSuggestion", row.fromLocationId, row.itemId, row.toLocationId)}
            onOpen={(row) => void queueSuggestion(row)}
            render={(row) => (
              <>
                {row.sku} {row.qty} · {row.fromCode} → {row.toCode}
                <span className="block text-muted-foreground">
                  Pick {row.pickQty}/{row.pickMin}
                </span>
              </>
            )}
          />
        </div>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>
            {active.sku} · moved {active.qtyMoved ?? 0}/{active.qty}
          </p>
          <p className="text-sm">
            <span className="font-mono">
              {active.fromCode} → {active.toCode}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · <Term id="bulk-bay">bulk</Term> to <Term id="pick-face">pick face</Term>
            </span>
          </p>
          {canPostReplenishment(active.status) && remaining > 0 ? (
            <>
              <Field label={`This move (remaining ${remaining})`}>
                <Input
                  className="h-11 text-base"
                  type="number"
                  min={1}
                  max={remaining}
                  value={thisQty}
                  onChange={(e) => setThisQty(e.target.value)}
                />
              </Field>
              {active.trackLot ? (
                <Input
                  className="h-11 text-base"
                  aria-label="Lot code"
                  placeholder="Lot (FIFO if blank)"
                  value={lotCode}
                  onChange={(e) => setLotCode(e.target.value)}
                />
              ) : null}
              {active.trackSerial ? (
                <Input className="h-11 text-base" aria-label="Serials" placeholder="Serials" value={serials} onChange={(e) => setSerials(e.target.value)} />
              ) : null}
              <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void post()}>
                Move remaining
              </Button>
            </>
          ) : (
            <p>Already posted.</p>
          )}
          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => setActive(null)}
          >
            Back to list
          </button>
        </Card>
      )}
    </FloorFrame>
  );
}
