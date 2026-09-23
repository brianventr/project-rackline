import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Layers } from "lucide-react";
import { api, errorText, type Location, type ScanHit, type Wave } from "../../api";
import { Button, Card, DoneBanner, EmptyState, Field, Input, Select, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { Skeleton } from "@/components/ui/skeleton";
import { FloorFrame, FloorScanBox, type ScanReport } from "./floor-ui";
import { canPickWave, isOpenWave } from "@/domain/status";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";
import { useSession } from "../../session";

const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

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
  const me = useSession();
  const officeWaves = !isGarageMode(me.organization.operatingMode) || garageAllowsPath("/outbound/waves");
  const [params] = useSearchParams();
  const [waves, setWaves] = useState<Wave[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Wave | null>(null);
  const [locationId, setLocationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function applyWave(wave: Wave) {
    setActive(wave);
    const first = (wave.batchLines ?? []).find((line) => line.remaining > 0);
    if (first) {
      setItemId(first.itemId);
      setQty(String(first.remaining));
    }
  }

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
      applyWave(await api<Wave>(`/api/waves/${wanted}`));
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load open waves.")))
      .finally(() => setLoaded(true));
  }, []);

  function openWave(id: string) {
    api<Wave>(`/api/waves/${id}`)
      .then(applyWave)
      .catch((err) => setError(errorText(err, "Could not open that wave.")));
  }

  const onScan = useCallback(
    (raw: string, report?: ScanReport) => {
      setError(null);
      setDone(null);
      const match = matchWave(waves, raw);
      if (match) {
        api<Wave>(`/api/waves/${match.id}`)
          .then((wave) => {
            applyWave(wave);
            report?.(true);
          })
          .catch((err) => {
            setError(errorText(err, "Could not open that wave."));
            report?.(false);
          });
        return;
      }
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then((hit) => {
          if (hit.kind === "location" && hit.location) {
            setLocationId(hit.location.id);
            report?.(true);
            return;
          }
          if (hit.kind === "item" && hit.item) {
            // A SKU only helps once a batch wave is open and still needs that SKU.
            if (!active) {
              setError("Scan a WAV- wave first, then the bay and SKU.");
              report?.(false);
              return;
            }
            // Batch lines exist only once a batch wave is released.
            if (active.mode !== "batch") {
              setError("Pick this wave's orders on the Pick screen.");
              report?.(false);
              return;
            }
            if (!canPickWave(active.status)) {
              setError(`${active.number} is not open for picking.`);
              report?.(false);
              return;
            }
            const lines = (active.batchLines ?? []).filter((line) => line.itemId === hit.item.id);
            if (lines.length === 0) {
              setError(`${hit.item.sku} is not on ${active.number}.`);
              report?.(false);
              return;
            }
            const line = lines.find((row) => row.remaining > 0);
            if (!line) {
              setError(`${hit.item.sku} is already picked on ${active.number}.`);
              report?.(false);
              return;
            }
            // Same as tapping the line: select the SKU and fill what it has left.
            setItemId(line.itemId);
            setQty(String(line.remaining));
            report?.(true);
            return;
          }
          setError("Scan a WAV- wave, a pick bay, or a SKU.");
          report?.(false);
        })
        .catch((err) => {
          setError(errorText(err, "That barcode did not scan. Try again."));
          report?.(false);
        });
    },
    [waves, active],
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
      setError(errorText(err, "Could not post the batch pick."));
    }
  }

  return (
    <FloorFrame title="Wave" description="Scan a WAV- wave. Batch mode picks aggregated SKUs from a bay." error={error}>
      <FloorScanBox label="Scan wave, bay, or SKU" placeholder="WAV-… or A-01-02" onScan={onScan} />
      <DoneBanner>{done}</DoneBanner>
      {!active ? (
        !loaded ? (
          <Skeleton className="h-40 w-full rounded-xl motion-reduce:animate-none" />
        ) : (
          <Card className="space-y-4">
            <p className="font-medium">Open waves</p>
            {waves.length === 0 ? (
              <EmptyState
                icon={Layers}
                title="No open waves."
                body={
                  <>
                    <Term id="wave">Waves</Term> built in the office show up here to pick.
                  </>
                }
                action={
                  officeWaves ? (
                    <Button variant="secondary" className="h-11" asChild>
                      <Link to="/outbound/waves">Office waves</Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {waves.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="-mx-2 block min-h-11 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      onClick={() => openWave(row.id)}
                    >
                      <span className="font-mono">{row.number}</span> {row.mode} <StatusBadge status={row.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold">{active.number}</h2>
              <p className="text-sm text-muted-foreground first-letter:uppercase">
                {active.mode} · {(active.orders ?? []).length} orders
              </p>
            </div>
            <StatusBadge status={active.status} />
          </div>
          {active.mode === "batch" && canPickWave(active.status) ? (
            <>
              <p className="text-sm text-muted-foreground">
                <Term id="batch-pick">Batch mode</Term>: one trip per SKU covers every order on the wave.
              </p>
              <ul className="space-y-1 text-sm">
                {(active.batchLines ?? []).map((line) => (
                  <li key={line.id}>
                    <button
                      type="button"
                      aria-pressed={line.itemId === itemId}
                      className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-md px-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-muted"
                      onClick={() => {
                        setItemId(line.itemId);
                        setQty(String(line.remaining));
                      }}
                    >
                      <span>
                        <span className="font-mono">{line.sku}</span> · {line.qtyPicked}/{line.qty}
                      </span>
                      <span className="font-mono text-muted-foreground">{line.remaining} left</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Field label="SKU">
                <Select className="h-11 text-base" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  {(active.batchLines ?? []).map((line) => (
                    <option key={line.id} value={line.itemId}>
                      {line.sku} — {line.remaining} left
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From bay">
                <Select className="h-11 text-base" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Qty">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  className="h-11 text-base"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </Field>
              <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void batchPick()} disabled={!itemId}>
                Batch pick
              </Button>
            </>
          ) : active.mode === "wave" ? (
            <div className="space-y-2 text-sm">
              <p>Wave mode: pick each order on the floor pick screen.</p>
              <ul className="space-y-1">
                {(active.orders ?? []).map((order) => (
                  <li key={order.id} className="flex min-h-11 items-center gap-2">
                    <Link className={`${textLink} font-mono`} to={`/floor/pick?id=${order.id}`}>
                      {order.number}
                    </Link>
                    <StatusBadge status={order.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>Wave is not open for picking.</p>
          )}
          <div className="flex flex-wrap gap-x-5">
            <button type="button" className={textLink} onClick={() => setActive(null)}>
              Back to list
            </button>
            <Link className={textLink} to={`/outbound/waves/${active.id}/pick-list`}>
              Print pick list
            </Link>
            <Link className={textLink} to="/outbound/waves">
              Office waves
            </Link>
          </div>
        </Card>
      )}
    </FloorFrame>
  );
}
