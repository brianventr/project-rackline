import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Asn, type Location, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../../components/expiry-field";
import { canReceiveAsn, isOpenAsn } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";

function matchAsn(asns: Asn[], raw: string): Asn | undefined {
  const needle = raw.trim().toUpperCase().replace(/^ASN[:\-]/, "");
  return asns.find(
    (row) =>
      row.number.toUpperCase() === raw.trim().toUpperCase() ||
      row.number.toUpperCase() === needle ||
      row.number.toUpperCase().endsWith(needle) ||
      row.id === raw.trim(),
  );
}

export function FloorAsnPage() {
  const [params] = useSearchParams();
  const [asns, setAsns] = useState<Asn[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Asn | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [activePkgId, setActivePkgId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyAsn(asn: Asn, pkgId?: string | null) {
    setActive(asn);
    setActivePkgId(pkgId ?? null);
    setQtys(Object.fromEntries((asn.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  async function load() {
    const [nextAsns, nextLocations] = await Promise.all([
      api<Asn[]>("/api/asns"),
      api<Location[]>("/api/locations"),
    ]);
    setAsns(
      nextAsns.filter(
        (row) =>
          isOpenAsn(row.status) &&
          hasRemaining(
            (row.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qtyExpected,
              qtyReceived: line.qtyReceived,
            })),
          ),
      ),
    );
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(dock.id);
    const wanted = params.get("id");
    if (wanted) {
      const next = await api<Asn>(`/api/asns/${wanted}`);
      applyAsn(next, (next.packages ?? []).find((pkg) => !pkg.receivedAt)?.id ?? null);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback(
    (raw: string) => {
      setError(null);
      setDone(null);
      const match = matchAsn(asns, raw);
      if (match) {
        void api<Asn>(`/api/asns/${match.id}`).then((asn) => applyAsn(asn));
        return;
      }
      const onActive =
        active &&
        (active.packages ?? []).find((pkg) => {
          const needle = raw.trim().toUpperCase();
          return (
            pkg.number.toUpperCase() === needle ||
            pkg.number.toUpperCase() === `BOX-${needle}` ||
            Boolean(pkg.sscc && pkg.sscc.toUpperCase() === needle)
          );
        });
      if (onActive && active) {
        setActivePkgId(onActive.id);
        return;
      }
      void api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((hit) => {
          if (hit.kind === "asn") {
            applyAsn(hit.asn, hit.package?.id ?? null);
            return;
          }
          if (hit.kind === "location" && hit.location) {
            setLocationId(hit.location.id);
            return;
          }
          setError("Scan an ASN-, BOX- / SSCC, or a dock barcode.");
        })
        .catch((err: Error) => setError(err.message));
    },
    [asns, active],
  );

  async function receive() {
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
          expiresOn: parseExpiryInput(expiries[line.itemId]),
        }))
        .filter((line) => line.qty > 0);
      const posted = await api<Asn>(`/api/asns/${active.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      applyAsn(posted);
      setDone(`${posted.number} posted to the dock.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receive failed");
    }
  }

  async function receiveCarton() {
    if (!active || !activePkgId) return;
    setError(null);
    try {
      const posted = await api<Asn>(`/api/asns/${active.id}/packages/${activePkgId}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lots, serials }),
      });
      applyAsn(posted, (posted.packages ?? []).find((pkg) => !pkg.receivedAt)?.id ?? null);
      setDone(`${posted.number} carton posted to the dock.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Carton receive failed");
    }
  }

  return (
    <FloorFrame title="ASN" description="Scan an ASN- or BOX-/SSCC, scan the dock, receive remaining qty or one vendor carton." error={error}>
      <FloorScanBox label="Scan ASN, carton, or dock" placeholder="ASN-… BOX-1 or SSCC" onScan={onScan} />
      {done ? (
        <p className="text-sm text-emerald-700">
          {done}{" "}
          <Link
            className="font-medium underline"
            to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}
          >
            Put away
          </Link>
        </p>
      ) : null}
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open ASNs</p>
          <ul className="space-y-2 text-sm">
            {asns.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => void api<Asn>(`/api/asns/${row.id}`).then(applyAsn)}>
                  <span className="font-mono">{row.number}</span> {row.vendorName} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {asns.length === 0 ? <li className="text-muted-foreground">No open ASNs.</li> : null}
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
                    {line.sku} · {line.qtyReceived}/{line.qtyExpected}
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
                {line.trackLot ? (
                  <Input
                    placeholder="Lot code"
                    value={lots[line.itemId] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial ? (
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
                <ExpiryInput
                  show={line.trackExpiry}
                  value={expiries[line.itemId] ?? ""}
                  onChange={(value) => setExpiries((current) => ({ ...current, [line.itemId]: value }))}
                />
              </li>
            ))}
          </ul>
          {(active.packages ?? []).length > 0 ? (
            <ul className="space-y-2 text-sm">
              {(active.packages ?? []).map((pkg) => (
                <li key={pkg.id}>
                  <button
                    className={`w-full rounded-md border px-3 py-2 text-left ${activePkgId === pkg.id ? "border-primary" : ""}`}
                    onClick={() => setActivePkgId(pkg.id)}
                  >
                    <span className="font-mono">{pkg.number}</span>
                    {pkg.sscc ? <span className="text-muted-foreground"> · {pkg.sscc}</span> : null}
                    <span className="text-muted-foreground">
                      {" "}
                      · {(pkg.lines ?? []).map((line) => `${line.sku} × ${line.qty}`).join(", ")}
                      {pkg.receivedAt ? " · received" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <Field label="Receive into">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          {canReceiveAsn(active.status) &&
          hasRemaining(
            (active.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qtyExpected,
              qtyReceived: line.qtyReceived,
            })),
          ) ? (
            (active.packages ?? []).length > 0 ? (
              <Button
                disabled={!activePkgId || Boolean((active.packages ?? []).find((pkg) => pkg.id === activePkgId)?.receivedAt)}
                onClick={() => void receiveCarton()}
              >
                Receive carton
              </Button>
            ) : (
              <Button onClick={() => void receive()}>Post receive</Button>
            )
          ) : (
            <p>Fully received.</p>
          )}
          <button className="text-sm underline" onClick={() => setActive(null)}>
            Back to list
          </button>
          <Link className="block text-sm underline" to="/inbound/asns">
            Office ASNs
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
