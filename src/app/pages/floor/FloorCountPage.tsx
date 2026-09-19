import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type CycleCount, type Location, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { useWarehouse } from "../../warehouse";
import { canPostCount } from "@/domain/status";

export function FloorCountPage() {
  const [params] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const [counts, setCounts] = useState<CycleCount[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<CycleCount | null>(null);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextCounts, nextLocations] = await Promise.all([
      api<CycleCount[]>("/api/cycle-counts"),
      api<Location[]>("/api/locations"),
    ]);
    setCounts(nextCounts.filter((row) => canPostCount(row.status)));
    setLocations(nextLocations);
    const storage = nextLocations.find((row) => row.type === "storage") ?? nextLocations[0];
    if (storage) setLocationId(storage.id);
    const wanted = params.get("id");
    if (wanted) setActive(await api<CycleCount>(`/api/cycle-counts/${wanted}`));
    const locationWanted = params.get("location");
    if (!wanted && locationWanted) {
      const match = nextLocations.find((row) => row.id === locationWanted);
      if (match) setLocationId(match.id);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback(
    (raw: string) => {
      setError(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then(async (hit) => {
          if (hit.kind === "cycleCount") {
            setActive(await api<CycleCount>(`/api/cycle-counts/${hit.cycleCount.id}`));
            return;
          }
          if (hit.kind === "location") {
            setLocationId(hit.location.id);
            const created = await api<CycleCount>("/api/cycle-counts", {
              method: "POST",
              body: JSON.stringify({ warehouseId, locationId: hit.location.id }),
            });
            await api(`/api/cycle-counts/${created.id}/start`, { method: "POST" }).catch(() => undefined);
            setActive(await api<CycleCount>(`/api/cycle-counts/${created.id}`));
            return;
          }
          setError("Scan a bay to count it.");
        })
        .catch((err: Error) => setError(err.message));
    },
    [warehouseId],
  );

  async function post() {
    if (!active) return;
    setError(null);
    try {
      const posted = await api<CycleCount>(`/api/cycle-counts/${active.id}/post`, {
        method: "POST",
        body: JSON.stringify({
          lines: (active.lines ?? []).map((line) => ({ id: line.id, countedQty: line.countedQty })),
        }),
      });
      setActive(posted);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post count");
    }
  }

  return (
    <FloorFrame title="Count" description="Scan a bay, count what’s there, post the variance." error={error}>
      <FloorScanBox label="Scan bay" placeholder="A-01-01" onScan={onScan} />
      {!active ? (
        <Card className="space-y-3">
          <Field label="Or choose a bay">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            onClick={() =>
              onScan(locations.find((row) => row.id === locationId)?.barcode || locationId)
            }
          >
            Start count
          </Button>
          <ul className="space-y-2 text-sm">
            {counts.map((row) => (
              <li key={row.id}>
                <button onClick={() => void api<CycleCount>(`/api/cycle-counts/${row.id}`).then(setActive)}>
                  {row.number} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          {(active.lines ?? []).map((line) => (
            <Field key={line.id} label={`${line.sku} (system ${line.systemQty})`}>
              <Input
                type="number"
                min={0}
                value={String(line.countedQty)}
                disabled={!canPostCount(active.status)}
                onChange={(e) => {
                  const countedQty = Number(e.target.value);
                  setActive((current) =>
                    current
                      ? {
                          ...current,
                          lines: (current.lines ?? []).map((row) => (row.id === line.id ? { ...row, countedQty } : row)),
                        }
                      : current,
                  );
                }}
              />
            </Field>
          ))}
          {canPostCount(active.status) ? <Button onClick={() => void post()}>Post variances</Button> : <p>Posted.</p>}
        </Card>
      )}
    </FloorFrame>
  );
}
