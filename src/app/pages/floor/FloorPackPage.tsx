import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Box } from "lucide-react";
import { api, errorText, type Order, type ScanHit } from "../../api";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { Term } from "../../components/term";
import { Skeleton } from "@/components/ui/skeleton";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow, type ScanReport } from "./floor-ui";
import { canPackOrder, canStartPack, canCancelOrder, normalizeOrderStatus } from "@/domain/status";
import { hasUnpacked } from "@/domain/partial-pack";
import { cartonShipGate, canUncartonOrderPackage, hasUncartoned } from "@/domain/cartons";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";

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
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [weightOz, setWeightOz] = useState("16");
  const [lengthIn, setLengthIn] = useState("12");
  const [widthIn, setWidthIn] = useState("9");
  const [heightIn, setHeightIn] = useState("6");
  const [error, setError] = useState<string | null>(null);

  function applyOrder(order: Order) {
    setActive(order);
    setQtys(packQtyDefaults(order));
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
          if (hit.kind === "item" && active) {
            const line = (active.lines ?? []).find((row) => row.itemId === hit.item.id || row.sku === hit.item.sku);
            if (!line) {
              setError(`${hit.item.sku} is not on this order.`);
              report?.(false);
              return;
            }
            if ((line.packRemaining ?? 0) <= 0) {
              setError(`${line.sku} is already packed.`);
              report?.(false);
              return;
            }
            setQtys((current) => ({ ...current, [line.id]: String(line.packRemaining ?? 0) }));
            report?.(true);
            return;
          }
          setError("Scan a picked order, then scan a SKU to pack remaining qty.");
          report?.(false);
        })
        .catch((err) => {
          setError(errorText(err, "That barcode did not scan. Try again."));
          report?.(false);
        });
    },
    [active, jobs, me.user.id],
  );

  async function pack() {
    if (!active) return;
    setError(null);
    try {
      if (canStartPack(active.status)) {
        const started = await api<Order>(`/api/orders/${active.id}/start-pack`, { method: "POST" });
        applyOrder(started);
      }
      const lines = (active.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(qtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      const packed = await api<Order>(`/api/orders/${active.id}/pack`, {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
      applyOrder(packed);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not pack the order."));
    }
  }

  async function packIntoCarton() {
    if (!active) return;
    setError(null);
    try {
      if (canStartPack(active.status)) {
        const started = await api<Order>(`/api/orders/${active.id}/start-pack`, { method: "POST" });
        applyOrder(started);
      }
      const lines = (active.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(qtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      const packed = await api<Order>(`/api/orders/${active.id}/packages`, {
        method: "POST",
        body: JSON.stringify({
          pack: true,
          lines,
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

  return (
    <FloorFrame title="Pack" description="Scan the tote, pack remaining qty into BOX-1 / BOX-2, drop a mispacked box, print a pack slip." error={error}>
      <FloorScanBox label="Scan order or SKU" placeholder="ORD-… or LAMP" onScan={onScan} />
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
                      onChange={(e) => setQtys((current) => ({ ...current, [line.id]: e.target.value }))}
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
              <Button className="h-14 w-full text-lg sm:w-auto" disabled={!thisPack} onClick={() => void pack()}>
                Pack remaining
              </Button>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*]:min-w-0 [&>*:last-child:nth-child(odd)]:col-span-2">
                <Button className="h-11" disabled={!thisPack} variant="secondary" onClick={() => void packIntoCarton()}>
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
          <button type="button" className={textLink} onClick={() => setActive(null)}>
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
