import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type KitBuild, type ScanHit } from "../../api";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canCompleteKit } from "@/domain/status";
import { AsBuiltList } from "../../components/as-built";

export function FloorKitPage() {
  const [params] = useSearchParams();
  const [kits, setKits] = useState<KitBuild[]>([]);
  const [active, setActive] = useState<KitBuild | null>(null);
  const [serials, setSerials] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const next = await api<KitBuild[]>("/api/kits");
    setKits(next.filter((row) => canCompleteKit(row.status)));
    const wanted = params.get("id");
    if (wanted) setActive(next.find((row) => row.id === wanted) ?? (await api<KitBuild>(`/api/kits/${wanted}`)));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "kit") void api<KitBuild>(`/api/kits/${hit.kit.id}`).then(setActive);
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
        body: JSON.stringify({ serials: serials || undefined }),
      });
      setActive(completed);
      setDone(`${completed.number} completed.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    }
  }

  return (
    <FloorFrame title="Kit" description="Consume the recipe and put the finished SKU in the output bay." error={error}>
      <FloorScanBox label="Scan kit" placeholder="KIT-DEMO1" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open kits</p>
          <ul className="space-y-2 text-sm">
            {kits.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => setActive(row)}>
                  <span className="font-mono">{row.number}</span> {row.sku} × {row.qty} <StatusBadge status={row.status} />
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
            Kit {active.sku} × {active.qty}
          </p>
          {active.trackSerial && canCompleteKit(active.status) ? (
            <Field label="Finished serials (optional)">
              <Input value={serials} onChange={(e) => setSerials(e.target.value)} placeholder="LAMP-2001" />
            </Field>
          ) : null}
          {canCompleteKit(active.status) ? (
            <Button onClick={() => void complete()}>Complete kit</Button>
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
