import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type ReplenishSuggestion, type Replenishment, type ScanHit } from "../../api";
import { Button, Card, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canPostReplenishment } from "@/domain/status";
import { useWarehouse } from "../../warehouse";

export function FloorReplenishPage() {
  const [params] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const [docs, setDocs] = useState<Replenishment[]>([]);
  const [suggestions, setSuggestions] = useState<ReplenishSuggestion[]>([]);
  const [active, setActive] = useState<Replenishment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    const [nextDocs, nextSuggestions] = await Promise.all([
      api<Replenishment[]>("/api/replenishments"),
      api<ReplenishSuggestion[]>(`/api/replenishments/suggestions${query}`),
    ]);
    setDocs(nextDocs.filter((row) => canPostReplenishment(row.status)));
    setSuggestions(nextSuggestions);
    const wanted = params.get("id");
    if (wanted) {
      setActive(nextDocs.find((row) => row.id === wanted) ?? (await api<Replenishment>(`/api/replenishments/${wanted}`)));
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
          void api<Replenishment>(`/api/replenishments/${hit.replenishment.id}`).then(setActive);
          return;
        }
        setError("Scan a replenishment document, or pick a suggestion.");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function queueSuggestion(row: ReplenishSuggestion) {
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
      setActive(created);
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
      const posted = await api<Replenishment>(`/api/replenishments/${active.id}/post`, { method: "POST" });
      setActive(posted);
      setDone(`${posted.number} posted ${posted.qty} ${posted.sku} ${posted.fromCode} → ${posted.toCode}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Post failed");
    }
  }

  return (
    <FloorFrame title="Replenish" description="Pull bulk down onto a pick face that's below pick min." error={error}>
      <FloorScanBox label="Scan replenishment" placeholder="RPL-…" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <p className="mb-3 font-medium">Open replenishments</p>
            <ul className="space-y-2 text-sm">
              {docs.map((row) => (
                <li key={row.id}>
                  <button className="w-full text-left" onClick={() => setActive(row)}>
                    <span className="font-mono">{row.number}</span> {row.sku} × {row.qty}{" "}
                    <StatusBadge status={row.status} />
                  </button>
                </li>
              ))}
              {docs.length === 0 ? <li className="text-muted-foreground">Nothing queued.</li> : null}
            </ul>
          </Card>
          <Card>
            <p className="mb-3 font-medium">Suggested now</p>
            <ul className="space-y-2 text-sm">
              {suggestions.map((row) => (
                <li key={`${row.itemId}:${row.toLocationId}`}>
                  <button className="w-full text-left" onClick={() => void queueSuggestion(row)}>
                    {row.sku} {row.qty} · {row.fromCode} → {row.toCode}
                    <span className="block text-muted-foreground">
                      Pick {row.pickQty}/{row.pickMin}
                    </span>
                  </button>
                </li>
              ))}
              {suggestions.length === 0 ? <li className="text-muted-foreground">Pick faces are at min.</li> : null}
            </ul>
          </Card>
        </div>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>
            {active.sku} × {active.qty}
          </p>
          <p className="font-mono text-sm">
            {active.fromCode} → {active.toCode}
          </p>
          {canPostReplenishment(active.status) ? (
            <Button onClick={() => void post()}>Post replenishment</Button>
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
