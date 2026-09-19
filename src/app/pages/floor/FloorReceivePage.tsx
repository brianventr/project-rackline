import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type Purchase, type Receipt, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canReceive, canReceivePurchase } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";

export function FloorReceivePage() {
  const [params] = useSearchParams();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeReceipt, setActiveReceipt] = useState<Receipt | null>(null);
  const [activePurchase, setActivePurchase] = useState<Purchase | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const [nextReceipts, nextPurchases, nextLocations] = await Promise.all([
      api<Receipt[]>("/api/receipts"),
      api<Purchase[]>("/api/purchases"),
      api<Location[]>("/api/locations"),
    ]);
    setReceipts(nextReceipts.filter((row) => canReceive(row.status)));
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
    const receiptId = params.get("id");
    const purchaseId = params.get("purchase");
    if (purchaseId) {
      const match =
        nextPurchases.find((row) => row.id === purchaseId) ?? (await api<Purchase>(`/api/purchases/${purchaseId}`));
      setActivePurchase(match);
      setActiveReceipt(null);
      setQtys(Object.fromEntries((match.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    } else if (receiptId) {
      const match = nextReceipts.find((row) => row.id === receiptId) ?? (await api<Receipt>(`/api/receipts/${receiptId}`));
      setActiveReceipt(match);
      setActivePurchase(null);
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
            setActiveReceipt(receipt);
            setActivePurchase(null);
          });
          return;
        }
        if (hit.kind === "purchase") {
          void api<Purchase>(`/api/purchases/${hit.purchase.id}`).then((purchase) => {
            setActivePurchase(purchase);
            setActiveReceipt(null);
            setQtys(Object.fromEntries((purchase.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
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
  }, []);

  async function receiveReceipt() {
    if (!activeReceipt) return;
    setError(null);
    try {
      if (activeReceipt.status === "draft") {
        await api(`/api/receipts/${activeReceipt.id}/start`, { method: "POST" });
      }
      const posted = await api<Receipt>(`/api/receipts/${activeReceipt.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId }),
      });
      setActiveReceipt(posted);
      setDone(`${posted.number} received.`);
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
        .map((line) => ({ itemId: line.itemId, qty: Number(qtys[line.itemId] || 0) }))
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
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!activeReceipt && !activePurchase ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <p className="mb-3 font-medium">Open receipts</p>
            <ul className="space-y-2 text-sm">
              {receipts.map((row) => (
                <li key={row.id}>
                  <button className="w-full text-left" onClick={() => void api<Receipt>(`/api/receipts/${row.id}`).then(setActiveReceipt)}>
                    <span className="font-mono">{row.number}</span> <StatusBadge status={row.status} />
                  </button>
                </li>
              ))}
              {receipts.length === 0 ? <li className="text-muted-foreground">No blank receipts.</li> : null}
            </ul>
          </Card>
          <Card>
            <p className="mb-3 font-medium">Purchase orders</p>
            <ul className="space-y-2 text-sm">
              {purchases.map((row) => (
                <li key={row.id}>
                  <button
                    className="w-full text-left"
                    onClick={() =>
                      void api<Purchase>(`/api/purchases/${row.id}`).then((purchase) => {
                        setActivePurchase(purchase);
                        setQtys(Object.fromEntries((purchase.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
                      })
                    }
                  >
                    <span className="font-mono">{row.number}</span> {row.vendorName} <StatusBadge status={row.status} />
                  </button>
                </li>
              ))}
              {purchases.length === 0 ? <li className="text-muted-foreground">No open purchases.</li> : null}
            </ul>
          </Card>
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
              <li key={line.id} className="grid grid-cols-[1fr_6rem] items-center gap-2">
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
            <p>Fully received.</p>
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
          <ul className="text-sm">
            {(activeReceipt!.lines ?? []).map((line) => (
              <li key={line.id}>
                {line.sku} × {line.qty}
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
          {canReceive(activeReceipt!.status) ? (
            <Button onClick={() => void receiveReceipt()}>Post receive</Button>
          ) : (
            <p>Already received.</p>
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
