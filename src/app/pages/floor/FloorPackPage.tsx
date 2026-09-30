import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Box } from "lucide-react";
import { api, errorText, type Order, type ScanHit } from "../../api";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { Skeleton } from "@/components/ui/skeleton";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow, type ScanReport } from "./floor-ui";
import { canPackOrder, canStartPack, canCancelOrder, normalizeOrderStatus } from "@/domain/status";
import { hasUnpacked, packUnitScan, type PackStationLine } from "@/domain/partial-pack";
import { cartonShipGate, canUncartonOrderPackage, hasUncartoned } from "@/domain/cartons";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";
import { checkScanEvidence, countScans, workflowPolicy } from "@/domain/workflow-policy";
import { EMPTY_SCAN_LOG, afterPost, recordUnitScan, scanEvidence, type ScanLog } from "./scan-log";

const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function notPackableMessage(order: Order): string {
  const status = normalizeOrderStatus(order.status);
  if (status === "shipped") return `${order.number} is already shipped.`;
  if (status === "cancelled") return `${order.number} is cancelled.`;
  return `${order.number} is not picked yet.`;
}

export function FloorPackPage() {
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  // Same test the floor launcher uses to show the Pick tile.
  const canPick =
    (me.role === "owner" || (me.floorVerbs ?? []).includes("pick")) && (!garage || garageAllowsPath("/floor/pick"));
  const { jobs, reload: reloadJobs } = useOpenJobs("pack");
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<Order | null>(null);
  // Scans resolve out of order, so each one reads and writes the latest qtys and log through refs.
  const [qtys, setQtysState] = useState<Record<string, string>>({});
  const qtysRef = useRef(qtys);
  const setQtys = (next: Record<string, string>) => {
    qtysRef.current = next;
    setQtysState(next);
  };
  const [weightOz, setWeightOz] = useState("16");
  const [lengthIn, setLengthIn] = useState("12");
  const [widthIn, setWidthIn] = useState("9");
  const [heightIn, setHeightIn] = useState("6");
  const [error, setError] = useState<string | null>(null);
  const needScan = workflowPolicy(me.organization.operatingMode).scanVerifiedPack;
  const [scanLog, setScanLogState] = useState<ScanLog>(EMPTY_SCAN_LOG);
  const scanLogRef = useRef(scanLog);
  const setScanLog = (next: ScanLog) => {
    scanLogRef.current = next;
    setScanLogState(next);
  };

  const activeId = useRef<string | null>(null);

  function applyOrder(order: Order) {
    if (activeId.current !== order.id) setScanLog(EMPTY_SCAN_LOG);
    activeId.current = order.id;
    setActive(order);
    setQtys(needScan ? Object.fromEntries((order.lines ?? []).map((line) => [line.id, "0"])) : packQtyDefaults(order));
  }

  function closeOrder() {
    activeId.current = null;
    setActive(null);
  }

  /** What this pack posts, read before start-pack swaps in the started order. */
  function thisPackPost(order: Order) {
    const inPack = qtysRef.current;
    return {
      lines: (order.lines ?? [])
        .map((line) => ({ lineId: line.id, qty: Number(inPack[line.id] || 0) }))
        .filter((line) => line.qty > 0),
      scan: scanEvidence(scanLogRef.current),
    };
  }

  async function load() {
    const next = await api<Order[]>("/api/orders");
    setOrders(
      next.filter(
        (row) =>
          canPackOrder(row.status) &&
          hasUnpacked(
            (row.lines ?? []).map((line) => ({
              lineId: line.id,
              sku: line.sku,
              qtyPicked: line.qtyPicked ?? 0,
              qtyPacked: line.qtyPacked ?? 0,
            })),
          ),
      ),
    );
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      const match = next.find((row) => row.id === wanted) ?? (await api<Order>(`/api/orders/${wanted}`));
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "order", match.id, "pack"), applyOrder, setError);
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load orders ready to pack.")))
      .finally(() => setLoaded(true));
  }, []);

  const onScan = useCallback(
    (raw: string, report?: ScanReport) => {
      setError(null);
      api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
        .then(async (hit) => {
          if (hit.kind === "order") {
            const order = await api<Order>(`/api/orders/${hit.order.id}`);
            // Pack takes picked or packing tickets, plus packed ones that may still need a carton boxed or dropped.
            if (!canPackOrder(order.status) && normalizeOrderStatus(order.status) !== "packed") {
              setError(notPackableMessage(order));
              report?.(false);
              return;
            }
            report?.(openFloorRow(order, me.user.id, jobForRef(jobs, "order", order.id, "pack"), applyOrder, setError));
            return;
          }
          const unit = active ? scannedUnit(hit, active) : null;
          if (!active || !unit) {
            setError(
              needScan
                ? "Scan a picked order, then scan each unit as it goes in the box."
                : "Scan a picked order, then scan a SKU to pack remaining qty.",
            );
            report?.(false);
            return;
          }
          if ("problem" in unit) {
            setError(unit.problem);
            report?.(false);
            return;
          }
          const log = scanLogRef.current;
          if (needScan && unit.serial && log.serials.includes(unit.serial)) {
            setError(`Serial ${unit.serial} is already scanned for this pack.`);
            report?.(false);
            return;
          }
          const lines = packStationLines(active, needScan ? qtysRef.current : {});
          const result = packUnitScan(lines, unit, needScan ? countScans(log.skus, { sku: unit.sku, barcode: null }) : 0);
          if (!result.ok) {
            setError(result.problem);
            report?.(false);
            return;
          }
          if (needScan) {
            setScanLog(recordUnitScan(log, unit));
            if (result.add) setQtys({ ...qtysRef.current, [result.add.lineId]: String(result.add.qty) });
          } else if (result.add) {
            const lineId = result.add.lineId;
            const line = lines.find((row) => row.lineId === lineId);
            setQtys({ ...qtysRef.current, [lineId]: String(line?.remaining ?? 0) });
          }
          report?.(true);
        })
        .catch((err) => {
          setError(errorText(err, "That barcode did not scan. Try again."));
          report?.(false);
        });
    },
    [active, jobs, me.user.id, needScan],
  );

  async function pack() {
    if (!active) return;
    setError(null);
    const post = thisPackPost(active);
    try {
      if (canStartPack(active.status)) {
        setActive(await api<Order>(`/api/orders/${active.id}/start-pack`, { method: "POST" }));
      }
      const packed = await api<Order>(`/api/orders/${active.id}/pack`, {
        method: "POST",
        body: JSON.stringify(post),
      });
      setScanLog(afterPost(scanLogRef.current));
      applyOrder(packed);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not pack the order."));
    }
  }

  async function packIntoCarton() {
    if (!active) return;
    setError(null);
    const post = thisPackPost(active);
    try {
      if (canStartPack(active.status)) {
        setActive(await api<Order>(`/api/orders/${active.id}/start-pack`, { method: "POST" }));
      }
      const packed = await api<Order>(`/api/orders/${active.id}/packages`, {
        method: "POST",
        body: JSON.stringify({
          pack: true,
          ...post,
          weightOz: Number(weightOz),
          lengthIn: Number(lengthIn),
          widthIn: Number(widthIn),
          heightIn: Number(heightIn),
        }),
      });
      setScanLog(afterPost(scanLogRef.current));
      applyOrder(packed);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not box the carton."));
    }
  }

  async function addCarton() {
    if (!active) return;
    setError(null);
    try {
      const packed = await api<Order>(`/api/orders/${active.id}/packages`, {
        method: "POST",
        body: JSON.stringify({
          weightOz: Number(weightOz),
          lengthIn: Number(lengthIn),
          widthIn: Number(widthIn),
          heightIn: Number(heightIn),
        }),
      });
      applyOrder(packed);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not box the carton."));
    }
  }

  async function uncarton(pkgId: string) {
    if (!active) return;
    setError(null);
    try {
      const next = await api<Order>(`/api/orders/${active.id}/packages/${pkgId}/uncarton`, { method: "POST" });
      applyOrder(next);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not drop the carton."));
    }
  }

  async function cancel() {
    if (!active) return;
    setError(null);
    try {
      const next = await api<Order>(`/api/orders/${active.id}/cancel`, { method: "POST" });
      applyOrder(next);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not cancel the order."));
    }
  }

  const remaining =
    active &&
    hasUnpacked(
      (active.lines ?? []).map((line) => ({
        lineId: line.id,
        sku: line.sku,
        qtyPicked: line.qtyPicked ?? 0,
        qtyPacked: line.qtyPacked ?? 0,
      })),
    );
  const uncartoned =
    active &&
    hasUncartoned(
      (active.lines ?? []).map((line) => ({
        lineId: line.id,
        sku: line.sku,
        qtyPacked: line.qtyPacked ?? 0,
        qtyCartoned: line.qtyCartoned ?? 0,
      })),
    );
  const thisPack = Object.values(qtys).some((value) => Number(value) > 0);
  const scanProblem =
    needScan && active && thisPack
      ? checkScanEvidence(
          (active.lines ?? []).map((line) => ({ lineId: line.id, qty: Number(qtys[line.id] || 0), sku: line.sku, barcode: line.barcode ?? null })),
          scanEvidence(scanLog),
          { perUnit: true },
        )
      : null;

  return (
    <FloorFrame title="Pack" description="Scan the tote, pack remaining qty into BOX-1 / BOX-2, drop a mispacked box, print a pack slip." error={error}>
      <FloorScanBox label="Scan order or SKU" placeholder="ORD-… or LAMP" onScan={onScan} ready={loaded} />
      {!active ? (
        loaded ? (
          <ClaimList
            title="Ready to pack"
            empty="Nothing to pack."
            emptyBody="Orders show up here once they are picked."
            emptyIcon={Box}
            emptyAction={
              canPick ? (
                <Button variant="secondary" className="h-11" asChild>
                  <Link to="/floor/pick">Go pick</Link>
                </Button>
              ) : undefined
            }
            rows={orders}
            userId={me.user.id}
            jobFor={(row) => jobForRef(jobs, "order", row.id, "pack")}
            onOpen={(row) =>
              openFloorRow(row, me.user.id, jobForRef(jobs, "order", row.id, "pack"), (order) => {
                api<Order>(`/api/orders/${order.id}`)
                  .then(applyOrder)
                  .catch((err) => setError(errorText(err, "Could not open that order.")));
              }, setError)
            }
            render={(row) => (
              <>
                <span className="font-mono">{row.number}</span> {row.customerName} <StatusBadge status={row.status} />
              </>
            )}
          />
        ) : (
          <Skeleton className="h-40 w-full rounded-xl motion-reduce:animate-none" />
        )
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <ul className="space-y-3 text-sm">
            {(active.lines ?? []).map((line) => (
              <li key={line.id} className="space-y-2">
                <div className="flex justify-between gap-3">
                  <span>
                    {line.sku} × {line.qty}
                    <span className="text-muted-foreground">
                      {" "}
                      · picked {line.qtyPicked ?? 0} · packed {line.qtyPacked ?? 0}
                      {(line.qtyCartoned ?? 0) > 0 ? ` · boxed ${line.qtyCartoned}` : ""}
                    </span>
                  </span>
                </div>
                {(line.packRemaining ?? 0) > 0 ? (
                  <Field label={`This pack (remaining ${line.packRemaining})`}>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={line.packRemaining}
                      className="h-11 text-base"
                      value={qtys[line.id] ?? "0"}
                      onChange={(e) => setQtys({ ...qtysRef.current, [line.id]: e.target.value })}
                    />
                  </Field>
                ) : (
                  <p className="text-muted-foreground">Packed</p>
                )}
              </li>
            ))}
          </ul>
          {canPackOrder(active.status) && remaining ? (
            <div className="space-y-2">
              <Button className="h-14 w-full text-lg sm:w-auto" disabled={!thisPack || Boolean(scanProblem)} onClick={() => void pack()}>
                {needScan ? "Pack scanned" : "Pack remaining"}
              </Button>
              {scanProblem ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {scanProblem}.
                </p>
              ) : needScan && !thisPack ? (
                <p className="text-sm text-muted-foreground">Scan each unit as it goes in the box. Every scan adds one.</p>
              ) : null}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*]:min-w-0 [&>*:last-child:nth-child(odd)]:col-span-2">
                <Button className="h-11" disabled={!thisPack || Boolean(scanProblem)} variant="secondary" onClick={() => void packIntoCarton()}>
                  Pack into carton
                </Button>
                {uncartoned ? (
                  <Button className="h-11" variant="secondary" onClick={() => void addCarton()}>
                    Box remaining
                  </Button>
                ) : null}
                {canCancelOrder(active.status) ? (
                  <Button className="h-11" variant="secondary" onClick={() => void cancel()}>
                    Cancel order
                  </Button>
                ) : null}
              </div>
              <Link className={`${textLink} font-medium`} to={`/outbound/orders/${active.id}/pack-slip`}>
                Print pack slip
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {uncartoned ? (
                <Button className="h-14 w-full text-lg sm:w-auto" onClick={() => void addCarton()}>
                  Box remaining
                </Button>
              ) : null}
              <div className="flex flex-wrap gap-x-5">
                <Link className={`${textLink} font-medium`} to={`/floor/ship?id=${active.id}`}>
                  Go ship
                </Link>
                <Link className={`${textLink} font-medium`} to={`/outbound/orders/${active.id}/pack-slip`}>
                  Pack slip
                </Link>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Carton weight oz">
              <Input
                type="number"
                inputMode="decimal"
                min={1}
                className="h-11 text-base"
                value={weightOz}
                onChange={(e) => setWeightOz(e.target.value)}
              />
            </Field>
            <Field label="L in">
              <Input
                type="number"
                inputMode="decimal"
                min={1}
                className="h-11 text-base"
                value={lengthIn}
                onChange={(e) => setLengthIn(e.target.value)}
              />
            </Field>
            <Field label="W in">
              <Input
                type="number"
                inputMode="decimal"
                min={1}
                className="h-11 text-base"
                value={widthIn}
                onChange={(e) => setWidthIn(e.target.value)}
              />
            </Field>
            <Field label="H in">
              <Input
                type="number"
                inputMode="decimal"
                min={1}
                className="h-11 text-base"
                value={heightIn}
                onChange={(e) => setHeightIn(e.target.value)}
              />
            </Field>
          </div>
          {(active.packages ?? []).length > 0 ? (
            <ul className="space-y-3 text-sm">
              {(active.packages ?? []).map((pkg) => (
                <li key={pkg.id} className="space-y-3 rounded-lg border p-3">
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono font-medium">{pkg.number}</span>
                      {pkg.shippedAt ? <StatusBadge status="shipped" /> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {pkg.units ?? 0} {(pkg.units ?? 0) === 1 ? "unit" : "units"}
                      {pkg.trackingNumber ? ` · ${pkg.trackingNumber}` : " · no label"}
                    </p>
                  </div>
                  {canUncartonOrderPackage({ status: active.status, shippedAt: pkg.shippedAt }).ok ? (
                    <Button variant="secondary" className="h-11 w-full" onClick={() => void uncarton(pkg.id)}>
                      Drop carton
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Term id="carton">Cartons</Term> are optional until the first box. After BOX-1 exists, every packed unit
              needs a labeled carton before ship.
            </p>
          )}
          {active.status === "packed" &&
          cartonShipGate({
            packedUnits: (active.lines ?? []).reduce((sum, line) => sum + (line.qtyPacked ?? 0), 0),
            packages: (active.packages ?? []).map((pkg) => ({
              units: pkg.units ?? 0,
              trackingNumber: pkg.trackingNumber ?? null,
              shippedAt: pkg.shippedAt ?? null,
            })),
          }).ok === false ? (
            <p className="text-sm text-muted-foreground">Label each carton on Ship before closing the order.</p>
          ) : null}
          <button type="button" className={textLink} onClick={closeOrder}>
            Back to list
          </button>
        </Card>
      )}
    </FloorFrame>
  );
}

function packQtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.packRemaining ?? 0)]));
}

