import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Send } from "lucide-react";
import {
  api,
  errorText,
  type CarrierHub,
  type CarrierRate,
  type CarrierServiceOption,
  type Order,
  type ScanHit,
  type ShippingLabel,
} from "../../api";
import { Button, Card, DoneBanner, Field, Input, Select, StatusBadge } from "../../components/ui";
import { DocumentActionGrid } from "../../components/document";
import { Term } from "../../components/term";
import { Skeleton } from "@/components/ui/skeleton";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow, type ScanReport } from "./floor-ui";
import { canShipOrder, canShipCartonOrder, normalizeOrderStatus } from "@/domain/status";
import { canShipLabeledCarton, cartonShipGate, hasShippableCarton } from "@/domain/cartons";
import { planShortShip } from "@/domain/short-ship";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";

const textLink =
  "inline-flex min-h-11 items-center rounded-sm text-sm underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function shippableOrder(order: Order): boolean {
  const packages = (order.packages ?? []).map((pkg) => ({
    units: pkg.units ?? 0,
    trackingNumber: pkg.trackingNumber ?? null,
    shippedAt: pkg.shippedAt ?? null,
  }));
  return canShipOrder(order.status) || (canShipCartonOrder(order.status) && hasShippableCarton(packages));
}

function notShippableMessage(order: Order): string {
  const status = normalizeOrderStatus(order.status);
  if (status === "shipped") return `${order.number} is already shipped.`;
  if (status === "cancelled") return `${order.number} is cancelled.`;
  return `${order.number} is not packed yet.`;
}

