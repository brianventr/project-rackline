import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type YardVisit } from "../../api";
import { Button, Card, Field, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canAssignDock, canCheckInYard, canCheckOutYard, isOpenYard } from "@/domain/status";

function matchVisit(visits: YardVisit[], raw: string): YardVisit | undefined {
  const needle = raw.trim().toUpperCase().replace(/^YRD[:\-]/, "");
  return visits.find(
    (row) =>
      row.number.toUpperCase() === raw.trim().toUpperCase() ||
      row.number.toUpperCase() === needle ||
      row.number.toUpperCase().endsWith(needle) ||
      row.id === raw.trim(),
  );
}

export function FloorYardPage() {
  const [params] = useSearchParams();
  const [visits, setVisits] = useState<YardVisit[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<YardVisit | null>(null);
  const [dockLocationId, setDockLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const [nextVisits, nextLocations] = await Promise.all([
      api<YardVisit[]>("/api/yard"),
      api<Location[]>("/api/locations"),
    ]);
    setVisits(nextVisits.filter((row) => isOpenYard(row.status)));
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setDockLocationId(dock.id);
    const wanted = params.get("id");
    if (wanted) {
      const visit = await api<YardVisit>(`/api/yard/${wanted}`);
      setActive(visit);
      if (visit.dockLocationId) setDockLocationId(visit.dockLocationId);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback(
    (raw: string) => {
      setError(null);
      setDone(null);
      const match = matchVisit(visits, raw);
      if (match) {
        void api<YardVisit>(`/api/yard/${match.id}`).then((visit) => {
          setActive(visit);
          if (visit.dockLocationId) setDockLocationId(visit.dockLocationId);
        });
        return;
      }
      void api<{ kind: string; location?: Location }>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((hit) => {
          if (hit.kind === "location" && hit.location) {
            setDockLocationId(hit.location.id);
            return;
          }
          setError("Scan a YRD- visit or a dock barcode.");
        })
        .catch((err: Error) => setError(err.message));
    },
    [visits],
  );

  async function checkIn() {
    if (!active) return;
    setError(null);
    try {
      const next = await api<YardVisit>(`/api/yard/${active.id}/check-in`, { method: "POST" });
      setActive(next);
      setDone(`${next.number} checked in.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-in failed");
    }
  }

  async function assignDock() {
    if (!active) return;
    setError(null);
    try {
      const next = await api<YardVisit>(`/api/yard/${active.id}/dock`, {
        method: "POST",
        body: JSON.stringify({ dockLocationId }),
      });
      setActive(next);
      setDone(`${next.number} at dock.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dock assign failed");
    }
  }

  async function checkOut() {
    if (!active) return;
    setError(null);
    try {
      const next = await api<YardVisit>(`/api/yard/${active.id}/check-out`, { method: "POST" });
      setActive(next);
      setDone(`${next.number} checked out.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-out failed");
    }
  }

  return (
    <FloorFrame title="Yard" description="Scan a YRD- visit to check in, assign a dock, or check out." error={error}>
      <FloorScanBox label="Scan visit or dock" placeholder="YRD-… or RECV" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open visits</p>
          <ul className="space-y-2 text-sm">
            {visits.map((row) => (
              <li key={row.id}>
                <button
                  className="w-full text-left"
                  onClick={() =>
                    void api<YardVisit>(`/api/yard/${row.id}`).then((visit) => {
                      setActive(visit);
                      if (visit.dockLocationId) setDockLocationId(visit.dockLocationId);
                    })
                  }
                >
                  <span className="font-mono">{row.number}</span> {row.carrierName} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {visits.length === 0 ? <li className="text-muted-foreground">No open yard visits.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{active.number}</h2>
              <p className="text-sm text-muted-foreground">
                {active.carrierName}
                {active.trailerNumber ? ` · ${active.trailerNumber}` : ""}
              </p>
            </div>
            <StatusBadge status={active.status} />
          </div>
          {canCheckInYard(active.status) ? <Button onClick={() => void checkIn()}>Check in</Button> : null}
          {canAssignDock(active.status) ? (
            <>
              <Field label="Dock">
                <Select value={dockLocationId} onChange={(e) => setDockLocationId(e.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button onClick={() => void assignDock()}>Assign dock</Button>
            </>
          ) : null}
          {canCheckOutYard(active.status) ? <Button onClick={() => void checkOut()}>Check out</Button> : null}
          {active.status === "checked_out" ? <p>Checked out.</p> : null}
          <button className="text-sm underline" onClick={() => setActive(null)}>
            Back to list
          </button>
          <Link className="block text-sm underline" to="/inbound/yard">
            Office yard
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
