import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Warehouse } from "lucide-react";
import { api, errorText, type Location, type YardVisit } from "../../api";
import { Button, Card, DoneBanner, EmptyState, Field, Select, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { FloorFrame, FloorScanBox, type ScanReport } from "./floor-ui";
import { canAssignDock, canCheckInYard, canCheckOutYard, isOpenYard } from "@/domain/status";
import { canReceiveLinkedAsn } from "@/domain/yard";

/** One 56px action per step: check in, then assign a dock, then check out. */
const mainAction = "h-14 w-full text-lg sm:w-auto";
const secondaryAction = "h-11 w-full sm:w-auto";
const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

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
  const [loaded, setLoaded] = useState(false);
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
    setLoaded(true);
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
    load().catch((err) => setError(errorText(err, "Could not load open yard visits.")));
  }, []);

  function openVisit(visit: YardVisit) {
    setActive(visit);
    if (visit.dockLocationId) setDockLocationId(visit.dockLocationId);
  }

  const onScan = useCallback(
    (raw: string, report?: ScanReport) => {
      setError(null);
      setDone(null);
      const match = matchVisit(visits, raw);
      if (match) {
        api<YardVisit>(`/api/yard/${match.id}`)
          .then((visit) => {
            openVisit(visit);
            report?.(true);
          })
          .catch((err) => {
            setError(errorText(err, "Could not open that yard visit."));
            report?.(false);
          });
        return;
      }
      void api<{ kind: string; location?: Location }>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((hit) => {
          if (hit.kind === "location" && hit.location) {
            setDockLocationId(hit.location.id);
            report?.(true);
            return;
          }
          setError("Scan a YRD- visit or a dock barcode.");
          report?.(false);
        })
        .catch((err) => {
          setError(errorText(err, "That barcode did not scan. Try again."));
          report?.(false);
        });
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
      setError(errorText(err, "Could not check in the trailer."));
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
      setError(errorText(err, "Could not assign the dock."));
    }
  }

  async function receiveAsn() {
    if (!active) return;
    setError(null);
    try {
      await api(`/api/yard/${active.id}/receive-asn`, { method: "POST" });
      setDone(`${active.number}: ASN received at dock.`);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not receive the ASN."));
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
      setError(errorText(err, "Could not check out the trailer."));
    }
  }

  return (
    <FloorFrame title="Yard" description="Scan a YRD- visit to check in, assign a dock, or check out." error={error}>
      <FloorScanBox label="Scan visit or dock" placeholder="YRD-… or RECV" onScan={onScan} />
      <DoneBanner>{done}</DoneBanner>
      {!active ? (
        <Card className="space-y-4">
          <p className="font-medium">Open visits</p>
          {!loaded ? null : visits.length === 0 ? (
            <EmptyState
              icon={Warehouse}
              title="No open yard visits."
              body={
                <>
                  Trailers booked as a <Term id="yard-visit">yard visit</Term> show here until they check out.
                </>
              }
              action={
                <Button variant="secondary" className="h-11" asChild>
                  <Link to="/inbound/yard">Office yard</Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {visits.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="-mx-2 block min-h-11 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() =>
                      api<YardVisit>(`/api/yard/${row.id}`)
                        .then(openVisit)
                        .catch((err) => setError(errorText(err, "Could not open that yard visit.")))
                    }
                  >
                    <span className="font-mono">{row.number}</span> {row.carrierName} <StatusBadge status={row.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">{active.number}</h2>
              <p className="text-sm text-muted-foreground">
                {active.carrierName}
                {active.trailerNumber ? ` · ${active.trailerNumber}` : ""}
              </p>
            </div>
            <StatusBadge status={active.status} />
          </div>
          {canCheckInYard(active.status) ? (
            <Button className={mainAction} onClick={() => void checkIn()}>
              Check in
            </Button>
          ) : null}
          {canAssignDock(active.status) ? (
            <>
              <Field label="Dock">
                <Select className="h-11" value={dockLocationId} onChange={(e) => setDockLocationId(e.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant={active.status === "checked_in" ? "primary" : "secondary"}
                className={active.status === "checked_in" ? mainAction : secondaryAction}
                onClick={() => void assignDock()}
              >
                Assign dock
              </Button>
            </>
          ) : null}
          {canReceiveLinkedAsn(active) ? (
            <Button variant="secondary" className={secondaryAction} onClick={() => void receiveAsn()}>
              Receive ASN
            </Button>
          ) : null}
          {canCheckOutYard(active.status) ? (
            <Button
              variant={active.status === "at_dock" ? "primary" : "secondary"}
              className={active.status === "at_dock" ? mainAction : secondaryAction}
              onClick={() => void checkOut()}
            >
              Check out
            </Button>
          ) : null}
          {active.status === "checked_out" ? <p>Checked out.</p> : null}
          <div className="flex flex-wrap gap-x-5">
            <button type="button" className={textLink} onClick={() => setActive(null)}>
              Back to list
            </button>
            <Link className={textLink} to="/inbound/yard">
              Office yard
            </Link>
          </div>
        </Card>
      )}
    </FloorFrame>
  );
}
