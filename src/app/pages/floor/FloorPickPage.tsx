import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, CheckCircle2, ListChecks, Loader2, MapPin, Minus, MoreHorizontal, Plus, Printer, SkipForward, Undo2, XCircle } from "lucide-react";
import { api, errorText, type Location, type Order, type OrderLine, type ScanHit } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow, type ScanReport } from "./floor-ui";
import { CatchWeightInput, parseWeightGrams } from "../../components/catch-weight-field";
import { SkuThumb } from "../../components/sku-thumb";
import { PickMap } from "../../components/PickMap";
import { useConfirm } from "../../components/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button as UiButton } from "@/components/ui/button";
import { canPickOrder, canStartPick, canCancelOrder, canUnpickOrder } from "@/domain/status";
import { hasUnpicked } from "@/domain/partial-pick";
import { remainingToUnpick } from "@/domain/partial-unpick";
import { desiredVerb } from "@/domain/jobs";
import { formatLocationAddress } from "@/domain/pick-list";
import {
  appendSerial,
  clampPickQty,
  lineRemaining,
  nextStopKey,
  pickBayFor,
  pickStops,
  routeGuidedScan,
  stopCounter,
  stopIndex,
  stopKey,
  stopPickBody,
  stopProgress,
  withPickBay,
  type BayOverrides,
  type PickStop,
} from "@/domain/guided-pick";
import { cn } from "@/lib/utils";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

type PickMode = "guided" | "list";

const PICK_MODE_KEY = "rackline.floorPickMode";

/** Guided on phones unless this browser picked a mode before. */
function initialPickMode(): PickMode {
  try {
    const saved = localStorage.getItem(PICK_MODE_KEY);
    if (saved === "guided" || saved === "list") return saved;
  } catch {
    // Storage can be blocked; fall back to the screen size.
  }
  if (typeof window === "undefined") return "list";
  return window.matchMedia?.("(max-width: 767px)").matches ? "guided" : "list";
}

function savePickMode(mode: PickMode) {
  try {
    localStorage.setItem(PICK_MODE_KEY, mode);
  } catch {
    // Remembering the mode is a convenience only.
  }
}

type StopChecks = { key: string; bay: boolean; item: boolean };

