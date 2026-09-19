import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type Rma, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canReceiveReturn } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";

export function FloorReturnPage() {
  const [params] = useSearchParams();
  const [returns, setReturns] = useState<Rma[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Rma | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function openRma(rma: Rma) {
    setActive(rma);
    setQtys(Object.fromEntries((rma.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  async function load() {
    const [nextReturns, nextLocations] = await Promise.all([api<Rma[]>("/api/returns"), api<Location[]>("/api/locations")]);
    setReturns(
      nextReturns.filter(
        (row) =>
          canReceiveReturn(row.status) &&
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
      const match = nextReturns.find((row) => row.id === wanted) ?? (await api<Rma>(`/api/returns/${wanted}`));
      openRma(match);
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
        if (hit.kind === "rma") {
          void api<Rma>(`/api/returns/${hit.rma.id}`).then(openRma);
          return;
        }
        if (hit.kind === "location") {
          setLocationId(hit.location.id);
          return;
        }
        setError("Scan a return number or a bay barcode.");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function receive() {
    if (!active) return;
    setError(null);
    try {
      const lines = (active.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(qtys[line.itemId] || 0),
          serials: serials[line.itemId] || undefined,
        }))
        .filter((line) => line.qty > 0);
      const posted = await api<Rma>(`/api/returns/${active.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      openRma(posted);
      setDone(`${posted.number} received back into the bay.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Receive failed");
    }
  }

  const remaining =
    active &&
    hasRemaining(
      (active.lines ?? []).map((line) => ({
        itemId: line.itemId,
        qtyExpected: line.qtyExpected,
        qtyReceived: line.qtyReceived,
      })),
    );

  return (
    <FloorFrame title="Return" description="Scan an RMA, scan the bay, put the goods back on hand." error={error}>
      <FloorScanBox label="Scan return or bay" placeholder="RMA-DEMO1 or RECV" onScan={onScan} />
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
          <p className="mb-3 font-medium">Open returns</p>
          <ul className="space-y-2 text-sm">
            {returns.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => void api<Rma>(`/api/returns/${row.id}`).then(openRma)}>
                  <span className="font-mono">{row.number}</span> {row.customerName} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {returns.length === 0 ? <li className="text-muted-foreground">Nothing to receive back.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{active.number}</h2>
              <p className="text-sm text-muted-foreground">{active.customerName}</p>
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
                {line.trackSerial ? (
                  <Input
                    placeholder="Serials"
                    value={serials[line.itemId] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
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
          {canReceiveReturn(active.status) && remaining ? (
            <Button onClick={() => void receive()}>Post return</Button>
          ) : (
            <div className="space-y-2">
              <p>Already received.</p>
              <Link
                className="block text-sm underline"
                to={`/floor/putaway?from=${encodeURIComponent(locations.find((row) => row.id === locationId)?.barcode || "")}`}
              >
                Put away from this bay
              </Link>
            </div>
          )}
          <Link className="block text-sm underline" to="/outbound/returns">
            Office returns
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
