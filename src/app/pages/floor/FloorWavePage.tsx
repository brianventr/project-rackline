import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Location, type Wave } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canPickWave, isOpenWave } from "@/domain/status";

function matchWave(waves: Wave[], raw: string): Wave | undefined {
  const needle = raw.trim().toUpperCase().replace(/^WAV[:\-]/, "");
  return waves.find(
    (row) =>
      row.number.toUpperCase() === raw.trim().toUpperCase() ||
      row.number.toUpperCase() === needle ||
      row.number.toUpperCase().endsWith(needle) ||
      row.id === raw.trim(),
  );
}

export function FloorWavePage() {
  const [params] = useSearchParams();
  const [waves, setWaves] = useState<Wave[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Wave | null>(null);
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const [nextWaves, nextLocations] = await Promise.all([
      api<Wave[]>("/api/waves"),
      api<Location[]>("/api/locations"),
    ]);
    const open = nextWaves.filter((row) => isOpenWave(row.status));
    setWaves(open);
    setLocations(nextLocations);
    const storage = nextLocations.find((row) => row.type === "storage") ?? nextLocations[0];
    if (storage) setLocationId(storage.id);
    const wanted = params.get("id");
    if (wanted) {
      const detail = await api<Wave>(`/api/waves/${wanted}`);
      setActive(detail);
      const first = (detail.batchLines ?? []).find((line) => line.remaining > 0);
      if (first) {
        setItemId(first.itemId);
        setQty(String(first.remaining));
      }
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback(
    (raw: string) => {
      setError(null);
      setDone(null);
      const match = matchWave(waves, raw);
      if (match) {
        void api<Wave>(`/api/waves/${match.id}`).then((wave) => {
          setActive(wave);
          const first = (wave.batchLines ?? []).find((line) => line.remaining > 0);
          if (first) {
            setItemId(first.itemId);
            setQty(String(first.remaining));
          }
        });
        return;
      }
      void api<{ kind: string; location?: Location; item?: { id: string } }>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((hit) => {
          if (hit.kind === "location" && hit.location) {
            setLocationId(hit.location.id);
            return;
          }
          if (hit.kind === "item" && hit.item) {
            setItemId(hit.item.id);
            return;
          }
          setError("Scan a WAV- wave, a pick bay, or a SKU.");
        })
        .catch((err: Error) => setError(err.message));
    },
    [waves],
  );

  async function batchPick() {
    if (!active) return;
    setError(null);
    try {
      const next = await api<Wave>(`/api/waves/${active.id}/batch-pick`, {
        method: "POST",
        body: JSON.stringify({ locationId, itemId, qty: Number(qty) }),
      });
      setActive(next);
      setDone(`Picked ${qty} onto ${next.number}.`);
      const first = (next.batchLines ?? []).find((line) => line.remaining > 0);
      if (first) {
        setItemId(first.itemId);
        setQty(String(first.remaining));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch pick failed");
    }
  }

  return (
    <FloorFrame title="Wave" description="Scan a WAV- wave. Batch mode picks aggregated SKUs from a bay." error={error}>
      <FloorScanBox label="Scan wave, bay, or SKU" placeholder="WAV-… or A-01-02" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Open waves</p>
          <ul className="space-y-2 text-sm">
            {waves.map((row) => (
              <li key={row.id}>
                <button
                  className="w-full text-left"
                  onClick={() =>
                    void api<Wave>(`/api/waves/${row.id}`).then((wave) => {
                      setActive(wave);
                      const first = (wave.batchLines ?? []).find((line) => line.remaining > 0);
                      if (first) {
                        setItemId(first.itemId);
                        setQty(String(first.remaining));
                      }
                    })
                  }
                >
                  <span className="font-mono">{row.number}</span> {row.mode} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {waves.length === 0 ? <li className="text-muted-foreground">No open waves.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">{active.number}</h2>
              <p className="text-sm text-muted-foreground capitalize">
                {active.mode} · {(active.orders ?? []).length} orders
              </p>
            </div>
            <StatusBadge status={active.status} />
          </div>
          {active.mode === "batch" && canPickWave(active.status) ? (
            <>
              <ul className="space-y-2 text-sm">
                {(active.batchLines ?? []).map((line) => (
                  <li key={line.id} className="flex justify-between gap-2">
                    <button
                      className="text-left"
                      onClick={() => {
                        setItemId(line.itemId);
                        setQty(String(line.remaining));
                      }}
                    >
                      <span className="font-mono">{line.sku}</span> · {line.qtyPicked}/{line.qty}
                    </button>
                    <span className="font-mono text-muted-foreground">{line.remaining} left</span>
                  </li>
                ))}
              </ul>
              <Field label="SKU">
                <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  {(active.batchLines ?? []).map((line) => (
                    <option key={line.id} value={line.itemId}>
                      {line.sku} — {line.remaining} left
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From bay">
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Qty">
                <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              </Field>
              <Button onClick={() => void batchPick()} disabled={!itemId}>
                Batch pick
              </Button>
            </>
          ) : active.mode === "wave" ? (
            <div className="space-y-2 text-sm">
              <p>Wave mode: pick each order on the floor pick screen.</p>
              <ul className="space-y-1">
                {(active.orders ?? []).map((order) => (
                  <li key={order.id}>
                    <Link className="underline" to={`/floor/pick?id=${order.id}`}>
                      {order.number}
                    </Link>{" "}
                    <StatusBadge status={order.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>Wave is not open for picking.</p>
          )}
          <button className="text-sm underline" onClick={() => setActive(null)}>
            Back to list
          </button>
          <Link className="block text-sm underline" to="/outbound/waves">
            Office waves
          </Link>
        </Card>
      )}
    </FloorFrame>
  );
}
