import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Printer, Scale, ScanLine, Truck, X } from "lucide-react";
import {
  api,
  ApiError,
  errorText,
  type QuickShipOutcome,
  type ShipDecisionView,
  type ShippingLabel,
  type ShipQueueOrder,
} from "../api";
import { Button, Card, Input, ToneBadge } from "../components/ui";
import { LineChips, RelativeTime } from "../components/cells";
import { refreshApi } from "../query";
import { useScanner } from "../scanner/ScannerProvider";
import { useScale } from "../scale/ScaleProvider";
import { ScaleReadout } from "../scale/ScaleWeight";
import { useScanFlash } from "./floor/floor-ui";
import { Switch } from "@/components/ui/switch";
import { markShippedReminder } from "@/domain/channels/adapter";
import { shortDay } from "@/domain/rate-choice";
import { FRESH_SCALE_WATCH, watchScale, type ScaleReading, type ScaleWatch } from "@/domain/scale-report";
import { formatOz } from "@/domain/ship-defaults";
import { matchShipScan, stationWeight, type StationWeight } from "@/domain/ship-station";
import { cn } from "@/lib/utils";
import { applySuggestedAddress, extraSuggestion } from "./AddressCheck";

const AUTO_SHIP_KEY = "rackline.shipStation.autoShip";
/** Wait for typing or a settling scale to pause before asking for a fresh decision. */
const DECIDE_DEBOUNCE_MS = 300;

type PrintResult = { ok: boolean; message: string };

type Notice = { title: string; held?: boolean; address?: boolean };

type Shipped = {
  orderId: string;
  number: string;
  trackingNumber: string | null;
  weightOz: number;
  printed: PrintResult;
  label: ShippingLabel | null;
  reminder: string | null;
};

