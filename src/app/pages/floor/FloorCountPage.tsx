import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type CycleCount, type Location, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox, ClaimList, openFloorRow } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { useWarehouse } from "../../warehouse";
import { canPostCount } from "@/domain/status";
import { allLinesEntered, countVariance, formatCountVariance, isBlindCount } from "@/domain/blind-count";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

export function FloorCountPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("count");
  const [params] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const [counts, setCounts] = useState<CycleCount[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<CycleCount | null>(null);
  const [locationId, setLocationId] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
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
    if (wanted) {
      const match = await api<CycleCount>(`/api/cycle-counts/${wanted}`);
      const nextJobs = await reloadJobs();
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "cycleCount", match.id, "count"), setActive, setError);
    }
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
            const match = await api<CycleCount>(`/api/cycle-counts/${hit.cycleCount.id}`);
            openFloorRow(match, me.user.id, jobForRef(jobs, "cycleCount", match.id, "count"), setActive, setError);
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
          if (hit.kind === "item") {
            if (!active || !canPostCount(active.status)) {
              setError("Scan a bay first, then scan a SKU you found.");
              return;
            }
            const existing = (active.lines ?? []).find(
              (line) => line.itemId === hit.item.id || line.sku === hit.item.sku,
            );
            if (existing) return;
            setActive(
              await api<CycleCount>(`/api/cycle-counts/${active.id}/lines`, {
                method: "POST",
                body: JSON.stringify({ itemId: hit.item.id }),
              }),
            );
            return;
          }
          setError("Scan a bay to count it, or a SKU you found in the bay.");
        })
        .catch((err: Error) => setError(err.message));
    },
    [warehouseId, active, jobs, me.user.id],
  );

  async function post() {
    if (!active) return;
    setError(null);
    try {
      const posted = await api<CycleCount>(`/api/cycle-counts/${active.id}/post`, {
        method: "POST",
        body: JSON.stringify({
          lines: (active.lines ?? [])
            .filter((line) => line.entered)
            .map((line) => ({
              id: line.id,
              countedQty: line.countedQty,
              weightGrams: parseWeightGrams(weights[line.id]),
            })),
        }),
      });
      setActive(posted);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post count");
    }
  }

  const lines = active?.lines ?? [];
  const ready = Boolean(active && canPostCount(active.status) && allLinesEntered(lines));

  return (
    <FloorFrame title="Count" description="Scan a bay, then count what you see. Scan a SKU that was not on the snapshot to add it. System qty stays hidden until you post." error={error}>
      <FloorScanBox label="Scan bay or found SKU" placeholder="A-01-01 or LAMP" onScan={onScan} />
      {!active ? (
        <>
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
        </Card>
          <ClaimList
            title="Open counts"
            empty="No open cycle counts."
            rows={counts}
            userId={me.user.id}
            jobFor={(row) => jobForRef(jobs, "cycleCount", row.id, "count")}
            onOpen={(row) =>
              openFloorRow(row, me.user.id, jobForRef(jobs, "cycleCount", row.id, "count"), (count) => {
                void api<CycleCount>(`/api/cycle-counts/${count.id}`).then(setActive);
              }, setError)
            }
            render={(row) => (
              <>
                {row.number} <StatusBadge status={row.status} />
              </>
            )}
          />
        </>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {active.locationCode}
            {isBlindCount(active.status) ? " · Blind count" : ""}
          </p>
          {lines.length === 0 ? (
            <p className="text-sm">Nothing on the snapshot. Confirm the bay is empty, or scan a SKU you found.</p>
          ) : (
            lines.map((line) => (
              <div key={line.id} className="space-y-2">
              <Field
                label={
                  isBlindCount(active.status) || line.systemQty === null
                    ? line.sku
                    : `${line.sku} · system ${line.systemQty} · variance ${formatCountVariance(countVariance(line.countedQty, line.systemQty))}`
                }
              >
                <Input
                  type="number"
                  min={0}
                  placeholder="Count"
                  value={line.entered ? String(line.countedQty) : ""}
                  disabled={!canPostCount(active.status)}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const countedQty = raw === "" ? 0 : Number(e.target.value);
                    setActive((current) =>
                      current
                        ? {
                            ...current,
                            lines: (current.lines ?? []).map((row) =>
                              row.id === line.id
                                ? { ...row, countedQty: Number.isFinite(countedQty) ? countedQty : 0, entered: raw !== "" }
                                : row,
                            ),
                          }
                        : current,
                    );
                  }}
                />
              </Field>
              <CatchWeightInput
                show={line.catchWeight}
                value={weights[line.id] ?? (line.weightGrams != null ? String(line.weightGrams) : "")}
                onChange={(value) => setWeights((current) => ({ ...current, [line.id]: value }))}
              />
              </div>
            ))
          )}
          {canPostCount(active.status) ? (
            <>
              {!ready && lines.length > 0 ? (
                <p className="text-sm text-muted-foreground">Enter every SKU (0 is a real count) before posting.</p>
              ) : null}
              <Button disabled={!ready} onClick={() => void post()}>
                {lines.length === 0 ? "Confirm empty" : "Post variances"}
              </Button>
            </>
          ) : (
            <p>Posted.</p>
          )}
        </Card>
      )}
    </FloorFrame>
  );
}
