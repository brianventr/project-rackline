import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type KitBuild, type ScanHit } from "../../api";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canCompleteKit, canDekit } from "@/domain/status";
import { AsBuiltList } from "../../components/as-built";

export function FloorKitPage() {
  const [params] = useSearchParams();
  const [kits, setKits] = useState<KitBuild[]>([]);
  const [active, setActive] = useState<KitBuild | null>(null);
  const [serials, setSerials] = useState("");
  const [thisQty, setThisQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function applyKit(kit: KitBuild) {
    setActive(kit);
    setThisQty(String(kit.remaining ?? Math.max(0, kit.qty - (kit.qtyCompleted ?? 0))));
  }

  async function load() {
    const next = await api<KitBuild[]>("/api/kits");
    setKits(next.filter((row) => canCompleteKit(row.status) || canDekit(row.status)));
    const wanted = params.get("id");
    if (wanted) applyKit(next.find((row) => row.id === wanted) ?? (await api<KitBuild>(`/api/kits/${wanted}`)));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "kit") void api<KitBuild>(`/api/kits/${hit.kit.id}`).then(applyKit);
        else setError("Scan a kit document.");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function complete() {
    if (!active) return;
    setError(null);
    try {
      const completed = await api<KitBuild>(`/api/kits/${active.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ qty: Number(thisQty), serials: serials || undefined }),
      });
      applyKit(completed);
      setDone(`${completed.number} completed ${thisQty}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
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
      setError(err instanceof Error ? err.message : "Dekit failed");
    }
  }

  const remaining = active ? (active.remaining ?? Math.max(0, active.qty - (active.qtyCompleted ?? 0))) : 0;

  return (
    <FloorFrame title="Kit" description="Complete remaining qty from the recipe, or dekit a finished build." error={error}>
      <FloorScanBox label="Scan kit" placeholder="KIT-DEMO1" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open kits</p>
          <ul className="space-y-2 text-sm">
            {kits.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => applyKit(row)}>
                  <span className="font-mono">{row.number}</span> {row.sku} {row.qtyCompleted ?? 0}/{row.qty}{" "}
                  <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {kits.length === 0 ? <li className="text-muted-foreground">Nothing to kit.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>
            Kit {active.sku} · completed {active.qtyCompleted ?? 0}/{active.qty}
          </p>
          {canCompleteKit(active.status) && remaining > 0 ? (
            <Field label={`This complete (remaining ${remaining})`}>
              <Input type="number" min={1} max={remaining} value={thisQty} onChange={(e) => setThisQty(e.target.value)} />
            </Field>
          ) : null}
          {active.trackSerial && canCompleteKit(active.status) && remaining > 0 ? (
            <Field label="Finished serials (optional)">
              <Input value={serials} onChange={(e) => setSerials(e.target.value)} placeholder="LAMP-2001" />
            </Field>
          ) : null}
          {canCompleteKit(active.status) && remaining > 0 ? (
            <Button onClick={() => void complete()}>Complete kit</Button>
          ) : canDekit(active.status) ? (
            <div className="space-y-3">
              <p>Completed. Dekit restores components and consumes the finished SKU.</p>
              <Button onClick={() => void dekit()}>Dekit</Button>
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
        </Card>
      )}
    </FloorFrame>
  );
}
