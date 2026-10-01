import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Package2 } from "lucide-react";
import { api, errorText, type Plate, type PlateDetail, type ScanHit } from "../../api";
import { Button, Card, DoneBanner, EmptyState, ErrorBanner, Field, Input, Select, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { SkuThumb } from "../../components/sku-thumb";
import { OverfillButton, useOverfill } from "../../components/bin-capacity";
import { useConfirm } from "../../components/confirm";
import { refreshApi, useApiQuery } from "../../query";
import { useWarehouse } from "../../warehouse";
import { Skeleton } from "@/components/ui/skeleton";
import { FloorFrame, FloorScanBox, type ScanReport } from "./floor-ui";
import { PLATE_TYPES, PLATE_TYPE_LABELS, canPlate, type PlateType } from "@/domain/license-plates";

/** A bay scanned with no plate open: a new plate starts here. */
type Bay = { id: string; code: string; plates: Plate[] };

type BayRow = PlateDetail["bayStock"][number];

const rowButton =
  "-mx-2 block min-h-11 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50";

function unitsOf(plate: Plate, itemId: string): number {
  return plate.lines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.qty, 0);
}

function unitText(units: number): string {
  return `${units} ${units === 1 ? "unit" : "units"}`;
}

export function FloorPlatesPage() {
  const [params, setParams] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const confirm = useConfirm();
  const { overfill, offer } = useOverfill();
  const list = useApiQuery<Plate[]>(`/api/plates${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ""}`);
  const [plate, setPlate] = useState<PlateDetail | null>(null);
  const [bay, setBay] = useState<Bay | null>(null);
  const [type, setType] = useState<PlateType>("tote");
  const [qty, setQty] = useState("1");
  const [lot, setLot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Scans run one at a time against the latest plate, so two quick scans cannot both claim the same loose units.
  const plateRef = useRef<PlateDetail | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const fields = useRef({ qty, lot });
  fields.current = { qty, lot };

  function show(next: PlateDetail | null) {
    plateRef.current = next;
    setPlate(next);
    if (next) setBay(null);
    setParams(next ? { code: next.code } : {}, { replace: true });
  }

  async function openPlate(ref: string): Promise<boolean> {
    try {
      show(await api<PlateDetail>(`/api/plates/${encodeURIComponent(ref)}`));
      setNotice(null);
      return true;
    } catch (err) {
      setError(errorText(err, "Could not open that plate."));
      return false;
    }
  }

  useEffect(() => {
    const wanted = params.get("code");
    void (wanted ? openPlate(wanted) : Promise.resolve()).finally(() => setLoaded(true));
  }, []);

  async function write(
    fallback: string,
    request: () => Promise<PlateDetail>,
    done: (saved: PlateDetail) => string,
    retry?: () => void,
  ): Promise<boolean> {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const saved = await request();
      show(saved);
      setNotice(done(saved));
      void refreshApi();
      return true;
    } catch (err) {
      const text = errorText(err, fallback);
      setError(text);
      if (retry) offer(err, text, retry);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function post(current: Plate, verb: string, body?: unknown) {
    return () =>
      api<PlateDetail>(`/api/plates/${encodeURIComponent(current.code)}/${verb}`, {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
  }

  function build(current: PlateDetail, body: { scan?: string; itemId?: string; qty?: number | string }, itemId: string, sku: string) {
    return write(
      `Could not put ${sku} on ${current.code}.`,
      post(current, "lines", { ...body, lotCode: fields.current.lot.trim() || undefined }),
      (saved) => `Put ${unitsOf(saved, itemId) - unitsOf(current, itemId)} × ${sku} on ${saved.code}.`,
    );
  }

  function move(current: PlateDetail, toId: string, toCode: string, overrideCapacity = false): Promise<boolean> {
    return write(
      `Could not move ${current.code} to ${toCode}.`,
      post(current, "move", { toLocationId: toId, ...(overrideCapacity ? { overrideCapacity } : {}) }),
      (saved) => `Moved ${saved.code} to ${toCode}${saved.units ? ` with its ${unitText(saved.units)}` : ""}.`,
      () => void move(current, toId, toCode, true),
    );
  }

  function start(at: Bay) {
    return write(
      `Could not start a plate in ${at.code}.`,
      () => api<PlateDetail>("/api/plates", { method: "POST", body: JSON.stringify({ type, locationId: at.id }) }),
      (saved) => `Started ${saved.code} in ${at.code}. Scan stock in the bay to put it on.`,
    );
  }

  async function breakPlate(current: PlateDetail) {
    const bayCode = current.locationCode ?? "the bay";
    const ok = await confirm({
      title: `Break ${current.code}?`,
      body: `Its ${unitText(current.units)} stay in ${bayCode} as loose stock. The plate stays open and empty.`,
      confirmLabel: "Break plate",
      cancelLabel: "Keep plate",
    });
    if (!ok) return;
    await write(`Could not break ${current.code}.`, post(current, "break"), () => `Broke ${current.code}. Its stock is loose in ${bayCode}.`);
  }

  async function handleScan(raw: string, report?: ScanReport) {
    setError(null);
    let hit: ScanHit;
    try {
      hit = await api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`);
    } catch (err) {
      setError(errorText(err, "That barcode did not scan. Try again."));
      report?.(false);
      return;
    }
    const current = plateRef.current;
    if (hit.kind === "plate") {
      report?.(await openPlate(hit.plate.code));
      return;
    }
    if (hit.kind === "location") {
      if (current && canPlate(current, "move")) {
        if (current.locationId === hit.location.id) {
          setError(`${current.code} is already in ${hit.location.code}.`);
          report?.(false);
          return;
        }
        report?.(await move(current, hit.location.id, hit.location.code));
        return;
      }
      show(null);
      setNotice(null);
      setBay({ id: hit.location.id, code: hit.location.code, plates: hit.plates ?? [] });
      report?.(true);
      return;
    }
    if (current && hit.kind === "item") {
      report?.(await build(current, { scan: raw, qty: fields.current.qty.trim() || undefined }, hit.item.id, hit.item.sku));
      return;
    }
    if (current && hit.kind === "serial") {
      report?.(await build(current, { scan: raw }, hit.item.id, hit.item.sku));
      return;
    }
    setError(
      current
        ? `Scan stock to put on ${current.code}, a bay to move it to, or another plate.`
        : "Scan a plate to open it, or a bay to start one there.",
    );
    report?.(false);
  }

  function onScan(raw: string, report?: ScanReport) {
    queue.current = queue.current.then(() => handleScan(raw, report));
  }

  function done() {
    show(null);
    setBay(null);
    setNotice(null);
    setError(null);
  }

  return (
    <FloorFrame
      title="Plates"
      description={
        <>
          Scan a bay to start a <Term id="license-plate">plate</Term>, or a plate to open it. Scan stock onto it, or another
          bay to move it.
        </>
      }
      error={error}
    >
      <FloorScanBox label="Scan plate, bay, or stock" placeholder="LP-000123, A-01-02, or SHADE" onScan={onScan} ready={loaded} />
      <OverfillButton overfill={overfill} error={error} busy={busy} />
      <DoneBanner>{notice}</DoneBanner>
      {plate ? (
        <PlateCard
          plate={plate}
          busy={busy}
          qty={qty}
          onQty={setQty}
          lot={lot}
          onLot={setLot}
          onAdd={(row) => void build(plate, { itemId: row.itemId, qty: row.loose }, row.itemId, row.sku)}
          onClose={() => void write(`Could not close ${plate.code}.`, post(plate, "close"), (saved) => `Closed ${saved.code}. Nothing more goes on it.`)}
          onReopen={() => void write(`Could not reopen ${plate.code}.`, post(plate, "reopen"), (saved) => `Reopened ${saved.code}.`)}
          onBreak={() => void breakPlate(plate)}
          onDone={done}
        />
      ) : bay ? (
        <Card className="space-y-4">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">Bay</p>
            <h2 className="text-2xl font-semibold">{bay.code}</h2>
          </div>
          <Field label="Type">
            <Select className="h-11 text-base" value={type} onChange={(e) => setType(e.target.value as PlateType)}>
              {PLATE_TYPES.map((row) => (
                <option key={row} value={row}>
                  {PLATE_TYPE_LABELS[row]}
                </option>
              ))}
            </Select>
          </Field>
          <Button className="h-14 w-full text-lg sm:w-auto" disabled={busy} onClick={() => void start(bay)}>
            Start {PLATE_TYPE_LABELS[type].toLowerCase()} in {bay.code}
          </Button>
          {bay.plates.length ? (
            <PlateRows title={`Already in ${bay.code}`} plates={bay.plates} onOpen={(code) => void openPlate(code)} />
          ) : (
            <p className="text-sm text-muted-foreground">No plates in {bay.code} yet.</p>
          )}
          <Button variant="secondary" className="h-11 w-full sm:w-auto" onClick={done}>
            Back to plates
          </Button>
        </Card>
      ) : (
        <Card className="space-y-4">
          <p className="font-medium">Plates in bays</p>
          {list.error ? (
            <ErrorBanner error={errorText(list.error, "Could not load plates.")} />
          ) : list.isLoading ? (
            <div role="status" aria-label="Loading" className="space-y-2">
              <Skeleton className="h-11 w-full motion-reduce:animate-none" />
              <Skeleton className="h-11 w-full motion-reduce:animate-none" />
            </div>
          ) : list.data?.length ? (
            <PlateRows plates={list.data} onOpen={(code) => void openPlate(code)} />
          ) : (
            <EmptyState
              icon={Package2}
              title="No plates yet."
              body="Scan a bay to start a tote, pallet, or carton there, then scan stock in that bay onto it."
            />
          )}
        </Card>
      )}
    </FloorFrame>
  );
}

function PlateRows({ title, plates, onOpen }: { title?: string; plates: Plate[]; onOpen: (code: string) => void }) {
  return (
    <div className="space-y-2">
      {title ? <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p> : null}
      <ul className="space-y-2 text-sm">
        {plates.map((row) => (
          <li key={row.id}>
            <button type="button" className={rowButton} onClick={() => onOpen(row.code)}>
              <span className="font-mono">{row.code}</span> {PLATE_TYPE_LABELS[row.type]}
              {row.locationCode ? (
                <>
                  {" "}
                  in <span className="font-mono">{row.locationCode}</span>
                </>
              ) : null}{" "}
              · {unitText(row.units)} <StatusBadge status={row.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlateCard({
  plate,
  busy,
  qty,
  onQty,
  lot,
  onLot,
  onAdd,
  onClose,
  onReopen,
  onBreak,
  onDone,
}: {
  plate: PlateDetail;
  busy: boolean;
  qty: string;
  onQty: (value: string) => void;
  lot: string;
  onLot: (value: string) => void;
  onAdd: (row: BayRow) => void;
  onClose: () => void;
  onReopen: () => void;
  onBreak: () => void;
  onDone: () => void;
}) {
  const building = canPlate(plate, "build");
  const loose = plate.bayStock.filter((row) => row.loose > 0);
  const lotTracked = plate.bayStock.some((row) => row.trackLot);
  const hint =
    plate.status === "shipped"
      ? "Shipped. It is no longer in a bay."
      : plate.status === "closed"
        ? "Closed, so nothing more goes on. Scan a bay to move it, or reopen it to add stock."
        : "Scan stock in this bay to put it on. Scan another bay to move the plate and everything on it.";

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase text-muted-foreground">{PLATE_TYPE_LABELS[plate.type]}</p>
          <h2 className="font-mono text-2xl font-semibold">{plate.code}</h2>
          {plate.locationCode ? (
            <p className="text-sm text-muted-foreground">
              In <span className="font-mono">{plate.locationCode}</span>
              {plate.locationName ? ` · ${plate.locationName}` : ""}
            </p>
          ) : null}
        </div>
        <StatusBadge status={plate.status} />
      </div>
      <div>
        <div className="flex justify-between gap-2 border-b pb-1 text-xs text-muted-foreground">
          <span>On the plate</span>
          <span>{unitText(plate.units)}</span>
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          {plate.lines.length ? (
            plate.lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <SkuThumb sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="font-mono">{line.sku}</span> {line.itemName}
                    {line.lotCode ? <span className="ml-2 font-mono text-xs text-muted-foreground">{line.lotCode}</span> : null}
                    {line.serial ? <span className="ml-2 font-mono text-xs text-muted-foreground">{line.serial}</span> : null}
                  </span>
                </span>
                <span className="font-mono tabular-nums">{line.qty}</span>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground">Nothing on it yet.</li>
          )}
        </ul>
      </div>
      {building ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Qty per scan">
            <Input className="h-11 text-base" type="number" min={1} value={qty} onChange={(e) => onQty(e.target.value)} />
          </Field>
          {lotTracked ? (
            <Field label="Lot (optional)">
              <Input className="h-11 font-mono text-base" value={lot} onChange={(e) => onLot(e.target.value)} placeholder="Oldest first" />
            </Field>
          ) : null}
        </div>
      ) : null}
      {building && loose.length ? (
        <div>
          <div className="flex justify-between gap-2 border-b pb-1 text-xs text-muted-foreground">
            <span>Loose in {plate.locationCode}</span>
            <span>Not on a plate</span>
          </div>
          <ul className="mt-2 space-y-2 text-sm">
            {loose.map((row) => (
              <li key={row.itemId} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <SkuThumb sku={row.sku} name={row.itemName} imageUrl={row.imageUrl} size="sm" />
                  <span className="min-w-0">
                    <span className="font-mono">{row.sku}</span> {row.itemName}
                  </span>
                </span>
                <Button variant="secondary" className="h-11 shrink-0" disabled={busy} onClick={() => onAdd(row)}>
                  Add all {row.loose}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {canPlate(plate, "close") && plate.lines.length ? (
          <Button className="h-14 w-full text-lg sm:w-auto" disabled={busy} onClick={onClose}>
            Close plate
          </Button>
        ) : null}
        {canPlate(plate, "reopen") ? (
          <Button className="h-14 w-full text-lg sm:w-auto" disabled={busy} onClick={onReopen}>
            Reopen
          </Button>
        ) : null}
        {canPlate(plate, "break") && plate.lines.length ? (
          <Button variant="secondary" className="h-11" disabled={busy} onClick={onBreak}>
            Break plate
          </Button>
        ) : null}
        <Button variant="secondary" className="h-11" onClick={onDone}>
          Done
        </Button>
      </div>
    </Card>
  );
}