function loadAutoShip(): boolean {
  try {
    return localStorage.getItem(AUTO_SHIP_KEY) === "1";
  } catch {
    return false;
  }
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const WEIGHT_SOURCE: Record<Extract<StationWeight, { ok: true }>["source"], string> = {
  typed: "typed",
  scale: "from the scale",
  order: "from ship weights and the box",
};

/**
 * Scan to ship: a pack slip scan brings its order up with the rule, box, and service already chosen, the scale's
 * weight fills in, and Enter (or a settled weight, when the owner turned auto-ship on) ships it and prints the label.
 */
export function ShipStation({
  orders,
  picked,
  owner,
  onClose,
  printLabel,
}: {
  /** The building's queue rows, which scans match against; undefined while the queue loads. */
  orders: ShipQueueOrder[] | undefined;
  /** The box and service picked in the queue toolbar win here too. */
  picked: { presetId?: string; carrierService?: string };
  owner: boolean;
  onClose: () => void;
  printLabel: (label: ShippingLabel) => Promise<PrintResult>;
}) {
  const scanner = useScanner();
  const scale = useScale();
  const { flash, report } = useScanFlash();
  const [scan, setScan] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [decision, setDecision] = useState<ShipDecisionView | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [shipping, setShipping] = useState(false);
  const [shipped, setShipped] = useState<Shipped | null>(null);
  const [reprinting, setReprinting] = useState(false);
  const [autoShip, setAutoShipState] = useState(loadAutoShip);
  const [recheck, setRecheck] = useState(0);
  const scanRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  // A scan made before the station opened belongs to the page it was made on.
  const handledAt = useRef(scanner.lastScan?.at ?? 0);
  const watch = useRef<ScaleWatch>(FRESH_SCALE_WATCH);
  // Enter and a settling scale can both ask to ship in the same tick.
  const busy = useRef(false);

  const current = orderId ? (orders?.find((row) => row.id === orderId) ?? null) : null;
  const open = current && current.status !== "shipped" ? current : null;
  const openId = open?.id ?? null;
  const view = open && decision?.orderId === open.id ? decision : open;
  const scaleConnected = Boolean(scale.device);
  const weight = stationWeight({
    typed,
    scale: { connected: scaleConnected, reading: scale.reading },
    computedOz: open?.parcel.weightOz ?? null,
  });
  const decideOz = weight.ok ? weight.weightOz : null;
  const autoOn = autoShip && scale.supported;

  const focusScan = useCallback(() => {
    window.requestAnimationFrame(() => scanRef.current?.focus());
  }, []);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  const handleScan = useCallback(
    (raw: string, rows: ShipQueueOrder[]) => {
      const match = matchShipScan(raw, rows);
      setScan("");
      setTyped("");
      setNotice(null);
      if (!match) {
        setOrderId(null);
        setNotice({ title: `No order ${raw} in this building's ship queue. Scan the pack slip's barcode, or type the order number.` });
        report(false);
        return;
      }
      setOrderId(match.id);
      setDecision(null);
      setDecideError(null);
      report(match.status !== "shipped");
    },
    [report],
  );

  useEffect(() => {
    if (!orders) return;
    const event = scanner.lastScan;
    if (!event || event.at === handledAt.current) return;
    handledAt.current = event.at;
    handleScan(event.raw, orders);
    focusScan();
  }, [scanner.lastScan, orders, handleScan, focusScan]);

  const { presetId, carrierService } = picked;
  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<ShipDecisionView>("/api/ship/decide", {
        method: "POST",
        body: JSON.stringify({ orderId: openId, weightOz: decideOz ?? undefined, presetId, carrierService }),
      })
        .then((next) => {
          if (cancelled) return;
          setDecision(next);
          setDecideError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setDecideError(errorText(err, "Could not check this order again. The queue's choice still shows."));
        });
    }, DECIDE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [openId, decideOz, presetId, carrierService, recheck]);

  async function ship(options: { releaseHold?: boolean; acceptAddress?: boolean; reading?: ScaleReading } = {}) {
    if (busy.current) return;
    if (!current) {
      setNotice({ title: "Scan a pack slip first." });
      report(false);
      focusScan();
      return;
    }
    if (current.status === "shipped") {
      setNotice({ title: `${current.number} already shipped.` });
      report(false);
      return;
    }
    const at = options.reading
      ? stationWeight({ typed, scale: { connected: true, reading: options.reading }, computedOz: current.parcel.weightOz ?? null })
      : weight;
    if (!at.ok) {
      setNotice(null);
      report(false);
      weightRef.current?.focus();
      return;
    }
    busy.current = true;
    setShipping(true);
    setNotice(null);
    try {
      const outcome = await api<QuickShipOutcome>(`/api/orders/${encodeURIComponent(current.id)}/quick-ship`, {
        method: "POST",
        body: JSON.stringify({
          ...picked,
          weightOz: at.weightOz,
          releaseHold: options.releaseHold || undefined,
          acceptAddress: options.acceptAddress || undefined,
        }),
      });
      report(true);
      setOrderId(null);
      setDecision(null);
      setTyped("");
      let label: ShippingLabel | null = null;
      let printed: PrintResult;
      try {
        label = await api<ShippingLabel>(`/api/orders/${encodeURIComponent(current.id)}/label`);
        printed = await printLabel(label);
      } catch (err) {
        printed = { ok: false, message: errorText(err, "The label did not load.") };
      }
      setShipped({
        orderId: current.id,
        number: current.number,
        trackingNumber: outcome.ok ? outcome.trackingNumber : null,
        weightOz: at.weightOz,
        printed,
        label,
        reminder: outcome.ok && outcome.manualPostBack ? markShippedReminder([{ number: current.number, source: current.source }]) : null,
      });
    } catch (err) {
      report(false);
      setNotice({
        title: errorText(err, "Ship did not go through. Try again."),
        held: err instanceof ApiError && err.code === "SHIP_RULE_HOLD",
        address: err instanceof ApiError && err.code === "ADDRESS_INVALID",
      });
    } finally {
      busy.current = false;
      setShipping(false);
      void refreshApi("/api/ship");
      focusScan();
    }
  }

  const shipRef = useRef(ship);
  shipRef.current = ship;
  const autoReady = useRef(false);
  autoReady.current = autoOn && Boolean(open) && !typed.trim() && !shipping;

  useEffect(() => {
    watch.current = FRESH_SCALE_WATCH;
  }, [openId, autoOn]);

  useEffect(
    () =>
      scale.subscribe((reading) => {
        const next = watchScale(watch.current, reading);
        watch.current = next.watch;
        if (next.fire && autoReady.current) void shipRef.current({ reading });
      }),
    [scale.subscribe],
  );

  function setAutoShip(next: boolean) {
    setAutoShipState(next);
    try {
      localStorage.setItem(AUTO_SHIP_KEY, next ? "1" : "0");
    } catch {
      // Private mode: the switch still holds for this visit.
    }
  }

  function submitScan(event: FormEvent) {
    event.preventDefault();
    const raw = scan.trim();
    if (raw) scanner.emitScan(raw, "typed");
    else void ship();
  }

  function submitWeight(event: FormEvent) {
    event.preventDefault();
    const raw = typed.trim();
    // A pack slip scanned while this field had focus lands here; open its order instead of reading it as a weight.
    if (raw && !/^\d*\.?\d+$/.test(raw) && orders && matchShipScan(raw, orders)) {
      scanner.emitScan(raw, "typed");
      return;
    }
    void ship();
  }

  async function reprint(label: ShippingLabel) {
    setReprinting(true);
    try {
      const printed = await printLabel(label);
      setShipped((prev) => (prev && prev.orderId === label.orderId ? { ...prev, printed } : prev));
      if (!printed.ok) setNotice({ title: `${label.orderNumber}: ${printed.message}` });
    } finally {
      setReprinting(false);
      focusScan();
    }
  }

  async function takeSuggestion(row: ShipQueueOrder, suggestion: string | null | undefined) {
    if (await applySuggestedAddress(row, suggestion)) {
      setNotice(null);
      setRecheck((count) => count + 1);
    }
    focusScan();
  }

  async function printShippedLabel(row: ShipQueueOrder) {
    try {
      await reprint(await api<ShippingLabel>(`/api/orders/${encodeURIComponent(row.id)}/label`));
    } catch (err) {
      setNotice({ title: errorText(err, "The label did not load.") });
    }
  }

  return (
    <Card data-scan-owner role="region" aria-label="Scan to ship" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="flex items-center gap-2 font-medium">
            <ScanLine className="size-4" />
            Scan to ship
          </p>
          <p className="text-sm text-muted-foreground">
            Scan a pack slip and its order comes up with the box and service chosen. Set the box on the scale, then press Enter to
            ship and print the label.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StationScale />
          {owner && scale.supported ? (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={autoShip} onCheckedChange={setAutoShip} aria-label="Auto-ship on a settled weight" />
              Auto-ship on a settled weight
            </label>
          ) : autoOn ? (
            <ToneBadge tone="info">Auto-ships on a settled weight</ToneBadge>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="size-4" />
            Close
          </Button>
        </div>
      </div>

      <form className="flex gap-2" onSubmit={submitScan}>
        <Input
          ref={scanRef}
          data-scan-capture
          aria-label="Pack slip or order number"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          className={cn(
            "h-14 text-xl transition-shadow",
            flash === "ok" && "ring-2 ring-ok",
            flash === "bad" && "ring-2 ring-destructive",
          )}
          placeholder={open ? `Enter ships ${open.number}, or scan the next slip` : "Scan a pack slip, or type an order number"}
          value={scan}
          onChange={(event) => setScan(event.target.value)}
        />
        <Button type="submit" className="h-14 min-w-28" disabled={shipping || (!scan.trim() && !open)}>
          {scan.trim() || !open ? "Open" : shipping ? "Shipping…" : "Ship"}
        </Button>
      </form>

      {!orders ? <p className="text-sm text-muted-foreground">Loading the ship queue…</p> : null}

      {current && current.status === "shipped" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>
            <span className="font-medium">{current.number}</span> shipped <RelativeTime at={current.shippedAt} />
            {current.trackingNumber ? <span className="font-mono text-xs"> · {current.trackingNumber}</span> : null}
          </span>
          <Button size="sm" variant="outline" disabled={reprinting} onClick={() => void printShippedLabel(current)}>
            <Printer className="size-4" />
            Print label
          </Button>
        </div>
      ) : null}

      {open && view ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <Link to={`/outbound/orders/${open.id}`} className="text-lg font-semibold hover:underline">
                {open.number}
              </Link>
              <span className="text-sm">{open.customerName}</span>
              <span className="text-xs text-muted-foreground">
                {[open.shipToCity, open.shipToRegion, open.shipToCountry].filter(Boolean).join(", ") || "No address"}
              </span>
            </p>
            {view.rule ? <ToneBadge tone="info">Rule: {view.rule.name}</ToneBadge> : null}
          </div>
          <LineChips lines={open.lines} />
          <div className="grid gap-3 sm:grid-cols-3">
            <StationFact label="Box">
              {view.box ? (
                <span className="flex items-center gap-1.5">
                  {view.box.name}
                  {view.box.source === "auto" ? (
                    <ToneBadge tone="info" dot={false}>
                      auto
                    </ToneBadge>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted-foreground">No box</span>
              )}
              <Why text={view.box?.source === "auto" ? null : view.box?.reason} />
              {view.box?.note ? <Why text={view.box.note} warn={view.box.tooBig} /> : null}
            </StationFact>
            <StationFact label="Service">
              <span>{view.serviceName ?? (view.quotePending ? "Quoted when shipped" : "No service")}</span>
              <Why text={[view.serviceReason, view.serviceLive ? "Live postage" : null].filter(Boolean).join(" · ")} />
              {view.quote ? (
                <Why
                  text={`${money(view.quote.amountCents)} · ${view.quote.late ? "late, " : ""}arrives ${shortDay(Number(view.quote.arrivesOn.replaceAll("-", "")))}`}
                  warn={view.quote.late}
                />
              ) : null}
            </StationFact>
            <StationFact label="Weight">
              <form onSubmit={submitWeight} className="space-y-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-lg tabular-nums">{weight.ok ? formatOz(weight.weightOz) : "—"}</span>
                  {weight.ok ? <span className="text-xs text-muted-foreground">{WEIGHT_SOURCE[weight.source]}</span> : null}
                </span>
                <Input
                  ref={weightRef}
                  data-scan-capture
                  aria-label="Type a weight in ounces"
                  inputMode="decimal"
                  autoComplete="off"
                  className="h-9 w-40"
                  placeholder={scaleConnected ? "Type to override (oz)" : "Weight (oz)"}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                />
                {weight.ok ? null : <Why text={weight.error} warn />}
              </form>
            </StationFact>
          </div>
          {view.blocker ? (
            <p className="flex items-start gap-1.5 text-sm text-tone-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {view.blocker.error}{" "}
                <Link to={`/outbound/orders/${open.id}`} className="underline">
                  Open
                </Link>
              </span>
            </p>
          ) : null}
          {extraSuggestion(view.blocker?.error, view.blocker?.suggestion) ? (
            <Why text={`Suggested: ${view.blocker?.suggestion}`} />
          ) : null}
          {decideError ? <Why text={decideError} warn /> : null}
          <div className="flex flex-wrap items-center gap-2">
            {view.blocker?.code === "SHIP_RULE_HOLD" || notice?.held ? (
              <Button variant="outline" disabled={shipping} onClick={() => void ship({ releaseHold: true })}>
                {shipping ? "Shipping…" : "Ship anyway"}
              </Button>
            ) : view.blocker?.code === "ADDRESS_INVALID" || notice?.address ? (
              <>
                {view.blocker?.suggestion ? (
                  <Button variant="outline" disabled={shipping} onClick={() => void takeSuggestion(open, view.blocker?.suggestion)}>
                    Use suggested address
                  </Button>
                ) : null}
                {owner ? (
                  <Button variant="outline" disabled={shipping} onClick={() => void ship({ acceptAddress: true })}>
                    {shipping ? "Shipping…" : "Ship anyway to this address"}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button disabled={shipping} onClick={() => void ship()}>
                <Truck className="size-4" />
                {shipping ? "Shipping…" : `Ship ${open.number}`}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {autoOn && scaleConnected
                ? "Ships by itself once the scale settles, or press Enter."
                : "Press Enter in the scan field to ship."}
            </span>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-tone-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {notice.title}
        </p>
      ) : null}

      {shipped ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 p-3 text-sm" aria-live="polite">
          <span className="flex items-start gap-1.5">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-tone-success" />
            <span>
              Shipped <span className="font-medium">{shipped.number}</span> at {formatOz(shipped.weightOz)}
              {shipped.trackingNumber ? <span className="font-mono text-xs"> · {shipped.trackingNumber}</span> : null}.{" "}
              <span className={shipped.printed.ok ? "text-muted-foreground" : "text-tone-warning"}>
                {shipped.printed.ok ? shipped.printed.message : `Label did not print: ${shipped.printed.message}`}
              </span>
              {shipped.reminder ? <span className="block text-muted-foreground">{shipped.reminder}</span> : null}
            </span>
          </span>
          {shipped.label ? (
            <Button size="sm" variant="outline" disabled={reprinting} onClick={() => void reprint(shipped.label!)}>
              <Printer className="size-4" />
              Print again
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** The scale's state for the station header: connect it, or its live weight. */
function StationScale() {
  const scale = useScale();
  if (!scale.supported) {
    return <span className="text-xs text-muted-foreground">No USB scale in this browser (Chrome or Edge on a computer). Type the weight.</span>;
  }
  if (!scale.device) {
    return (
      <span className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={scale.connecting} onClick={() => void scale.connect()}>
          <Scale className="size-4" />
          {scale.connecting ? "Connecting…" : "Connect scale"}
        </Button>
        {scale.error ? <span className="text-xs text-tone-warning">{scale.error}</span> : null}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      <Scale className="size-4 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">{scale.device}</span>
      <ScaleReadout />
      <Button size="xs" variant="ghost" onClick={() => void scale.disconnect()}>
        Disconnect
      </Button>
    </span>
  );
}

function StationFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Why({ text, warn }: { text: string | null | undefined; warn?: boolean }) {
  if (!text) return null;
  return <span className={warn ? "text-[11px] text-tone-warning" : "text-[11px] text-muted-foreground"}>{text}</span>;
}