export function FloorPickPage() {
  const me = useSession();
  const confirm = useConfirm();
  const { jobs, reload: reloadJobs } = useOpenJobs("pick");
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [unpickQtys, setUnpickQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Guided mode: one stop (line at a bay) per screen.
  const [mode, setModeState] = useState<PickMode>(initialPickMode);
  const [cursor, setCursor] = useState<string | null>(null);
  const [stepQtys, setStepQtys] = useState<Record<string, string>>({});
  const [bayOverride, setBayOverride] = useState<BayOverrides>({});
  const [checks, setChecks] = useState<StopChecks | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setMode(next: PickMode) {
    setModeState(next);
    savePickMode(next);
  }

  function applyOrder(order: Order, nextLocations: Location[]) {
    setActive(order);
    setLocationId(defaultPickLocation(order, nextLocations));
    setQtys(qtyDefaults(order));
    setUnpickQtys(unpickQtyDefaults(order));
  }

  // A different order starts the guided walk from its first stop.
  const activeId = active?.id ?? null;
  useEffect(() => {
    setCursor(null);
    setStepQtys({});
    setBayOverride({});
    setChecks(null);
    setNotice(null);
  }, [activeId]);

  const stops = useMemo(() => (active ? pickStops(active.lines ?? [], locations) : []), [active, locations]);
  const index = stopIndex(stops, cursor);
  const stop: PickStop | undefined = stops[index];
  const key = stop ? stopKey(stop) : null;
  const bayId = stop ? pickBayFor(bayOverride, stop) : null;
  const guided = mode === "guided" && Boolean(active);

  async function load() {
    const [nextOrders, nextLocations] = await Promise.all([
      api<Order[]>("/api/orders"),
      api<Location[]>("/api/locations"),
    ]);
    setOrders(
      nextOrders.filter((row) => {
        const lines = row.lines ?? [];
        const stillToPick = hasUnpicked(
          lines.map((line) => ({
            lineId: line.id,
            sku: line.sku,
            qtyOrdered: line.qty,
            qtyPicked: line.qtyPicked ?? 0,
          })),
        );
        const stillToUnpick = lines.some(
          (line) =>
            remainingToUnpick({
              lineId: line.id,
              sku: line.sku,
              qtyPicked: line.qtyPicked ?? 0,
              qtyPacked: line.qtyPacked ?? 0,
            }) > 0,
        );
        return (canPickOrder(row.status) && stillToPick) || (canUnpickOrder(row.status) && stillToUnpick);
      }),
    );
    setLocations(nextLocations);
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      const match = await api<Order>(`/api/orders/${wanted}`);
      const job = jobForRef(nextJobs, "order", match.id, desiredVerb("order", match.status) ?? "pick");
      openFloorRow(match, me.user.id, job, (order) => applyOrder(order, nextLocations), setError);
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load open orders.")))
      .finally(() => setLoaded(true));
  }, []);

  /** Move the guided walk to stop `at` and mark what the scan confirmed. */
  const goToStop = useCallback(
    (at: number, confirmed: { bay?: boolean; item?: boolean }) => {
      const target = stops[at];
      if (!target) return;
      const nextKey = stopKey(target);
      setCursor(nextKey);
      setChecks((current) => {
        const base = current && current.key === nextKey ? current : { key: nextKey, bay: false, item: false };
        return { key: nextKey, bay: base.bay || Boolean(confirmed.bay), item: base.item || Boolean(confirmed.item) };
      });
    },
    [stops],
  );

  /** Guided answers for bay, SKU, serial, and lot scans. Returns false when the scan is not a guided one. */
  const guidedScan = useCallback(
    (hit: ScanHit, report?: ScanReport): boolean => {
      if (!active || stops.length === 0 || !key) return false;
      if (hit.kind === "location") {
        const result = routeGuidedScan(stops, index, { kind: "location", locationId: hit.location.id }, bayId);
        if (result.type === "bay" || result.type === "choose-bay") {
          // The picker is standing at the scanned bay, so that stop is picked from it. Scanning a
          // stop's own bay drops an earlier "Other bay" choice instead of confirming that one.
          const target = stops[result.index]!;
          setBayOverride((current) => withPickBay(current, target, hit.location.id));
          goToStop(result.index, { bay: true });
          report?.(true);
        } else {
          const expected = locationCode(locations, bayId) ?? (result.type === "wrong-bay" ? result.expected : null);
          setError(expected ? `That is ${hit.location.code}. Go to ${expected} for this pick.` : `Nothing to pick at ${hit.location.code}.`);
          report?.(false);
        }
        return true;
      }
      const skus =
        hit.kind === "item"
          ? [hit.item.sku]
          : hit.kind === "serial"
            ? [hit.serial.sku]
            : hit.kind === "lot"
              ? [...new Set(hit.onHand.map((row) => row.sku))]
              : null;
      if (!skus) return false;
      // Prefer the SKU on screen when a lot code is shared by several SKUs.
      const ordered = stop ? [...skus.filter((sku) => sku === stop.sku), ...skus.filter((sku) => sku !== stop.sku)] : skus;
      for (const sku of ordered) {
        const result = routeGuidedScan(stops, index, { kind: "item", sku });
        if (result.type !== "item") continue;
        const target = stops[result.index]!;
        if (hit.kind === "serial" && target.trackSerial) {
          setSerials((current) => ({ ...current, [target.lineId]: appendSerial(current[target.lineId] ?? "", hit.serial.serialCode) }));
        }
        if (hit.kind === "lot" && target.trackLot) {
          setLots((current) => ({ ...current, [target.lineId]: hit.lotCode }));
        }
        goToStop(result.index, { item: true });
        report?.(true);
        return true;
      }
      const label = ordered[0] ?? (hit.kind === "lot" ? `Lot ${hit.lotCode}` : "That SKU");
      const pickedAlready = (active.lines ?? []).some((line) => line.sku === label && lineRemaining(line) <= 0);
      setError(pickedAlready ? `${label} is already picked on this order.` : `${label} is not on this order.`);
      report?.(false);
      return true;
    },
    [active, stops, key, index, bayId, stop, locations, goToStop],
  );

  const onScan = useCallback(
    (raw: string, report?: ScanReport) => {
      setError(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then(async (hit) => {
          if (hit.kind === "order") {
            const order = await api<Order>(`/api/orders/${hit.order.id}`);
            const job = jobForRef(jobs, "order", order.id, desiredVerb("order", order.status) ?? "pick");
            report?.(openFloorRow(order, me.user.id, job, (next) => applyOrder(next, locations), setError));
            return;
          }
          if (guided && guidedScan(hit, report)) return;
          if (hit.kind === "location") {
            setLocationId(hit.location.id);
            report?.(true);
            return;
          }
          if (hit.kind === "item" && active) {
            const line = (active.lines ?? []).find((row) => row.itemId === hit.item.id || row.sku === hit.item.sku);
            if (!line) {
              setError(`${hit.item.sku} is not on this order.`);
              report?.(false);
              return;
            }
            if (line.suggestedLocation) setLocationId(line.suggestedLocation.locationId);
            setQtys((current) => ({ ...current, [line.id]: String(line.remaining ?? 0) }));
            report?.(true);
            return;
          }
          setError(guided && stops.length ? "Scan the bay, then the SKU." : "Scan an order, a pick bay, or a SKU on the ticket.");
          report?.(false);
        })
        .catch((err: Error) => {
          setError(err.message);
          report?.(false);
        });
    },
    [locations, active, jobs, me.user.id, guided, guidedScan, stops.length],
  );

  async function pick() {
    if (!active) return;
    setError(null);
    try {
      if (canStartPick(active.status)) {
        const started = await api<Order>(`/api/orders/${active.id}/start`, { method: "POST" });
        applyOrder(started, locations);
      }
      const lines = (active.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(qtys[line.id] || 0),
          lotCode: lots[line.id] || undefined,
          serials: serials[line.id] || undefined,
          weightGrams: parseWeightGrams(weights[line.id]),
        }))
        .filter((line) => line.qty > 0);
      const picked = await api<Order>(`/api/orders/${active.id}/pick`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      applyOrder(picked, locations);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pick failed");
    }
  }

  /** Guided: post this stop's one line at this stop's bay, starting the pick first like `pick()`. */
  async function pickStop() {
    if (!active || !stop || !key || !bayId || busy) return;
    const line = (active.lines ?? []).find((row) => row.id === stop.lineId);
    const max = line ? lineRemaining(line) : stop.qty;
    const qty = clampPickQty(stepQtys[key] ?? String(stop.qty), max);
    if (qty < 1) return;
    const after = qty >= stop.qty ? nextStopKey(stops, key) : key;
    const bayCode = locationCode(locations, bayId) ?? stop.locationCode ?? "";
    // Pin this stop first: starting the pick re-plans the stops, and a failed post should stay here.
    setCursor(key);
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (canStartPick(active.status)) {
        const started = await api<Order>(`/api/orders/${active.id}/start`, { method: "POST" });
        applyOrder(started, locations);
      }
      const body = stopPickBody({
        locationId: bayId,
        lineId: stop.lineId,
        qty,
        lotCode: lots[stop.lineId],
        serials: serials[stop.lineId],
        weightGrams: parseWeightGrams(weights[stop.lineId]),
      });
      const picked = await api<Order>(`/api/orders/${active.id}/pick`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setStepQtys((current) => withoutKey(current, key));
      setLots((current) => withoutKey(current, stop.lineId));
      setSerials((current) => withoutKey(current, stop.lineId));
      setWeights((current) => withoutKey(current, stop.lineId));
      setChecks(null);
      setCursor(after);
      setNotice(`Picked ${qty} × ${stop.sku}${bayCode ? ` at ${bayCode}` : ""}.`);
      applyOrder(picked, locations);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pick failed");
    } finally {
      setBusy(false);
    }
  }

  function skipStop() {
    if (!key) return;
    setError(null);
    setNotice(null);
    setChecks(null);
    setCursor(nextStopKey(stops, key));
  }

  /**
   * Pick `target` from `nextBay` (its own bay when blank) without a scan: the Other bay list or a
   * map tap. A bay check made for the bay it had no longer holds, so it is cleared.
   */
  function moveBay(target: PickStop, nextBay: string | null) {
    if (pickBayFor(bayOverride, target) === (nextBay || target.locationId)) return;
    const targetKey = stopKey(target);
    setBayOverride((current) => withPickBay(current, target, nextBay));
    setChecks((current) => (current && current.key === targetKey ? { ...current, bay: false } : current));
  }

  function selectMapBay(nextLocationId: string) {
    if (!guided) {
      setLocationId(nextLocationId);
      return;
    }
    if (!key) return;
    const result = routeGuidedScan(stops, index, { kind: "location", locationId: nextLocationId }, bayId);
    if (result.type !== "bay" && result.type !== "choose-bay") return;
    // Same rule as a scan: tapping a stop's own bay drops an earlier "Other bay" choice.
    const target = stops[result.index]!;
    moveBay(target, nextLocationId);
    setCursor(stopKey(target));
  }

  async function unpick() {
    if (!active) return;
    setError(null);
    try {
      const lines = (active.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(unpickQtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      const next = await api<Order>(`/api/orders/${active.id}/unpick`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      applyOrder(next, locations);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unpick failed");
    }
  }

  async function cancel() {
    if (!active) return;
    setError(null);
    try {
      const next = await api<Order>(`/api/orders/${active.id}/cancel`, { method: "POST" });
      applyOrder(next, locations);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  async function confirmCancel() {
    if (!active) return;
    const ok = await confirm({
      title: `Cancel ${active.number}?`,
      body: "Picked units go back to their bay and reserved stock is released. A cancelled order cannot be reopened.",
      confirmLabel: "Cancel order",
      cancelLabel: "Keep order",
      tone: "danger",
    });
    if (ok) await cancel();
  }

  const remaining = active
    ? hasUnpicked(
        (active.lines ?? []).map((line) => ({
          lineId: line.id,
          sku: line.sku,
          qtyOrdered: line.qty,
          qtyPicked: line.qtyPicked ?? 0,
        })),
      )
    : false;
  const thisPick = Object.values(qtys).some((value) => Number(value) > 0);
  const thisUnpick = Object.values(unpickQtys).some((value) => Number(value) > 0);
  const unpickable = (active?.lines ?? []).some((line) => (line.unpickRemaining ?? 0) > 0);

  const guidedBayCode = locationCode(locations, bayId) ?? stop?.locationCode ?? null;
  const scanLabel = guided && stop ? "Scan bay or SKU" : guided && !remaining ? "Scan the next order" : "Scan order, bay, or SKU";
  const scanPlaceholder =
    guided && stop ? `${guidedBayCode ?? "Bay"} or ${stop.sku}` : "ORD-DEMO1, B-01-01, or LAMP";

  return (
    <FloorFrame
      title="Pick"
      description={
        guided
          ? "Go to the bay, scan it and the SKU, then tap Picked."
          : "Scan the order, print a pick list or open the pick map, then pick remaining qty or unpick back onto the bay."
      }
      error={error}
    >
      <FloorScanBox label={scanLabel} placeholder={scanPlaceholder} onScan={onScan} ready={loaded} />
      {!active ? (
        <ClaimList
          loading={!loaded}
          title="Open orders"
          empty="Nothing to pick."
          rows={orders}
          userId={me.user.id}
          jobFor={(row) => jobForRef(jobs, "order", row.id, desiredVerb("order", row.status) ?? "pick")}
          onOpen={(row) =>
            openFloorRow(row, me.user.id, jobForRef(jobs, "order", row.id, desiredVerb("order", row.status) ?? "pick"), (order) => {
              void api<Order>(`/api/orders/${order.id}`).then((next) => applyOrder(next, locations));
            }, setError)
          }
          render={(row) => (
            <>
              <span className="font-mono">{row.number}</span> {row.customerName} <StatusBadge status={row.status} />
            </>
          )}
        />
      ) : guided ? (
        <>
          <GuidedHeader
            order={active}
            stops={stops}
            index={index}
            mode={mode}
            onMode={setMode}
            unpickable={canUnpickOrder(active.status) && unpickable}
            cancellable={canCancelOrder(active.status)}
            onCancel={() => void confirmCancel()}
          />
          {stop && key && canPickOrder(active.status) ? (
            <GuidedStop
              key={key}
              stop={stop}
              line={(active.lines ?? []).find((row) => row.id === stop.lineId)}
              bayId={bayId}
              bayCode={guidedBayCode}
              bayAddress={bayAddress(locations, bayId)}
              overridden={Boolean(bayOverride[key])}
              locations={locations}
              checks={checks?.key === key ? checks : null}
              qty={stepQtys[key] ?? String(stop.qty)}
              onQty={(value) => setStepQtys((current) => ({ ...current, [key]: value }))}
              lot={lots[stop.lineId] ?? ""}
              onLot={(value) => setLots((current) => ({ ...current, [stop.lineId]: value }))}
              serials={serials[stop.lineId] ?? ""}
              onSerials={(value) => setSerials((current) => ({ ...current, [stop.lineId]: value }))}
              weight={weights[stop.lineId] ?? ""}
              onWeight={(value) => setWeights((current) => ({ ...current, [stop.lineId]: value }))}
              onBay={(value) => {
                setError(null);
                moveBay(stop, value || null);
              }}
              notice={notice}
              busy={busy}
              canSkip={stops.length > 1}
              onPick={() => void pickStop()}
              onSkip={skipStop}
            />
          ) : (
            <GuidedDone
              order={active}
              remaining={remaining}
              notice={notice}
              unpickable={canUnpickOrder(active.status) && unpickable}
              onList={() => setMode("list")}
            />
          )}
          {stops.length ? (
            <PickMap
              lines={active.lines ?? []}
              locations={locations}
              selectedLocationId={bayId}
              onSelectLocation={selectMapBay}
            />
          ) : null}
        </>
      ) : (
        <>
        <div className="flex justify-end">
          <PickModeToggle mode={mode} onMode={setMode} />
        </div>
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>{active.customerName}</p>
          <Link className="text-sm font-medium underline" to={`/outbound/orders/${active.id}/pick-list`}>
            Print pick list
          </Link>
          <ul className="space-y-3 text-sm">
            {(active.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="flex justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <SkuThumb sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} size="sm" />
                    <span>
                    {line.sku} × {line.qty}
                    {line.qtyPicked ? <span className="text-muted-foreground"> · picked {line.qtyPicked}</span> : null}
                    {(line.allocations ?? []).length ? (
                      <span className="block text-xs text-muted-foreground">
                        Allocated {(line.allocations ?? []).map((row) => `${row.locationCode} ×${row.qty}`).join(", ")}
                      </span>
                    ) : null}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="font-mono text-xs underline-offset-4 hover:underline"
                    onClick={() => {
                      if (line.suggestedLocation) setLocationId(line.suggestedLocation.locationId);
                    }}
                  >
                    {line.suggestedLocation ? line.suggestedLocation.locationCode : line.remaining > 0 ? "no stock" : "done"}
                  </button>
                </div>
                {line.remaining > 0 ? (
                  <Field label={`This pick (remaining ${line.remaining})`}>
                    <Input
                      type="number"
                      min={0}
                      max={line.remaining}
                      value={qtys[line.id] ?? "0"}
                      onChange={(e) => setQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                    />
                  </Field>
                ) : (
                  <p className="text-muted-foreground">Picked</p>
                )}
                {(line.unpickRemaining ?? 0) > 0 ? (
                  <Field label={`This unpick (remaining ${line.unpickRemaining})`}>
                    <Input
                      type="number"
                      min={0}
                      max={line.unpickRemaining}
                      value={unpickQtys[line.id] ?? "0"}
                      onChange={(e) => setUnpickQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                    />
                  </Field>
                ) : null}
                {line.trackLot ? (
                  <Input
                    placeholder="Lot code"
                    value={lots[line.id] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial ? (
                  <Input
                    placeholder="Serials"
                    value={serials[line.id] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  show={line.catchWeight}
                  value={weights[line.id] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.id]: value }))}
                />
              </li>
            ))}
          </ul>
          <Field label="Bay">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            {canPickOrder(active.status) && remaining ? (
              <Button disabled={!thisPick} onClick={() => void pick()}>
                Pick from bay
              </Button>
            ) : null}
            {canUnpickOrder(active.status) && unpickable ? (
              <Button variant="secondary" disabled={!thisUnpick} onClick={() => void unpick()}>
                Unpick to bay
              </Button>
            ) : null}
            {canCancelOrder(active.status) ? (
              <Button variant="secondary" onClick={() => void cancel()}>
                Cancel order
              </Button>
            ) : null}
            {!remaining && !unpickable ? (
              <div className="flex flex-wrap gap-4">
                <Link className="font-medium underline" to={`/floor/pack?id=${active.id}`}>
                  Go pack
                </Link>
                <Link className="font-medium underline" to={`/outbound/orders/${active.id}/pack-slip`}>
                  Pack slip
                </Link>
              </div>
            ) : null}
          </div>
        </Card>
        <PickMap
          lines={active.lines ?? []}
          locations={locations}
          selectedLocationId={locationId}
          onSelectLocation={setLocationId}
        />
        </>
      )}
    </FloorFrame>
  );
}

function PickModeToggle({ mode, onMode }: { mode: PickMode; onMode: (mode: PickMode) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={mode}
      onValueChange={(value) => {
        if (value === "guided" || value === "list") onMode(value);
      }}
      aria-label="Pick view"
      className="shrink-0"
    >
      <ToggleGroupItem value="guided" className="h-11 px-3 text-sm">
        Guided
      </ToggleGroupItem>
      <ToggleGroupItem value="list" className="h-11 px-3 text-sm">
        List
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function GuidedHeader({
  order,
  stops,
  index,
  mode,
  onMode,
  unpickable,
  cancellable,
  onCancel,
}: {
  order: Order;
  stops: PickStop[];
  index: number;
  mode: PickMode;
  onMode: (mode: PickMode) => void;
  unpickable: boolean;
  cancellable: boolean;
  onCancel: () => void;
}) {
  const lines = order.lines ?? [];
  const progress = stopProgress(lines);
  const counter = stopCounter(lines, stops, index);
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <section aria-label={`Order ${order.number}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate font-mono text-xl font-semibold leading-tight">{order.number}</h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <PickModeToggle mode={mode} onMode={onMode} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <UiButton type="button" variant="outline" className="size-11 p-0" aria-label="More pick actions">
                <MoreHorizontal className="size-5" />
              </UiButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem asChild className="min-h-11 cursor-pointer">
                <Link to={`/outbound/orders/${order.id}/pick-list`}>
                  <Printer />
                  Print pick list
                </Link>
              </DropdownMenuItem>
              {unpickable ? (
                <DropdownMenuItem className="min-h-11 cursor-pointer" onSelect={() => onMode("list")}>
                  <Undo2 />
                  Unpick in list view
                </DropdownMenuItem>
              ) : null}
              {cancellable ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    className="min-h-11 cursor-pointer"
                    // Let the menu close before the confirm dialog takes focus.
                    onSelect={() => window.setTimeout(onCancel, 0)}
                  >
                    <XCircle />
                    Cancel order
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <span className="truncate">{order.customerName}</span>
            <StatusBadge status={order.status} />
          </p>
          <p className="shrink-0 font-semibold" aria-live="polite">
            {stops.length ? `Stop ${counter.current} of ${counter.total}` : "All stops picked"}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Lines picked"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-valuetext={`${progress.done} of ${progress.total} ${progress.total === 1 ? "line" : "lines"} picked`}
          title={`${progress.done} of ${progress.total} ${progress.total === 1 ? "line" : "lines"} picked`}
          className="h-2.5 w-full overflow-hidden rounded-full bg-primary/15"
        >
          <div
            className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </section>
  );
}

/** "Scan bay" until the scan lands, then "Bay scanned" with a check. */
function CheckChip({ done, todo, doneLabel }: { done: boolean; todo: string; doneLabel: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium",
        done
          ? "border-transparent bg-tone-success-bg text-tone-success"
          : "border-dashed border-border text-muted-foreground",
      )}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : null}
      {done ? doneLabel : todo}
    </span>
  );
}

function GuidedStop({
  stop,
  line,
  bayId,
  bayCode,
  bayAddress: address,
  overridden,
  locations,
  checks,
  qty,
  onQty,
  lot,
  onLot,
  serials,
  onSerials,
  weight,
  onWeight,
  onBay,
  notice,
  busy,
  canSkip,
  onPick,
  onSkip,
}: {
  stop: PickStop;
  line: OrderLine | undefined;
  bayId: string | null;
  bayCode: string | null;
  bayAddress: string | null;
  overridden: boolean;
  locations: Location[];
  checks: StopChecks | null;
  qty: string;
  onQty: (value: string) => void;
  lot: string;
  onLot: (value: string) => void;
  serials: string;
  onSerials: (value: string) => void;
  weight: string;
  onWeight: (value: string) => void;
  onBay: (locationId: string) => void;
  notice: string | null;
  busy: boolean;
  canSkip: boolean;
  onPick: () => void;
  onSkip: () => void;
}) {
  const max = line ? lineRemaining(line) : stop.qty;
  const count = clampPickQty(qty, max);
  const [otherBay, setOtherBay] = useState(!stop.locationId);
  const canPick = Boolean(bayId) && count >= 1 && !busy;
  const qtyLabelId = `pick-qty-${stop.lineId}`;

  return (
    <Card className="space-y-4">
      {notice ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-tone-success" role="status">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {notice}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          {bayCode ? (
            <h3 className="min-w-0 break-all text-4xl font-semibold leading-none tracking-tight">
              <span className="mr-2 align-middle text-base font-medium tracking-normal text-muted-foreground">Go to</span>{" "}
              <span className="font-mono">{bayCode}</span>
            </h3>
          ) : (
            <h3 className="text-xl font-semibold leading-tight">No bay for this SKU</h3>
          )}
          {bayId ? <CheckChip done={Boolean(checks?.bay)} todo="Scan bay" doneLabel="Bay scanned" /> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {bayCode ? (
            <>
              {address}
              {overridden && stop.locationCode ? (
                <span className="whitespace-nowrap">
                  {address ? " · " : ""}changed from {stop.locationCode}
                </span>
              ) : null}
            </>
          ) : (
            "Nothing is reserved or stocked at a pick face. Scan the bay you pick from."
          )}
        </p>
      </div>

      <div className="flex items-start gap-3 border-t pt-4">
        <SkuThumb sku={stop.sku} name={stop.itemName} imageUrl={stop.imageUrl} size="lg" className="size-24 text-base" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pick</p>
            <CheckChip done={Boolean(checks?.item)} todo="Scan SKU" doneLabel="SKU scanned" />
          </div>
          <p className="text-3xl font-semibold leading-none tracking-tight">
            {stop.qty} <span className="text-muted-foreground">×</span> <span className="break-all font-mono">{stop.sku}</span>
          </p>
          <p className="text-base leading-snug">{stop.itemName}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium" id={qtyLabelId}>
          Qty{max > stop.qty ? <span className="font-normal text-muted-foreground"> · {max} left on the line</span> : null}
        </p>
        <div className="flex items-center gap-2 sm:max-w-sm" role="group" aria-labelledby={qtyLabelId}>
          <Button
            variant="outline"
            className="size-14 shrink-0 p-0"
            aria-label="One less"
            disabled={count <= 1}
            onClick={() => onQty(String(Math.max(1, count - 1)))}
          >
            <Minus className="size-6" />
          </Button>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            aria-label="Qty to pick"
            className="h-14 min-w-0 flex-1 text-center font-mono text-2xl md:text-2xl"
            value={qty}
            onChange={(e) => onQty(e.target.value)}
            onBlur={() => onQty(String(Math.max(Math.min(1, max), clampPickQty(qty, max))))}
          />
          <Button
            variant="outline"
            className="size-14 shrink-0 p-0"
            aria-label="One more"
            disabled={count >= max}
            onClick={() => onQty(String(Math.min(max, count + 1)))}
          >
            <Plus className="size-6" />
          </Button>
        </div>
      </div>

      {stop.trackLot ? (
        <Field label="Lot code">
          <Input className="h-12 text-base" placeholder="Scan or type the lot" value={lot} onChange={(e) => onLot(e.target.value)} />
        </Field>
      ) : null}
      {stop.trackSerial ? (
        <Field label={count === 1 ? "Serial" : `Serials · ${count}`}>
          <Input
            className="h-12 text-base"
            placeholder={count === 1 ? "Scan the serial" : "Scan each serial"}
            value={serials}
            onChange={(e) => onSerials(e.target.value)}
          />
        </Field>
      ) : null}
      {stop.catchWeight ? (
        <Field label="Weight (g)">
          <CatchWeightInput show className="h-12 text-base" value={weight} onChange={onWeight} />
        </Field>
      ) : null}

      {/* Stays in reach above the phone tab bar while the fields above scroll. */}
      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-(--density-gap) bg-card px-(--density-gap) py-2 shadow-[0_-10px_12px_-12px_rgb(0_0_0/0.35)] md:bottom-0">
        <Button className="h-14 w-full text-lg" disabled={!canPick} onClick={onPick}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
          {bayId ? `Picked ${count}` : "Choose a bay first"}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" className="h-11 flex-1" disabled={!canSkip || busy} onClick={onSkip}>
          <SkipForward className="size-4" />
          Skip
        </Button>
        <UiButton
          type="button"
          variant="ghost"
          className="h-11 flex-1"
          aria-expanded={otherBay}
          onClick={() => setOtherBay((open) => !open)}
        >
          <MapPin className="size-4" />
          {otherBay ? "Hide bays" : "Other bay"}
        </UiButton>
      </div>
      {otherBay ? (
        <Field label="Pick from">
          <Select className="h-12 text-base" value={bayId ?? ""} onChange={(e) => onBay(e.target.value)}>
            {bayId ? null : <option value="">Choose a bay</option>}
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} — {location.name}
                {location.id === stop.locationId ? " (suggested)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </Card>
  );
}

function GuidedDone({
  order,
  remaining,
  notice,
  unpickable,
  onList,
}: {
  order: Order;
  remaining: boolean;
  notice: string | null;
  unpickable: boolean;
  onList: () => void;
}) {
  if (remaining && !canPickOrder(order.status)) {
    return (
      <Card className="space-y-3">
        <p className="text-lg font-semibold">This order is not open for picking.</p>
        <p className="text-sm text-muted-foreground">Open the list view to see each line.</p>
        <Button variant="outline" className="h-11 w-full" onClick={onList}>
          <ListChecks className="size-4" />
          Open list view
        </Button>
      </Card>
    );
  }
  return (
    <Card className="space-y-4 text-center">
      {notice ? (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
      <CheckCircle2 className="mx-auto size-12 text-tone-success" aria-hidden />
      <div className="space-y-1">
        <p className="text-xl font-semibold">{order.number} is picked</p>
        <p className="text-sm text-muted-foreground">Take it to packing.</p>
      </div>
      <Button asChild className="h-14 w-full text-lg">
        <Link to={`/floor/pack?id=${order.id}`}>Go pack</Link>
      </Button>
      <Button asChild variant="outline" className="h-11 w-full">
        <Link to={`/outbound/orders/${order.id}/pack-slip`}>
          <Printer className="size-4" />
          Pack slip
        </Link>
      </Button>
      {unpickable ? (
        <UiButton type="button" variant="ghost" className="h-11 w-full" onClick={onList}>
          <Undo2 className="size-4" />
          Put something back
        </UiButton>
      ) : null}
    </Card>
  );
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function locationCode(locations: Location[], id: string | null | undefined): string | null {
  if (!id) return null;
  return locations.find((row) => row.id === id)?.code ?? null;
}

function bayAddress(locations: Location[], id: string | null | undefined): string | null {
  if (!id) return null;
  const location = locations.find((row) => row.id === id);
  if (!location) return null;
  if (!location.aisle && !location.rack && !location.bay) return location.name || null;
  return formatLocationAddress(location);
}

function qtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.remaining ?? 0)]));
}

function unpickQtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.unpickRemaining ?? 0)]));
}

function defaultPickLocation(order: Order, locations: Location[]): string {
  const remaining = (order.lines ?? []).find((line) => (line.remaining ?? 0) > 0);
  return (
    remaining?.suggestedLocation?.locationId ||
    order.pickLocationId ||
    locations.find((row) => row.slotRole === "pick")?.id ||
    locations.find((row) => row.type === "storage")?.id ||
    locations[0]?.id ||
    ""
  );
}
