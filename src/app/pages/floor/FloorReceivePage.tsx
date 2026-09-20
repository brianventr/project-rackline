import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type Purchase, type Receipt, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../../components/expiry-field";
import { canReceive, canReceivePurchase } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

export function FloorReceivePage() {
  const me = useSession();
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
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    setDone(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "receipt") {
          void api<Receipt>(`/api/receipts/${hit.receipt.id}`).then((receipt) => {
            openFloorRow(receipt, me.user.id, jobForRef(jobs, "receipt", receipt.id, "receive"), (next) => {
              setActiveReceipt(next);
              setActivePurchase(null);
              setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
            }, setError);
          });
          return;
        }
        if (hit.kind === "purchase") {
          void api<Purchase>(`/api/purchases/${hit.purchase.id}`).then((purchase) => {
            openFloorRow(purchase, me.user.id, jobForRef(jobs, "purchase", purchase.id, "receive"), (next) => {
              setActivePurchase(next);
              setActiveReceipt(null);
              setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
            }, setError);
          });
          return;
        }
        if (hit.kind === "location") {
          setLocationId(hit.location.id);
          return;
        }
        setError("Scan a receipt, purchase order, or a dock / bay barcode.");
      })
      .catch((err: Error) => setError(err.message));
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
      setError(err instanceof Error ? err.message : "Receive failed");
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
      setError(err instanceof Error ? err.message : "Receive failed");
    }
  }

  return (
    <FloorFrame title="Receive" description="Scan a receipt or purchase order, scan the dock, post it into the bay." error={error}>
      <FloorScanBox label="Scan receipt, PO, or bay" placeholder="PO-DEMO1, RCP-DEMO1, or RECV" onScan={onScan} />
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
      {!activeReceipt && !activePurchase ? (
        <div className="grid gap-4 md:grid-cols-2">
          <ClaimList
            title="Open receipts"
            empty="No blank receipts."
            rows={receipts}
            userId={me.user.id}
            jobFor={(row) => jobForRef(jobs, "receipt", row.id, "receive")}
            onOpen={(row) =>
              openFloorRow(row, me.user.id, jobForRef(jobs, "receipt", row.id, "receive"), (receipt) => {
                void api<Receipt>(`/api/receipts/${receipt.id}`).then((next) => {
                  setActiveReceipt(next);
                  setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
                });
              }, setError)
            }
            render={(row) => (
              <>
                <span className="font-mono">{row.number}</span> <StatusBadge status={row.status} />
              </>
            )}
          />
          <ClaimList
            title="Purchase orders"
            empty="No open purchases."
            rows={purchases}
            userId={me.user.id}
            jobFor={(row) => jobForRef(jobs, "purchase", row.id, "receive")}
            onOpen={(row) =>
              openFloorRow(row, me.user.id, jobForRef(jobs, "purchase", row.id, "receive"), (purchase) => {
                void api<Purchase>(`/api/purchases/${purchase.id}`).then((next) => {
                  setActivePurchase(next);
                  setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
                });
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
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{activePurchase.number}</h2>
              <p className="text-sm text-muted-foreground">{activePurchase.vendorName}</p>
            </div>
            <StatusBadge status={activePurchase.status} />
          </div>
          <ul className="space-y-3 text-sm">
            {(activePurchase.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="grid grid-cols-[1fr_6rem] items-center gap-2">
                <span>
                  {line.sku} · {line.qtyReceived}/{line.qtyOrdered}
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
          <Field label="Receive into">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          {canReceivePurchase(activePurchase.status) &&
          hasRemaining(
            (activePurchase.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qtyOrdered,
              qtyReceived: line.qtyReceived,
            })),
          ) ? (
            <Button onClick={() => void receivePurchase()}>Post receive</Button>
          ) : (
            <div className="space-y-2">
              <p>Fully received.</p>
              <Link
                className="block text-sm underline"
                to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}
              >
                Put away from this bay
              </Link>
            </div>
          )}
          <button className="text-sm underline" onClick={() => setActivePurchase(null)}>
            Back to list
          </button>
          <Link className="block text-sm underline" to="/inbound/purchases">
            Office purchases
          </Link>
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
                <span>
                  {line.sku} · {line.qtyReceived}/{line.qty}
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
          <Field label="Receive into">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          {canReceive(activeReceipt!.status) &&
          hasRemaining(
            (activeReceipt!.lines ?? []).map((line) => ({
              itemId: line.itemId,
              qtyExpected: line.qty,
              qtyReceived: line.qtyReceived,
            })),
          ) ? (
            <Button onClick={() => void receiveReceipt()}>Post receive</Button>
          ) : (
            <div className="space-y-2">
              <p>Fully received.</p>
              <Link
                className="block text-sm underline"
                to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}
              >
                Put away from this bay
              </Link>
            </div>
          )}
          <button className="text-sm underline" onClick={() => setActiveReceipt(null)}>
            Back to list
          </button>
          <Link className="block text-sm underline" to="/inbound/receipts">
            Office receipts
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