export function FloorShipPage() {
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  // Same test the floor launcher uses to show the Pack tile.
  const canPack =
    (me.role === "owner" || (me.floorVerbs ?? []).includes("pack")) && (!garage || garageAllowsPath("/floor/pack"));
  const { jobs, reload: reloadJobs } = useOpenJobs("ship");
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState<Order | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCompany, setTrackingCompany] = useState("");
  const [carrierService, setCarrierService] = useState("rackline_ground");
  const [services, setServices] = useState<CarrierServiceOption[]>([]);
  const [rates, setRates] = useState<CarrierRate[]>([]);
  const [weightOz, setWeightOz] = useState("16");
  const [lengthIn, setLengthIn] = useState("12");
  const [widthIn, setWidthIn] = useState("9");
  const [heightIn, setHeightIn] = useState("6");
  const [liveRateId, setLiveRateId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const [next, hub] = await Promise.all([api<Order[]>("/api/orders"), api<CarrierHub>("/api/carriers")]);
    setOrders(next.filter(shippableOrder));
    setServices(hub.enabledServices);
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      const found = next.find((row) => row.id === wanted) ?? (await api<Order>(`/api/orders/${wanted}`));
      openFloorRow(found, me.user.id, jobForRef(nextJobs, "order", found.id, "ship"), (order) => {
        setActive(order);
        setTrackingNumber(order.trackingNumber || "");
        setTrackingCompany(order.trackingCompany || "");
        setCarrierService(
          order.carrierService || hub.enabledServices.find((row) => row.isDefault)?.id || "rackline_ground",
        );
        setWeightOz(String(order.packageWeightOz || 16));
        setLengthIn(String(order.packageLengthIn || 12));
        setWidthIn(String(order.packageWidthIn || 9));
        setHeightIn(String(order.packageHeightIn || 6));
      }, setError);
    }
  }

  useEffect(() => {
    load()
      .catch((err) => setError(errorText(err, "Could not load orders ready to ship.")))
      .finally(() => setLoaded(true));
  }, []);

  const onScan = useCallback((raw: string, report?: ScanReport) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then(async (hit) => {
        if (hit.kind === "order") {
          const order = await api<Order>(`/api/orders/${hit.order.id}`);
          // Ship only takes orders the screen can act on: a packing or packed ticket.
          if (!canShipCartonOrder(order.status)) {
            setError(notShippableMessage(order));
            report?.(false);
            return;
          }
          report?.(
            openFloorRow(order, me.user.id, jobForRef(jobs, "order", order.id, "ship"), (next) => {
              setActive(next);
              setTrackingNumber(next.trackingNumber || "");
              setTrackingCompany(next.trackingCompany || "");
              setCarrierService(next.carrierService || services.find((row) => row.isDefault)?.id || "rackline_ground");
              setWeightOz(String(next.packageWeightOz || 16));
              setLengthIn(String(next.packageLengthIn || 12));
              setWidthIn(String(next.packageWidthIn || 9));
              setHeightIn(String(next.packageHeightIn || 6));
            }, setError),
          );
          return;
        }
        setError("Scan a packing or packed order.");
        report?.(false);
      })
      .catch((err) => {
        setError(errorText(err, "That barcode did not scan. Try again."));
        report?.(false);
      });
  }, [jobs, me.user.id, services]);

  async function ship() {
    if (!active) return;
    setError(null);
    try {
      const shipped = await api<Order>(`/api/orders/${active.id}/ship`, {
        method: "POST",
        body: JSON.stringify({
          trackingNumber: trackingNumber || undefined,
          trackingCompany: trackingCompany || undefined,
          carrierService,
          liveRateId,
          weightOz: Number(weightOz),
          lengthIn: Number(lengthIn),
          widthIn: Number(widthIn),
          heightIn: Number(heightIn),
        }),
      });
      setActive(shipped);
      setDone(`${shipped.number}${shipped.status === "shipped" ? " shipped." : " carton shipped."}`);
      await load();
    } catch (err) {
      setError(errorText(err, "Could not ship the order."));
    }
  }

  async function shortShip() {
    if (!active) return;
    setError(null);
    try {
      const shipped = await api<Order>(`/api/orders/${active.id}/short-ship`, { method: "POST" });
      const child = shipped.backorders?.[0];
      setActive(shipped);
      setDone(
        child
          ? `${shipped.number} short-shipped. ${child.number} holds the remainder.`
          : `${shipped.number} short-shipped.`,
      );
      await load();
    } catch (err) {
      setError(errorText(err, "Could not short-ship the order."));
    }
  }

  // Why the main Ship button is off: cartons still to box or label.
  const shipGate = active
    ? cartonShipGate({
        packedUnits: (active.lines ?? []).reduce((sum, line) => sum + (line.qtyPacked ?? 0), 0),
        packages: (active.packages ?? []).map((pkg) => ({
          units: pkg.units ?? 0,
          trackingNumber: pkg.trackingNumber ?? null,
          shippedAt: pkg.shippedAt ?? null,
        })),
      })
    : null;
  const serviceOptions = services.length
    ? services
    : [{ id: "rackline_ground", company: "Rackline", service: "Ground", connectionId: null, provider: "rackline" }];
  const shortShipOk = active
    ? planShortShip({
        status: active.status,
        lines: (active.lines ?? []).map((line) => ({
          lineId: line.id,
          itemId: line.itemId,
          sku: line.sku,
          qty: line.qty,
          qtyPicked: line.qtyPicked ?? 0,
          qtyPacked: line.qtyPacked ?? 0,
        })),
        packages: (active.packages ?? []).map((pkg) => ({
          id: pkg.id,
          shippedAt: pkg.shippedAt,
          lines: (pkg.lines ?? []).map((line) => ({ orderLineId: line.orderLineId, qty: line.qty })),
        })),
      }).ok
    : false;

  return (
    <FloorFrame title="Ship" description="Scan a packing or packed order, ship one labeled carton, or short-ship once a carton has left." error={error}>
      <FloorScanBox label="Scan packing or packed order" placeholder="ORD-…" onScan={onScan} ready={loaded} />
      <DoneBanner>{done}</DoneBanner>
      {!active ? (
        loaded ? (
          <ClaimList
            title="Ready to ship"
            empty="Nothing packed yet."
            emptyBody="Orders show up here once they are packed."
            emptyIcon={Send}
            emptyAction={
              canPack ? (
                <Button variant="secondary" className="h-11" asChild>
                  <Link to="/floor/pack">Go pack</Link>
                </Button>
              ) : undefined
            }
            rows={orders}
            userId={me.user.id}
            jobFor={(row) => jobForRef(jobs, "order", row.id, "ship")}
            onOpen={(row) =>
              openFloorRow(
                row,
                me.user.id,
                jobForRef(jobs, "order", row.id, "ship"),
                (order) => {
                  setActive(order);
                  setTrackingNumber(order.trackingNumber || "");
                  setTrackingCompany(order.trackingCompany || "");
                  setCarrierService(order.carrierService || services.find((s) => s.isDefault)?.id || "rackline_ground");
                  setWeightOz(String(order.packageWeightOz || 16));
                  setLengthIn(String(order.packageLengthIn || 12));
                  setWidthIn(String(order.packageWidthIn || 9));
                  setHeightIn(String(order.packageHeightIn || 6));
                },
                setError,
              )
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
          <p>{active.customerName}</p>
          {(active.packages ?? []).length > 0 ? (
            <ul className="space-y-3 text-sm">
              {(active.packages ?? []).map((pkg) => {
                const canBuy = !pkg.shippedAt;
                const canVoid = pkg.labelStatus === "purchased" && !pkg.shippedAt;
                const canPrint = Boolean(pkg.trackingNumber);
                const canShip = canShipCartonOrder(active.status) && canShipLabeledCarton(pkg).ok;
                return (
                  <li key={pkg.id} className="space-y-3 rounded-lg border p-3">
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono font-medium">{pkg.number}</span>
                        <span className="flex flex-wrap justify-end gap-1">
                          {pkg.shippedAt ? <StatusBadge status="shipped" /> : null}
                          {pkg.trackerStatus ? <StatusBadge status={pkg.trackerStatus} /> : null}
                          {!pkg.shippedAt && pkg.labelStatus ? <StatusBadge status={pkg.labelStatus} /> : null}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {pkg.units ?? 0} {(pkg.units ?? 0) === 1 ? "unit" : "units"}
                        {pkg.trackingNumber ? ` · ${pkg.trackingNumber}` : " · no label"}
                      </p>
                    </div>
                    {canShip ? (
                      <Button
                        // The main action while the order is still packing; beside "Ship remaining" once packed.
                        className={canShipOrder(active.status) ? "h-11 w-full" : "h-14 w-full text-lg"}
                        onClick={() =>
                          void api<Order>(`/api/orders/${active.id}/packages/${pkg.id}/ship`, { method: "POST" })
                            .then((next) => {
                              setActive(next);
                              setDone(
                                `${pkg.number} shipped${next.status === "shipped" ? `. ${next.number} closed.` : ". Ticket stays open."}`,
                              );
                            })
                            .catch((err) => setError(errorText(err, "Could not ship the carton.")))
                        }
                      >
                        Ship carton
                      </Button>
                    ) : null}
                    {canBuy || canVoid || canPrint ? (
                      <DocumentActionGrid>
                        {canBuy ? (
                          <Button
                            variant="secondary"
                            className="h-11"
                            onClick={() =>
                              void api<ShippingLabel>(`/api/orders/${active.id}/packages/${pkg.id}/label`, {
                                method: "POST",
                                body: JSON.stringify({
                                  carrierService,
                                  trackingNumber: trackingNumber || undefined,
                                  liveRateId,
                                  weightOz: pkg.weightOz || Number(weightOz),
                                  lengthIn: pkg.lengthIn || Number(lengthIn),
                                  widthIn: pkg.widthIn || Number(widthIn),
                                  heightIn: pkg.heightIn || Number(heightIn),
                                }),
                              })
                                .then(async (label) => {
                                  setTrackingNumber(label.trackingNumber);
                                  setTrackingCompany(label.carrierCompany);
                                  setDone(`${pkg.number} ${label.trackingNumber} bought.`);
                                  const next = await api<Order>(`/api/orders/${active.id}`);
                                  setActive(next);
                                })
                                .catch((err) => setError(errorText(err, "Could not buy the label.")))
                            }
                          >
                            Buy
                          </Button>
                        ) : null}
                        {canPrint ? (
                          <Button variant="secondary" className="h-11" asChild>
                            <Link to={`/outbound/orders/${active.id}/packages/${pkg.id}/shipping-label`}>Print</Link>
                          </Button>
                        ) : null}
                        {canVoid ? (
                          <Button
                            variant="secondary"
                            className="h-11"
                            onClick={() =>
                              void api<Order>(`/api/orders/${active.id}/packages/${pkg.id}/label/void`, { method: "POST" })
                                .then((next) => {
                                  setActive(next);
                                  setDone(`${pkg.number} voided.`);
                                })
                                .catch((err) => setError(errorText(err, "Could not void the label.")))
                            }
                          >
                            Void
                          </Button>
                        ) : null}
                      </DocumentActionGrid>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <Field label="Carrier service">
            <Select className="h-11 text-base" value={carrierService} onChange={(e) => setCarrierService(e.target.value)}>
              {serviceOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.company} {row.service}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tracking number">
            <Input
              className="h-11 text-base"
              autoComplete="off"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
            />
          </Field>
          <Field label="Carrier">
            <Input
              className="h-11 text-base"
              value={trackingCompany}
              onChange={(e) => setTrackingCompany(e.target.value)}
              placeholder="UPS, USPS…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Weight oz">
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
          {active.postageCents ? (
            <p className="text-sm text-muted-foreground">Postage ${(active.postageCents / 100).toFixed(2)}</p>
          ) : null}
          {rates.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {rates.map((rate) => (
                <li key={`${rate.id}:${rate.liveRateId ?? ""}`} className="flex min-h-11 flex-wrap items-center gap-x-1">
                  <button
                    type="button"
                    className="min-h-11 rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() => {
                      setCarrierService(rate.id);
                      setTrackingCompany(rate.company);
                      setLiveRateId(rate.liveRateId || undefined);
                    }}
                  >
                    {rate.company} {rate.service}
                  </button>
                  <span className="text-muted-foreground">
                    {" "}
                    · ${(rate.amountCents / 100).toFixed(2)} · {rate.transitDays}d
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {active.status === "shipped" ? (
            <p>Already shipped.</p>
          ) : (
            <div className="space-y-2">
              <DocumentActionGrid>
                <Button
                  variant="secondary"
                  className={(active.packages ?? []).length > 0 ? "col-span-2 h-11" : "h-11"}
                  onClick={() =>
                    void api<{ rates: CarrierRate[] }>(`/api/orders/${active.id}/rates`, {
                      method: "POST",
                      body: JSON.stringify({
                        carrierService,
                        weightOz: Number(weightOz),
                        lengthIn: Number(lengthIn),
                        widthIn: Number(widthIn),
                        heightIn: Number(heightIn),
                      }),
                    })
                      .then((result) => setRates(result.rates))
                      .catch((err) => setError(errorText(err, "Could not shop rates.")))
                  }
                >
                  Shop rates
                </Button>
                {(active.packages ?? []).length === 0 ? (
                  <>
                    <Button
                      variant="secondary"
                      className="h-11"
                      onClick={() => {
                        void api<ShippingLabel>(`/api/orders/${active.id}/label`, {
                          method: "POST",
                          body: JSON.stringify({
                            carrierService,
                            trackingNumber: trackingNumber || undefined,
                            liveRateId,
                            weightOz: Number(weightOz),
                            lengthIn: Number(lengthIn),
                            widthIn: Number(widthIn),
                            heightIn: Number(heightIn),
                          }),
                        })
                          .then(async (label) => {
                            setTrackingNumber(label.trackingNumber);
                            setTrackingCompany(label.carrierCompany);
                            setDone(`${label.trackingNumber} bought.`);
                            const next = await api<Order>(`/api/orders/${active.id}`);
                            setActive(next);
                          })
                          .catch((err) => setError(errorText(err, "Could not buy the label.")));
                      }}
                    >
                      Buy label
                    </Button>
                    {active.labelStatus === "purchased" ? (
                      <Button
                        variant="secondary"
                        className="h-11"
                        onClick={() =>
                          void api<Order>(`/api/orders/${active.id}/label/void`, { method: "POST" })
                            .then((next) => {
                              setActive(next);
                              setTrackingNumber("");
                              setDone("Label voided.");
                            })
                            .catch((err) => setError(errorText(err, "Could not void the label.")))
                        }
                      >
                        Void
                      </Button>
                    ) : null}
                    {trackingNumber || active.trackingNumber ? (
                      <Button variant="secondary" className="h-11" asChild>
                        <Link to={`/outbound/orders/${active.id}/shipping-label`}>Print label</Link>
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </DocumentActionGrid>
              {canShipOrder(active.status) ? (
                <>
                  <Button className="h-14 w-full text-lg" disabled={!shipGate?.ok} onClick={() => void ship()}>
                    {active.source === "shopify"
                      ? (active.packages ?? []).length > 0
                        ? "Ship remaining & fulfill"
                        : "Ship & fulfill"
                      : (active.packages ?? []).length > 0
                        ? "Ship remaining cartons"
                        : "Ship"}
                  </Button>
                  {shipGate && !shipGate.ok ? (
                    <p className="text-sm text-muted-foreground">{shipGate.error}.</p>
                  ) : null}
                </>
              ) : shortShipOk ? (
                <p className="text-sm text-muted-foreground">
                  Ship a labeled carton. <Term id="short-ship">Short ship</Term> closes the ticket and returns the rest
                  to the bay.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Ship a labeled carton. The ticket stays open until every packed unit is in a shipped box.</p>
              )}
              {shortShipOk ? (
                <Button className="h-11 w-full" variant="secondary" onClick={() => void shortShip()}>
                  Short ship
                </Button>
              ) : null}
            </div>
          )}
          <button type="button" className={textLink} onClick={() => setActive(null)}>
            Back to list
          </button>
        </Card>
      )}
    </FloorFrame>
  );
}
