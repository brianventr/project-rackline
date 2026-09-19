import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type Receipt, type ScanHit } from "../../api";
import { Button, Card, Field, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canReceive } from "@/domain/status";

export function FloorReceivePage() {
  const [params] = useSearchParams();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Receipt | null>(null);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const [nextReceipts, nextLocations] = await Promise.all([
      api<Receipt[]>("/api/receipts"),
      api<Location[]>("/api/locations"),
    ]);
    setReceipts(nextReceipts.filter((row) => canReceive(row.status)));
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(dock.id);
    const wanted = params.get("id");
    if (wanted) {
      const match = nextReceipts.find((row) => row.id === wanted) ?? (await api<Receipt>(`/api/receipts/${wanted}`));
      setActive(match);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "receipt") {
          void api<Receipt>(`/api/receipts/${hit.receipt.id}`).then(setActive);
          return;
        }
        if (hit.kind === "location") {
          setLocationId(hit.location.id);
          return;
        }
        setError("Scan a receipt number or a dock / bay barcode.");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function receive() {
    if (!active) return;
    setError(null);
    try {
      if (active.status === "draft") {
        await api(`/api/receipts/${active.id}/start`, { method: "POST" });
      }
      const posted = await api<Receipt>(`/api/receipts/${active.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId }),
      });
      setActive(posted);
      setDone(`${posted.number} received.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receive failed");
    }
  }

  return (
    <FloorFrame title="Receive" description="Scan a receipt, scan the dock, post it into the bay." error={error}>
      <FloorScanBox label="Scan receipt or bay" placeholder="RCP-DEMO1 or RECV" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open receipts</p>
          <ul className="space-y-2 text-sm">
            {receipts.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => void api<Receipt>(`/api/receipts/${row.id}`).then(setActive)}>
                  <span className="font-mono">{row.number}</span> <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {receipts.length === 0 ? <li className="text-muted-foreground">Nothing to receive.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <ul className="text-sm">
            {(active.lines ?? []).map((line) => (
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
          {canReceive(active.status) ? <Button onClick={() => void receive()}>Post receive</Button> : <p>Already received.</p>}
          <Link className="block text-sm underline" to="/inbound/receipts">
            Office receipts
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
