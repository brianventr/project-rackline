import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Truck } from "lucide-react";
import { api, errorText, type Location, type Purchase, type Receipt, type ScanHit } from "../../api";
import { Button, Card, DoneBanner, Field, Input, StatusBadge } from "../../components/ui";
import { BayCombobox } from "../../components/BayCombobox";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow, type ScanReport } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { SkuThumb } from "../../components/sku-thumb";
import { ExpiryInput, parseExpiryInput } from "../../components/expiry-field";
import { canReceive, canReceivePurchase } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useSession } from "../../session";
import { useWarehouse } from "../../warehouse";
import { jobForRef, useOpenJobs } from "../../jobs";

const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
/** BayCombobox takes no className, so size its input like the other floor inputs (44px, 16px text on phones). */
const bayPicker = "[&_[role=combobox]]:h-11 [&_[role=combobox]]:text-base md:[&_[role=combobox]]:text-sm";

export function FloorReceivePage() {
  const me = useSession();
  const { warehouseId } = useWarehouse();
  const { jobs, reload: reloadJobs } = useOpenJobs("receive");
  const [params] = useSearchParams();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeReceipt, setActiveReceipt] = useState<Receipt | null>(null);
  const [activePurchase, setActivePurchase] = useState<Purchase | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const [nextReceipts, nextPurchases, nextLocations] = await Promise.all([
      api<Receipt[]>("/api/receipts"),
      api<Purchase[]>("/api/purchases"),
      api<Location[]>("/api/locations"),
    ]);
    setReceipts(
      nextReceipts.filter(
        (row) =>
          canReceive(row.status) &&
          hasRemaining(
            (row.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qty,
              qtyReceived: line.qtyReceived,
            })),
          ),
      ),
    );
    setPurchases(
      nextPurchases.filter(
        (row) =>
          canReceivePurchase(row.status) &&
          hasRemaining(
            (row.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qtyOrdered,
              qtyReceived: line.qtyReceived,
            })),
          ),
      ),
    );
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(dock.id);
    const nextJobs = await reloadJobs();
    const receiptId = params.get("id");
    const purchaseId = params.get("purchase");
    if (purchaseId) {
      const match = await api<Purchase>(`/api/purchases/${purchaseId}`);
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "purchase", match.id, "receive"), (purchase) => {
        setActivePurchase(purchase);
        setActiveReceipt(null);
        setQtys(Object.fromEntries((purchase.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
      }, setError);
    } else if (receiptId) {
      const match = await api<Receipt>(`/api/receipts/${receiptId}`);
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "receipt", match.id, "receive"), (receipt) => {
        setActiveReceipt(receipt);
        setActivePurchase(null);
        setQtys(Object.fromEntries((receipt.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
      }, setError);
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load open receipts and purchase orders.")))
      .finally(() => setLoaded(true));
  }, []);

  const onScan = useCallback((raw: string, report?: ScanReport) => {
    setError(null);
    setDone(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then(async (hit) => {
        if (hit.kind === "receipt") {
          const receipt = await api<Receipt>(`/api/receipts/${hit.receipt.id}`);
          report?.(
            openFloorRow(receipt, me.user.id, jobForRef(jobs, "receipt", receipt.id, "receive"), (next) => {
              setActiveReceipt(next);
              setActivePurchase(null);
              setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
            }, setError),
          );
          return;
        }
        if (hit.kind === "purchase") {
          const purchase = await api<Purchase>(`/api/purchases/${hit.purchase.id}`);
          report?.(
            openFloorRow(purchase, me.user.id, jobForRef(jobs, "purchase", purchase.id, "receive"), (next) => {
              setActivePurchase(next);
              setActiveReceipt(null);
              setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
            }, setError),
          );
          return;
        }
        if (hit.kind === "location") {
          setLocationId(hit.location.id);
          report?.(true);
          return;
        }
        setError("Scan a receipt, purchase order, or a dock / bay barcode.");
        report?.(false);
      })
      .catch((err) => {
        setError(errorText(err, "That barcode did not scan. Try again."));
        report?.(false);
      });
  }, [jobs, me.user.id]);

  async function receiveReceipt() {
    if (!activeReceipt) return;
    setError(null);
    try {
      const lines = (activeReceipt.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(qtys[line.itemId] || 0),
          lotCode: lots[line.itemId] || undefined,
          serials: serials[line.itemId] || undefined,
          weightGrams: parseWeightGrams(weights[line.itemId]),
          expiresOn: parseExpiryInput(expiries[line.itemId]),
        }))
        .filter((line) => line.qty > 0);
      const posted = await api<Receipt>(`/api/receipts/${activeReceipt.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      setActiveReceipt(posted);
      setQtys(Object.fromEntries((posted.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
      setDone(`${posted.number} posted to the dock.`);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not post the receive."));
    }
  }

  async function receivePurchase() {
    if (!activePurchase) return;
    setError(null);
    try {
      const lines = (activePurchase.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(qtys[line.itemId] || 0),
          lotCode: lots[line.itemId] || undefined,
          serials: serials[line.itemId] || undefined,
          weightGrams: parseWeightGrams(weights[line.itemId]),
          expiresOn: parseExpiryInput(expiries[line.itemId]),
        }))
        .filter((line) => line.qty > 0);
      const posted = await api<Purchase>(`/api/purchases/${activePurchase.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      setActivePurchase(posted);
      setQtys(Object.fromEntries((posted.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
      setDone(`${posted.number} posted to the dock.`);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not post the receive."));
    }
  }

  return (
    <FloorFrame title="Receive" description="Scan a receipt or purchase order, scan the dock, post it into the bay." error={error}>
      <FloorScanBox label="Scan receipt, PO, or bay" placeholder="PO-DEMO1, RCP-DEMO1, or RECV" onScan={onScan} />
      <DoneBanner>
        {done ? (
          <>
            {done}{" "}
            <Link
              className="font-medium underline"
              to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}
            >
              Put away
            </Link>
          </>
        ) : null}
      </DoneBanner>
      {!activeReceipt && !activePurchase ? (
        <div className="grid gap-4 md:grid-cols-2">
          <ClaimList
            loading={!loaded}
            title="Open receipts"
            empty="No open receipts."
            emptyBody="Receipts the office expects show here until every line is on the dock."
            emptyIcon={Truck}
            emptyAction={
              <Button variant="secondary" className="h-11" asChild>
                <Link to="/inbound/receipts">Office receipts</Link>
              </Button>
            }
            rows={receipts}
            userId={me.user.id}
            jobFor={(row) => jobForRef(jobs, "receipt", row.id, "receive")}
            onOpen={(row) =>
              openFloorRow(row, me.user.id, jobForRef(jobs, "receipt", row.id, "receive"), (receipt) => {
                api<Receipt>(`/api/receipts/${receipt.id}`)
                  .then((next) => {
                    setActiveReceipt(next);
                    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
                  })
                  .catch((err) => setError(errorText(err, "Could not open that receipt.")));
              }, setError)
            }
            render={(row) => (
              <>
                <span className="font-mono">{row.number}</span> <StatusBadge status={row.status} />
              </>
            )}
          />
          <ClaimList
            loading={!loaded}
            title="Purchase orders"
            empty="No open purchase orders."
            emptyBody="Purchase orders sent to a vendor show here until every line is received."
            emptyIcon={Truck}
            emptyAction={
              <Button variant="secondary" className="h-11" asChild>
                <Link to="/inbound/purchases">Office purchases</Link>
              </Button>
            }
            rows={purchases}
            userId={me.user.id}
            jobFor={(row) => jobForRef(jobs, "purchase", row.id, "receive")}
            onOpen={(row) =>
              openFloorRow(row, me.user.id, jobForRef(jobs, "purchase", row.id, "receive"), (purchase) => {
                api<Purchase>(`/api/purchases/${purchase.id}`)
                  .then((next) => {
                    setActivePurchase(next);
                    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
                  })
                  .catch((err) => setError(errorText(err, "Could not open that purchase order.")));
              }, setError)
            }
            render={(row) => (
              <>
                <span className="font-mono">{row.number}</span> {row.vendorName} <StatusBadge status={row.status} />
              </>
            )}
          />
        </div>
      ) : activePurchase ? (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">{activePurchase.number}</h2>
              <p className="text-sm text-muted-foreground">{activePurchase.vendorName}</p>
            </div>
            <StatusBadge status={activePurchase.status} />
          </div>
          <ul className="space-y-3 text-sm">
            {(activePurchase.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
                <span className="flex items-center gap-2">
                  <SkuThumb sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} size="sm" />
                  <span>
                  {line.sku} · {line.qtyReceived}/{line.qtyOrdered}
                  </span>
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
          <div className={bayPicker}>
            <Field label="Receive into">
              <BayCombobox
                locations={locations}
                warehouseId={activePurchase.warehouseId || warehouseId}
                value={locationId}
                onChange={setLocationId}
                onCreated={(location) => setLocations((current) => [...current, location])}
              />
            </Field>
          </div>
          {canReceivePurchase(activePurchase.status) &&
          hasRemaining(
            (activePurchase.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qtyOrdered,
              qtyReceived: line.qtyReceived,
            })),
          ) ? (
            <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void receivePurchase()}>
              Post receive
            </Button>
          ) : (
            <div className="space-y-2">
              <p>Fully received.</p>
              <Button className="h-14 w-full text-lg sm:w-auto" asChild>
                <Link to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}>
                  Put away from this bay
                </Link>
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-x-5">
            <button type="button" className={textLink} onClick={() => setActivePurchase(null)}>
              Back to list
            </button>
            <Link className={textLink} to="/inbound/purchases">
              Office purchases
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{activeReceipt!.number}</h2>
            <StatusBadge status={activeReceipt!.status} />
          </div>
          <ul className="space-y-3 text-sm">
            {(activeReceipt!.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
                <span className="flex items-center gap-2">
                  <SkuThumb sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} size="sm" />
                  <span>
                  {line.sku} · {line.qtyReceived}/{line.qty}
                  </span>
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
          <div className={bayPicker}>
            <Field label="Receive into">
              <BayCombobox
                locations={locations}
                warehouseId={activeReceipt!.warehouseId || warehouseId}
                value={locationId}
                onChange={setLocationId}
                onCreated={(location) => setLocations((current) => [...current, location])}
              />
            </Field>
          </div>
          {canReceive(activeReceipt!.status) &&
          hasRemaining(
            (activeReceipt!.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qty,
              qtyReceived: line.qtyReceived,
            })),
          ) ? (
            <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void receiveReceipt()}>
              Post receive
            </Button>
          ) : (
            <div className="space-y-2">
              <p>Fully received.</p>
              <Button className="h-14 w-full text-lg sm:w-auto" asChild>
                <Link to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}>
                  Put away from this bay
                </Link>
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-x-5">
            <button type="button" className={textLink} onClick={() => setActiveReceipt(null)}>
              Back to list
            </button>
            <Link className={textLink} to="/inbound/receipts">
              Office receipts
            </Link>
          </div>
        </Card>
      )}
    </FloorFrame>
  );
}
