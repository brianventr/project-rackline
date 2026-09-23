import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpFromLine } from "lucide-react";
import { api, errorText, type Location, type ScanHit, type VendorReturn } from "../../api";
import { Button, Card, DoneBanner, Field, Input, Select, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { FloorFrame, FloorScanBox, ClaimList, openFloorRow, type ScanReport } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { canPostVendorReturn } from "@/domain/status";
import { hasUnreturned } from "@/domain/partial-rtv";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FloorRtvPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("rtv");
  const [params] = useSearchParams();
  const [returns, setReturns] = useState<VendorReturn[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<VendorReturn | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function openRtv(rtv: VendorReturn) {
    setActive(rtv);
    setQtys(Object.fromEntries((rtv.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    if (rtv.locationId) setLocationId(rtv.locationId);
  }

  async function load() {
    const [nextReturns, nextLocations] = await Promise.all([
      api<VendorReturn[]>("/api/vendor-returns"),
      api<Location[]>("/api/locations"),
    ]);
    setReturns(
      nextReturns.filter(
        (row) =>
          canPostVendorReturn(row.status) &&
          hasUnreturned(
            (row.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qtyExpected,
              qtyReturned: line.qtyReturned,
            })),
          ),
      ),
    );
    setLocations(nextLocations);
    const from =
      nextLocations.find((row) => row.code === "A-01-01") ??
      nextLocations.find((row) => row.type === "storage") ??
      nextLocations[0];
    if (from && !locationId) setLocationId(from.id);
    // Jobs load before the screen counts as loaded, so a waiting scan sees who has claimed what.
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      const match = await api<VendorReturn>(`/api/vendor-returns/${wanted}`);
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "vendorReturn", match.id, "rtv"), openRtv, setError);
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load open vendor returns.")))
      .finally(() => setLoaded(true));
  }, []);

  const onScan = useCallback((raw: string, report?: ScanReport) => {
    setError(null);
    setDone(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then(async (hit) => {
        if (hit.kind === "vendorReturn") {
          const rtv = await api<VendorReturn>(`/api/vendor-returns/${hit.vendorReturn.id}`);
          report?.(openFloorRow(rtv, me.user.id, jobForRef(jobs, "vendorReturn", rtv.id, "rtv"), openRtv, setError));
          return;
        }
        if (hit.kind === "location") {
          setLocationId(hit.location.id);
          report?.(true);
          return;
        }
        setError("Scan a vendor return or a bay barcode.");
        report?.(false);
      })
      .catch((err) => {
        setError(errorText(err, "That barcode did not scan. Try again."));
        report?.(false);
      });
  }, [jobs, me.user.id]);

  async function postReturn() {
    if (!active) return;
    setError(null);
    try {
      const lines = (active.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(qtys[line.itemId] || 0),
          lotCode: lots[line.itemId] || undefined,
          serials: serials[line.itemId] || undefined,
          weightGrams: parseWeightGrams(weights[line.itemId]),
        }))
        .filter((line) => line.qty > 0);
      const posted = await api<VendorReturn>(`/api/vendor-returns/${active.id}/return`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      openRtv(posted);
      setDone(`${posted.number} returned ${lines.reduce((sum, line) => sum + line.qty, 0)}.`);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not post the vendor return."));
    }
  }

  const remaining =
    active &&
    hasUnreturned(
      (active.lines ?? []).map((line) => ({
        itemId: line.itemId,
        qtyExpected: line.qtyExpected,
        qtyReturned: line.qtyReturned,
      })),
    );

  return (
    <FloorFrame title="Vendor return" description="Scan an RTV, scan the bay, ship remaining qty back to the vendor." error={error}>
      <FloorScanBox label="Scan vendor return or bay" placeholder="RTV-DEMO1 or A-01-01" onScan={onScan} ready={loaded} />
      <DoneBanner>{done}</DoneBanner>
      {!active ? (
        <ClaimList
          loading={!loaded}
          title="Open vendor returns"
          empty="Nothing to ship back."
          emptyBody="Vendor returns booked in the office show here until every line has left its bay."
          emptyIcon={ArrowUpFromLine}
          emptyAction={
            <Button variant="secondary" className="h-11" asChild>
              <Link to="/inbound/vendor-returns">Office vendor returns</Link>
            </Button>
          }
          rows={returns}
          userId={me.user.id}
          jobFor={(row) => jobForRef(jobs, "vendorReturn", row.id, "rtv")}
          onOpen={(row) =>
            openFloorRow(row, me.user.id, jobForRef(jobs, "vendorReturn", row.id, "rtv"), (rtv) => {
              api<VendorReturn>(`/api/vendor-returns/${rtv.id}`)
                .then(openRtv)
                .catch((err) => setError(errorText(err, "Could not open that vendor return.")));
            }, setError)
          }
          render={(row) => (
            <>
              <span className="font-mono">{row.number}</span> {row.vendorName} <StatusBadge status={row.status} />
            </>
          )}
        />
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">{active.number}</h2>
              <p className="text-sm text-muted-foreground">
                <Term id="rtv">RTV</Term> to {active.vendorName}
              </p>
            </div>
            <StatusBadge status={active.status} />
          </div>
          <ul className="space-y-3 text-sm">
            {(active.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
                  <span>
                    {line.sku} · {line.qtyReturned}/{line.qtyExpected}
                    <span className="text-muted-foreground"> remaining {line.remaining}</span>
                  </span>
                  {line.remaining > 0 ? (
                    <Input
                      className="h-11 text-base"
                      type="number"
                      aria-label={`${line.sku} qty to return`}
                      min={0}
                      max={line.remaining}
                      value={qtys[line.itemId] ?? "0"}
                      onChange={(e) => setQtys((current) => ({ ...current, [line.itemId]: e.target.value }))}
                    />
                  ) : (
                    <span className="text-muted-foreground">Done</span>
                  )}
                </div>
                {line.trackLot && line.remaining > 0 ? (
                  <Input
                    className="h-11 text-base"
                    aria-label={`${line.sku} lot code`}
                    placeholder="Lot (FIFO if blank)"
                    value={lots[line.itemId] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial && line.remaining > 0 ? (
                  <Input
                    className="h-11 text-base"
                    aria-label={`${line.sku} serials`}
                    placeholder="Serials"
                    value={serials[line.itemId] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  className="h-11 text-base"
                  show={line.catchWeight}
                  value={weights[line.itemId] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.itemId]: value }))}
                />
              </li>
            ))}
          </ul>
          <Field label="Ship from">
            <Select className="h-11" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          {canPostVendorReturn(active.status) && remaining ? (
            <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void postReturn()}>
              Return to vendor
            </Button>
          ) : (
            <p>Already returned.</p>
          )}
          <Link className={textLink} to="/inbound/vendor-returns">
            Office vendor returns
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
