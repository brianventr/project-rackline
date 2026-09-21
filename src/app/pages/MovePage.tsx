import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type MapContent, type ScanHit, type ScanLocationHit, type Transfer, type WarehouseMapData } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { WarehouseMap } from "../components/WarehouseMap";
import { Button, Card, ErrorBanner, PageHeader, StatusBadge } from "../components/ui";
import { useScanner } from "../scanner/ScannerProvider";
import { canPostTransfer } from "@/domain/status";
import { hasUnmoved } from "@/domain/partial-transfer";
import { ClaimList, openFloorRow } from "./floor/floor-ui";
import { useSession } from "../session";
import { jobForRef, useOpenJobs } from "../jobs";

type Slot = {
  barcode: string;
  hit: ScanLocationHit | null;
};

export function MovePage() {
  const [params] = useSearchParams();
  const scanner = useScanner();
  const [from, setFrom] = useState<Slot>({ barcode: params.get("from") ?? "", hit: null });
  const [to, setTo] = useState<Slot>({ barcode: params.get("to") ?? "", hit: null });
  const [step, setStep] = useState<"from" | "to">(params.get("from") ? "to" : "from");
  const [map, setMap] = useState<WarehouseMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const fromRef = useRef(from);
  fromRef.current = from;
  const toRef = useRef(to);
  toRef.current = to;
  const inputRef = useRef<HTMLInputElement>(null);
  const handledAt = useMemo(() => ({ current: 0 }), []);

  useEffect(() => {
    api<WarehouseMapData>("/api/map")
      .then(setMap)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (params.get("from")) void resolveSlot("from", params.get("from")!);
    else if (params.get("to")) void resolveSlot("to", params.get("to")!);
  }, [params]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step, result]);

  useEffect(() => {
    const scan = scanner.lastScan;
    if (!scan || scan.at === handledAt.current) return;
    handledAt.current = scan.at;
    void resolveSlot(step, scan.raw);
  }, [scanner.lastScan, step, handledAt]);

  async function resolveSlot(which: "from" | "to", raw: string) {
    setError(null);
    setResult(null);
    try {
      const hit = await api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`);
      if (hit.kind !== "location") {
        setError(`${raw} is an item barcode. Scan a location / bay label.`);
        return;
      }
      if (which === "from") {
        setFrom({ barcode: hit.location.barcode, hit });
        if (toRef.current.hit) {
          await commit(hit, toRef.current.hit);
        } else {
          setStep("to");
        }
      } else {
        if (fromRef.current.hit && hit.location.id === fromRef.current.hit.location.id) {
          setError("Scan a different bay for the destination.");
          return;
        }
        setTo({ barcode: hit.location.barcode, hit });
        if (fromRef.current.hit) {
          await commit(fromRef.current.hit, hit);
        } else {
          setStep("from");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Barcode not recognized");
    }
  }

  async function commit(fromHit: ScanLocationHit | null, toHit: ScanLocationHit) {
    if (!fromHit) {
      setError("Scan the previous location first.");
      setStep("from");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const moved = await api<{ moved: MapContent[]; from: { code: string }; to: { code: string } }>("/api/moves", {
        method: "POST",
        body: JSON.stringify({
          fromBarcode: fromHit.location.barcode,
          toBarcode: toHit.location.barcode,
        }),
      });
      const summary = moved.moved.map((row) => `${row.qty} ${row.sku}`).join(", ");
      setResult(`Moved ${summary} from ${moved.from.code} to ${moved.to.code}.`);
      const nextMap = await api<WarehouseMapData>("/api/map");
      setMap(nextMap);
      setFrom({ barcode: "", hit: null });
      setTo({ barcode: "", hit: null });
      setStep("from");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshFrom(barcode: string) {
    const hit = await api<ScanHit>(`/api/scan?code=${encodeURIComponent(barcode)}`);
    if (hit.kind !== "location") return;
    setFrom({ barcode: hit.location.barcode, hit });
    setTo({ barcode: "", hit: null });
    setStep(hit.contents.length ? "to" : "from");
  }

  async function putawayLine(fromHit: ScanLocationHit, row: MapContent) {
    const suggested = row.suggestedLocation;
    if (!suggested) return;
    setBusy(true);
    setError(null);
    try {
      const moved = await api<{ moved: MapContent[]; from: { code: string }; to: { code: string } }>("/api/moves", {
        method: "POST",
        body: JSON.stringify({
          fromBarcode: fromHit.location.barcode,
          toBarcode: suggested.barcode,
          lines: [{ itemId: row.itemId, qty: row.qty }],
        }),
      });
      const summary = moved.moved.map((line) => `${line.qty} ${line.sku}`).join(", ");
      setResult(`Moved ${summary} from ${moved.from.code} to ${moved.to.code}.`);
      const nextMap = await api<WarehouseMapData>("/api/map");
      setMap(nextMap);
      await refreshFrom(fromHit.location.barcode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed");
    } finally {
      setBusy(false);
    }
  }

  function onTypedScan() {
    const value = (step === "from" ? from.barcode : to.barcode).trim();
    if (value) void resolveSlot(step, value);
  }

  const prompt = step === "from" ? "Scan previous location" : "Scan new location";

  return (
    <div>
      <PageHeader
        eyebrow="Floor"
        title="Put away"
        description="Scan the bay you are leaving. For dock stock, put each SKU onto the suggested bulk bay — or scan a destination to move the whole slot."
        actions={
          <Button variant="secondary" onClick={scanner.openCamera}>
            Open camera
          </Button>
        }
      />
      <ErrorBanner error={error} />
      <OpenTransferTickets />
      {result ? <p className="mb-4 rounded-lg border border-ok/30 bg-ok/10 px-2.5 py-1.5 text-sm text-ok">{result}</p> : null}
      <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className={step === "from" ? "ring-2 ring-amber" : ""}>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">1. From</p>
            <SlotCard
              slot={from}
              busy={busy}
              onPutawayLine={from.hit ? (row) => void putawayLine(from.hit!, row) : undefined}
            />
          </Card>
          <Card className={step === "to" ? "ring-2 ring-amber" : ""}>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">2. To</p>
            <SlotCard slot={to} />
          </Card>
          <Card data-scan-capture="true">
            <p className="mb-2 font-semibold">{prompt}</p>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={step === "from" ? from.barcode : to.barcode}
                onChange={(event) => {
                  const value = event.target.value.toUpperCase();
                  if (step === "from") setFrom((prev) => ({ ...prev, barcode: value }));
                  else setTo((prev) => ({ ...prev, barcode: value }));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const value = event.currentTarget.value.trim();
                    if (value) void resolveSlot(step, value);
                  }
                }}
                placeholder="A-01-01"
                autoComplete="off"
                className="w-full rounded-lg border border-line bg-paper px-3 py-2.5 font-mono text-sm outline-none ring-amber/40 focus:ring-2"
              />
              <Button onClick={onTypedScan} disabled={busy}>
                {busy ? "Moving…" : "Use"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Gun scanners type the barcode and Enter. Camera works on Chromium. You can also tap a bay on the map.
            </p>
          </Card>
          <button
            className="text-sm text-muted-foreground hover:text-ink"
            onClick={() => {
              setFrom({ barcode: "", hit: null });
              setTo({ barcode: "", hit: null });
              setStep("from");
              setResult(null);
              setError(null);
            }}
          >
            Reset move
          </button>
        </div>
        {map ? (
          <WarehouseMap
            warehouse={map.warehouse}
            locations={map.locations}
            selectedId={step === "from" ? from.hit?.location.id : to.hit?.location.id}
            fromId={from.hit?.location.id}
            toId={to.hit?.location.id ?? from.hit?.contents.find((row) => row.suggestedLocation)?.suggestedLocation?.locationId}
            view="iso"
            levelFilter="all"
            onSelect={(location) => {
              void resolveSlot(step, location.barcode);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function OpenTransferTickets() {
  const me = useSession();
  const navigate = useNavigate();
  const { jobs } = useOpenJobs("putaway");
  const [tickets, setTickets] = useState<Transfer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Transfer[]>("/api/transfers")
      .then((rows) =>
        setTickets(
          rows.filter(
            (row) =>
              canPostTransfer(row.status) &&
              hasUnmoved(
                (row.lines ?? []).map((line) => ({
                  lineId: line.id,
                  sku: line.sku,
                  qtyExpected: line.qty,
                  qtyMoved: line.qtyMoved ?? 0,
                })),
              ),
          ),
        ),
      )
      .catch(() => undefined);
  }, []);

  if (!tickets.length) return null;

  return (
    <div className="mb-3">
      <ErrorBanner error={error} />
      <ClaimList
        title="Open putaway tickets"
        empty="No open putaway tickets."
        rows={tickets}
        userId={me.user.id}
        jobFor={(row) => jobForRef(jobs, "transfer", row.id, "putaway")}
        onOpen={(row) =>
          openFloorRow(row, me.user.id, jobForRef(jobs, "transfer", row.id, "putaway"), () => {
            navigate(`/floor/putaway?id=${row.id}`);
          }, setError)
        }
        render={(row) => (
          <>
            <span className="font-mono">{row.number}</span> {row.fromCode} → {row.toCode}{" "}
            <StatusBadge status={row.status} />
          </>
        )}
      />
    </div>
  );
}

function SlotCard({
  slot,
  busy,
  onPutawayLine,
}: {
  slot: Slot;
  busy?: boolean;
  onPutawayLine?: (row: MapContent) => void;
}) {
  if (!slot.hit) {
    return <p className="mt-2 text-sm text-muted-foreground">Waiting for a location barcode.</p>;
  }
  const { location, contents } = slot.hit;
  return (
    <div className="mt-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-lg font-semibold">{location.code}</p>
          <p className="text-sm text-muted-foreground">{location.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {location.area}
            {location.aisle ? ` · aisle ${location.aisle}` : ""}
            {location.bay ? ` · bay ${location.bay}` : ""}
            {` · L${location.level}`}
          </p>
        </div>
        <BarcodeLabel value={location.barcode} className="h-12 max-w-[9rem]" height={32} />
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {contents.length ? (
          contents.map((row) => (
            <li key={row.itemId} className="flex items-start justify-between gap-3">
              <span>
                <span className="font-mono">{row.sku}</span>
                <span className="font-mono tabular"> × {row.qty}</span>
                {row.suggestedLocation ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Suggested {row.suggestedLocation.locationCode}
                    {row.suggestedLocation.qty > 0 ? ` · ${row.suggestedLocation.qty} already there` : ""}
                  </span>
                ) : null}
              </span>
              {row.suggestedLocation && onPutawayLine ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onPutawayLine(row)}
                  className="h-8 shrink-0 px-2 text-xs"
                >
                  Put on {row.suggestedLocation.locationCode}
                </Button>
              ) : null}
            </li>
          ))
        ) : (
          <li className="text-muted-foreground">Empty</li>
        )}
      </ul>
      <Link className="mt-2 inline-block text-xs underline" to={`/map?location=${location.id}`}>
        Show on map
      </Link>
    </div>
  );
}
