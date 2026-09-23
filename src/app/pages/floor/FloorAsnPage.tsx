import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Package } from "lucide-react";
import { api, errorText, type Asn, type Location, type ScanHit } from "../../api";
import { Button, Card, DoneBanner, EmptyState, Field, Input, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { BayCombobox } from "../../components/BayCombobox";
import { FloorFrame, FloorScanBox, type ScanReport } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../../components/expiry-field";
import { canReceiveAsn, isOpenAsn } from "@/domain/status";
import { useWarehouse } from "../../warehouse";
import { hasRemaining } from "@/domain/partial-receive";
import { useSession } from "../../session";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";

const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
/** BayCombobox takes no className, so size its input to 44px from here. */
const bayPicker = "[&_[role=combobox]]:h-11 [&_[role=combobox]]:text-base";

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
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  // Same test the floor launcher uses to show the Receive tile.
  const canReceivePo =
    (me.role === "owner" || (me.floorVerbs ?? []).includes("receive")) &&
    (!garage || garageAllowsPath("/floor/receive"));
  const { warehouseId } = useWarehouse();
  const [params] = useSearchParams();
  const [asns, setAsns] = useState<Asn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Asn | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [activePkgId, setActivePkgId] = useState<string | null>(null);
  const [putawayCarton, setPutawayCarton] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyAsn(asn: Asn, pkgId?: string | null) {
    setActive(asn);
    setActivePkgId(pkgId ?? null);
    setQtys(Object.fromEntries((asn.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    const pkg = (asn.packages ?? []).find((row) => row.id === pkgId);
    const nextLots: Record<string, string> = {};
    const nextSerials: Record<string, string> = {};
    const nextWeights: Record<string, string> = {};
    const nextExpiries: Record<string, string> = {};
    for (const line of pkg?.lines ?? []) {
      if (line.lotCode) nextLots[line.itemId] = line.lotCode;
      if (line.serials?.length) nextSerials[line.itemId] = line.serials.join(", ");
      if (line.weightGrams != null) nextWeights[line.itemId] = String(line.weightGrams);
      if (line.expiresOn != null) {
        const raw = String(line.expiresOn);
        nextExpiries[line.itemId] = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
      }
    }
    setLots(nextLots);
    setSerials(nextSerials);
    setWeights(nextWeights);
    setExpiries(nextExpiries);
  }

  async function load() {
    const [nextAsns, nextLocations] = await Promise.all([
      api<Asn[]>("/api/asns"),
      api<Location[]>("/api/locations"),
    ]);
    setAsns(
      nextAsns.filter(
        (row) =>
          (isOpenAsn(row.status) &&
            hasRemaining(
              (row.lines ?? []).map((line) => ({
                itemId: line.itemId,
                qtyExpected: line.qtyExpected,
                qtyReceived: line.qtyReceived,
              })),
            )) ||
          (row.packages ?? []).some((pkg) => pkg.receivedAt && !pkg.putawayAt),
      ),
    );
    setLoaded(true);
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
    load().catch((err) => setError(errorText(err, "Could not load open ASNs.")));
  }, []);

  function openAsn(id: string) {
    api<Asn>(`/api/asns/${id}`)
      .then((asn) => applyAsn(asn))
      .catch((err) => setError(errorText(err, "Could not open that ASN.")));
  }

  const onScan = useCallback(
    (raw: string, report?: ScanReport) => {
      setError(null);
      setDone(null);
      const match = matchAsn(asns, raw);
      if (match) {
        api<Asn>(`/api/asns/${match.id}`)
          .then((asn) => {
            applyAsn(asn);
            report?.(true);
          })
          .catch((err) => {
            setError(errorText(err, "Could not open that ASN."));
            report?.(false);
          });
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
        applyAsn(active, onActive.id);
        report?.(true);
        return;
      }
      void api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((hit) => {
          if (hit.kind === "asn") {
            applyAsn(hit.asn, hit.package?.id ?? null);
            report?.(true);
            return;
          }
          if (hit.kind === "location" && hit.location) {
            setLocationId(hit.location.id);
            report?.(true);
            return;
          }
          setError("Scan an ASN-, BOX- / SSCC, or a dock barcode.");
          report?.(false);
        })
        .catch((err) => {
          setError(errorText(err, "That barcode did not scan. Try again."));
          report?.(false);
        });
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
      setPutawayCarton(null);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not post the receive."));
    }
  }

  async function receiveCarton() {
    if (!active || !activePkgId) return;
    setError(null);
    try {
      const carton = (active.packages ?? []).find((pkg) => pkg.id === activePkgId);
      const posted = await api<Asn>(`/api/asns/${active.id}/packages/${activePkgId}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lots, serials }),
      });
      applyAsn(posted, (posted.packages ?? []).find((pkg) => !pkg.receivedAt)?.id ?? null);
      setPutawayCarton(carton?.sscc || carton?.number || null);
      setDone(`${posted.number} carton posted to the dock.`);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not receive the carton."));
    }
  }

  async function unreceiveCarton() {
    if (!active || !activePkgId) return;
    setError(null);
    try {
      const carton = (active.packages ?? []).find((pkg) => pkg.id === activePkgId);
      const posted = await api<Asn>(`/api/asns/${active.id}/packages/${activePkgId}/unreceive`, { method: "POST" });
      applyAsn(posted, carton?.id ?? null);
      setPutawayCarton(null);
      setDone(`${posted.number} carton unreceived from the dock.`);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not unreceive the carton."));
    }
  }

  return (
    <FloorFrame title="ASN" description="Scan an ASN- or BOX-/SSCC, scan the dock, receive remaining qty or one vendor carton. Unreceive a dock carton that is not put away." error={error}>
      <FloorScanBox label="Scan ASN, carton, or dock" placeholder="ASN-… BOX-1 or SSCC" onScan={onScan} />
      <DoneBanner>
        {done ? (
          <>
            {done}{" "}
            <Link
              className="font-medium underline"
              to={
                putawayCarton
                  ? `/floor/putaway?carton=${encodeURIComponent(putawayCarton)}`
                  : `/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`
              }
            >
              Put away
            </Link>
          </>
        ) : null}
      </DoneBanner>
      {!active ? (
        <Card className="space-y-4">
          <p className="font-medium">Open ASNs</p>
          {!loaded ? null : asns.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No open ASNs."
              body={
                <>
                  <Term id="asn">ASNs</Term> from vendors wait here until every box is on the dock.
                </>
              }
              action={
                canReceivePo ? (
                  <Button variant="secondary" className="h-11" asChild>
                    <Link to="/floor/receive">Receive a PO instead</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {asns.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="-mx-2 block min-h-11 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() => openAsn(row.id)}
                  >
                    <span className="font-mono">{row.number}</span> {row.vendorName} <StatusBadge status={row.status} />
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
                      className="h-11 text-base"
                      type="number"
                      aria-label={`${line.sku} qty to receive`}
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
                    className="h-11 text-base"
                    aria-label={`${line.sku} lot code`}
                    placeholder="Lot code"
                    value={lots[line.itemId] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial ? (
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
                <ExpiryInput
                  className="h-11 text-base"
                  show={line.trackExpiry}
                  value={expiries[line.itemId] ?? ""}
                  onChange={(value) => setExpiries((current) => ({ ...current, [line.itemId]: value }))}
                />
              </li>
            ))}
          </ul>
          {(active.packages ?? []).length > 0 ? (
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium">Vendor cartons</p>
                <p className="text-sm text-muted-foreground">
                  Tap a <Term id="sscc">vendor carton</Term> or scan its BOX- or SSCC barcode.
                </p>
              </div>
              <ul className="space-y-2 text-sm">
                {(active.packages ?? []).map((pkg) => (
                  <li key={pkg.id}>
                    <button
                      type="button"
                      aria-pressed={activePkgId === pkg.id}
                      className={`min-h-11 w-full rounded-md border px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${activePkgId === pkg.id ? "border-primary" : ""}`}
                      onClick={() => {
                        setActivePkgId(pkg.id);
                        applyAsn(active, pkg.id);
                      }}
                    >
                      <span className="font-mono">{pkg.number}</span>
                      {pkg.sscc ? <span className="text-muted-foreground"> · {pkg.sscc}</span> : null}
                      <span className="text-muted-foreground">
                        {" "}
                        · {(pkg.lines ?? []).map((line) => `${line.sku} × ${line.qty}${line.lotCode ? ` ${line.lotCode}` : ""}`).join(", ")}
                        {pkg.receivedAt && !pkg.putawayAt ? " · received" : ""}
                        {pkg.putawayAt ? " · put away" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className={bayPicker}>
            <Field label="Receive into">
              <BayCombobox
                locations={locations}
                warehouseId={active.warehouseId || warehouseId}
                value={locationId}
                onChange={setLocationId}
                onCreated={(location) => setLocations((current) => [...current, location])}
              />
            </Field>
          </div>
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
                className="h-14 w-full text-lg sm:w-auto"
                disabled={!activePkgId || Boolean((active.packages ?? []).find((pkg) => pkg.id === activePkgId)?.receivedAt)}
                onClick={() => void receiveCarton()}
              >
                Receive carton
              </Button>
            ) : (
              <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void receive()}>
                Post receive
              </Button>
            )
          ) : (active.packages ?? []).some((pkg) => pkg.receivedAt && !pkg.putawayAt) ? (
            <p className="text-sm text-muted-foreground">Fully received. Unreceive a carton that is still on the dock to reopen lines.</p>
          ) : (
            <p>Fully received.</p>
          )}
          {(active.packages ?? []).find((pkg) => pkg.id === activePkgId)?.receivedAt &&
          !(active.packages ?? []).find((pkg) => pkg.id === activePkgId)?.putawayAt ? (
            <Button variant="secondary" className="h-11 w-full sm:w-auto" onClick={() => void unreceiveCarton()}>
              Unreceive carton
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-x-5">
            <button type="button" className={textLink} onClick={() => setActive(null)}>
              Back to list
            </button>
            <Link className={textLink} to="/inbound/asns">
              Office ASNs
            </Link>
          </div>
        </Card>
      )}
    </FloorFrame>
  );
}
