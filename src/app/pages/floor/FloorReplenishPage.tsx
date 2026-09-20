import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type ReplenishSuggestion, type Replenishment, type ScanHit } from "../../api";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow } from "./floor-ui";
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
    load().catch((err: Error) => setError(err.message));
  }, [warehouseId]);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "replenishment") {
          void api<Replenishment>(`/api/replenishments/${hit.replenishment.id}`).then((doc) =>
            openFloorRow(doc, me.user.id, jobForRef(jobs, "replenishment", doc.id, "replenish"), applyDoc, setError),
          );
          return;
        }
        setError("Scan a replenishment document, or pick a suggestion.");
      })
      .catch((err: Error) => setError(err.message));
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
      setError(err instanceof Error ? err.message : "Could not queue");
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
      setError(err instanceof Error ? err.message : "Post failed");
    }
  }

  const remaining = active ? (active.remaining ?? remainingToReplenish(active.qty, active.qtyMoved ?? 0)) : 0;

  return (
    <FloorFrame title="Replenish" description="Pull remaining qty from bulk onto a pick face that's below pick min." error={error}>
      <FloorScanBox label="Scan replenishment" placeholder="RPL-…" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <div className="grid gap-4 md:grid-cols-2">
          <ClaimList
            title="Open replenishments"
            empty="Nothing queued."
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
            title="Suggested now"
            empty="Pick faces are at min."
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
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>
            {active.sku} · moved {active.qtyMoved ?? 0}/{active.qty}
          </p>
          <p className="font-mono text-sm">
            {active.fromCode} → {active.toCode}
          </p>
          {canPostReplenishment(active.status) && remaining > 0 ? (
            <>
              <Field label={`This move (remaining ${remaining})`}>
                <Input type="number" min={1} max={remaining} value={thisQty} onChange={(e) => setThisQty(e.target.value)} />
              </Field>
              {active.trackLot ? (
                <Input placeholder="Lot (FIFO if blank)" value={lotCode} onChange={(e) => setLotCode(e.target.value)} />
              ) : null}
              {active.trackSerial ? (
                <Input placeholder="Serials" value={serials} onChange={(e) => setSerials(e.target.value)} />
              ) : null}
              <Button onClick={() => void post()}>Move remaining</Button>
            </>
          ) : (
            <p>Already posted.</p>
          )}
          <button className="text-sm underline" onClick={() => setActive(null)}>
            Back to list
          </button>
        </Card>
      )}
    </FloorFrame>
  );
}
