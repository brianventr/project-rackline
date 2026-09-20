import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type ScanHit, type VendorReturn } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { canPostVendorReturn } from "@/domain/status";
import { hasUnreturned } from "@/domain/partial-rtv";

export function FloorRtvPage() {
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
    const wanted = params.get("id");
    if (wanted) {
      const match = await api<VendorReturn>(`/api/vendor-returns/${wanted}`);
      openRtv(match);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    setDone(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "vendorReturn") {
          void api<VendorReturn>(`/api/vendor-returns/${hit.vendorReturn.id}`).then(openRtv);
          return;
        }
        if (hit.kind === "location") {
          setLocationId(hit.location.id);
          return;
        }
        setError("Scan a vendor return or a bay barcode.");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

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
      setError(err instanceof Error ? err.message : "Return failed");
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
      <FloorScanBox label="Scan vendor return or bay" placeholder="RTV-DEMO1 or A-01-01" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open vendor returns</p>
          <ul className="space-y-2 text-sm">
            {returns.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => void api<VendorReturn>(`/api/vendor-returns/${row.id}`).then(openRtv)}>
                  <span className="font-mono">{row.number}</span> {row.vendorName} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {returns.length === 0 ? <li className="text-muted-foreground">Nothing to ship back.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{active.number}</h2>
              <p className="text-sm text-muted-foreground">{active.vendorName}</p>
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
                      type="number"
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
                    placeholder="Lot (FIFO if blank)"
                    value={lots[line.itemId] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial && line.remaining > 0 ? (
                  <Input
                    placeholder="Serials"
                    value={serials[line.itemId] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  show={line.catchWeight}
                  value={weights[line.itemId] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.itemId]: value }))}
                />
              </li>
            ))}
          </ul>
          <Field label="Ship from">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          {canPostVendorReturn(active.status) && remaining ? (
            <Button onClick={() => void postReturn()}>Return to vendor</Button>
          ) : (
            <p>Already returned.</p>
          )}
          <Link className="block text-sm underline" to="/inbound/vendor-returns">
            Office vendor returns
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
