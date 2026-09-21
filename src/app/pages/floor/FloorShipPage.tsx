import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  type CarrierHub,
  type CarrierRate,
  type CarrierServiceOption,
  type Order,
  type ScanHit,
  type ShippingLabel,
} from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { DocumentActionGrid } from "../../components/document";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow } from "./floor-ui";
import { canShipOrder, canShipCartonOrder } from "@/domain/status";
import { canShipLabeledCarton, cartonShipGate, hasShippableCarton } from "@/domain/cartons";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

function shippableOrder(order: Order): boolean {
  const packages = (order.packages ?? []).map((pkg) => ({
    units: pkg.units ?? 0,
    trackingNumber: pkg.trackingNumber ?? null,
    shippedAt: pkg.shippedAt ?? null,
  }));
  return canShipOrder(order.status) || (canShipCartonOrder(order.status) && hasShippableCarton(packages));
}

export function FloorShipPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("ship");
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
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
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "order") {
          void api<Order>(`/api/orders/${hit.order.id}`).then((order) =>
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
        } else setError("Scan a packing or packed order.");
      })
      .catch((err: Error) => setError(err.message));
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
      setError(err instanceof Error ? err.message : "Ship failed");
    }
  }

  const serviceOptions = services.length
    ? services
    : [{ id: "rackline_ground", company: "Rackline", service: "Ground", connectionId: null, provider: "rackline" }];

  return (
    <FloorFrame title="Ship" description="Scan a packing or packed order, ship one labeled carton, or close the ticket when every packed unit is in a shipped box." error={error}>
      <FloorScanBox label="Scan packing or packed order" placeholder="ORD-…" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <ClaimList
          title="Ready to ship"
          empty="Nothing packed yet."
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
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
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
                        className="w-full"
                        size="sm"
                        onClick={() =>
                          void api<Order>(`/api/orders/${active.id}/packages/${pkg.id}/ship`, { method: "POST" })
                            .then((next) => {
                              setActive(next);
                              setDone(
                                `${pkg.number} shipped${next.status === "shipped" ? `. ${next.number} closed.` : ". Ticket stays open."}`,
                              );
                            })
                            .catch((err: Error) => setError(err.message))
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
                            size="sm"
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
                                .catch((err: Error) => setError(err.message))
                            }
                          >
                            Buy
                          </Button>
                        ) : null}
                        {canPrint ? (
                          <Button variant="secondary" size="sm" asChild>
                            <Link to={`/outbound/orders/${active.id}/packages/${pkg.id}/shipping-label`}>Print</Link>
                          </Button>
                        ) : null}
                        {canVoid ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              void api<Order>(`/api/orders/${active.id}/packages/${pkg.id}/label/void`, { method: "POST" })
                                .then((next) => {
                                  setActive(next);
                                  setDone(`${pkg.number} voided.`);
                                })
                                .catch((err: Error) => setError(err.message))
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
            <Select value={carrierService} onChange={(e) => setCarrierService(e.target.value)}>
              {serviceOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.company} {row.service}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tracking number">
            <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
          </Field>
          <Field label="Carrier">
            <Input value={trackingCompany} onChange={(e) => setTrackingCompany(e.target.value)} placeholder="UPS, USPS…" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Weight oz">
              <Input type="number" min={1} value={weightOz} onChange={(e) => setWeightOz(e.target.value)} />
            </Field>
            <Field label="L in">
              <Input type="number" min={1} value={lengthIn} onChange={(e) => setLengthIn(e.target.value)} />
            </Field>
            <Field label="W in">
              <Input type="number" min={1} value={widthIn} onChange={(e) => setWidthIn(e.target.value)} />
            </Field>
            <Field label="H in">
              <Input type="number" min={1} value={heightIn} onChange={(e) => setHeightIn(e.target.value)} />
            </Field>
          </div>
          {active.postageCents ? (
            <p className="text-sm text-muted-foreground">Postage ${(active.postageCents / 100).toFixed(2)}</p>
          ) : null}
          {rates.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {rates.map((rate) => (
                <li key={`${rate.id}:${rate.liveRateId ?? ""}`}>
                  <button
                    type="button"
                    className="underline-offset-4 hover:underline"
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
                  size="sm"
                  className={(active.packages ?? []).length > 0 ? "col-span-2" : undefined}
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
                      .catch((err: Error) => setError(err.message))
                  }
                >
                  Shop rates
                </Button>
                {(active.packages ?? []).length === 0 ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
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
                          .catch((err: Error) => setError(err.message));
                      }}
                    >
                      Buy label
                    </Button>
                    {active.labelStatus === "purchased" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          void api<Order>(`/api/orders/${active.id}/label/void`, { method: "POST" })
                            .then((next) => {
                              setActive(next);
                              setTrackingNumber("");
                              setDone("Label voided.");
                            })
                            .catch((err: Error) => setError(err.message))
                        }
                      >
                        Void
                      </Button>
                    ) : null}
                    {trackingNumber || active.trackingNumber ? (
                      <Button variant="secondary" size="sm" asChild>
                        <Link to={`/outbound/orders/${active.id}/shipping-label`}>Print label</Link>
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </DocumentActionGrid>
              {canShipOrder(active.status) ? (
                <Button
                  className="w-full"
                  disabled={
                    !cartonShipGate({
                      packedUnits: (active.lines ?? []).reduce((sum, line) => sum + (line.qtyPacked ?? 0), 0),
                      packages: (active.packages ?? []).map((pkg) => ({
                        units: pkg.units ?? 0,
                        trackingNumber: pkg.trackingNumber ?? null,
                        shippedAt: pkg.shippedAt ?? null,
                      })),
                    }).ok
                  }
                  onClick={() => void ship()}
                >
                  {active.source === "shopify"
                    ? (active.packages ?? []).length > 0
                      ? "Ship remaining & fulfill"
                      : "Ship & fulfill"
                    : (active.packages ?? []).length > 0
                      ? "Ship remaining cartons"
                      : "Ship"}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">Ship a labeled carton. The ticket stays open until every packed unit is in a shipped box.</p>
              )}
            </div>
          )}
        </Card>
      )}
    </FloorFrame>
  );
}