type PackUnit = { itemId: string; sku: string; serial?: string };

/** The unit an item, serial, or lot scan names on this order. Null when the scan names no unit. */
function scannedUnit(hit: ScanHit, order: Order): PackUnit | { problem: string } | null {
  if (hit.kind === "item") return { itemId: hit.item.id, sku: hit.item.sku };
  if (hit.kind === "serial") return { itemId: hit.serial.itemId, sku: hit.serial.sku, serial: hit.serial.serialCode };
  if (hit.kind !== "lot") return null;
  const onOrder = new Map<string, PackUnit>();
  for (const row of hit.onHand) {
    if ((order.lines ?? []).some((line) => line.itemId === row.itemId)) onOrder.set(row.itemId, { itemId: row.itemId, sku: row.sku });
  }
  const units = [...onOrder.values()];
  if (units.length === 1) return units[0]!;
  if (units.length > 1) return { problem: `Lot ${hit.lotCode} holds more than one SKU on this order. Scan the SKU instead.` };
  return { problem: hit.onHand.length ? `Lot ${hit.lotCode} is not on this order.` : `Scan the SKU for lot ${hit.lotCode}.` };
}

function packStationLines(order: Order, inPack: Record<string, string>): PackStationLine[] {
  return (order.lines ?? []).map((line) => {
    const qty = Math.floor(Number(inPack[line.id]));
    return {
      lineId: line.id,
      itemId: line.itemId,
      sku: line.sku,
      remaining: line.packRemaining ?? 0,
      inPack: Number.isFinite(qty) && qty > 0 ? qty : 0,
    };
  });
}
