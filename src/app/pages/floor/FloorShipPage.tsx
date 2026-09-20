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
import { FloorFrame, FloorScanBox } from "./floor-ui";
import { canShipOrder } from "@/domain/status";

export function FloorShipPage() {
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCompany, setTrackingCompany] = useState("");
  const [carrierService, setCarrierService] = useState("rackline_ground");
  const [services, setServices] = useState<CarrierServiceOption[]>([]);
  const [rates, setRates] = useState<CarrierRate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const [next, hub] = await Promise.all([api<Order[]>("/api/orders"), api<CarrierHub>("/api/carriers")]);
    setOrders(next.filter((row) => canShipOrder(row.status)));
    setServices(hub.enabledServices);
    const wanted = params.get("id");
    if (wanted) {
      const found = next.find((row) => row.id === wanted) ?? (await api<Order>(`/api/orders/${wanted}`));
      setActive(found);
      setTrackingNumber(found.trackingNumber || "");
      setTrackingCompany(found.trackingCompany || "");
      setCarrierService(
        found.carrierService || hub.enabledServices.find((row) => row.isDefault)?.id || "rackline_ground",
      );
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  const onScan = useCallback((raw: string) => {
    setError(null);
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(raw)}`)
      .then((hit) => {
        if (hit.kind === "order") void api<Order>(`/api/orders/${hit.order.id}`).then(setActive);
        else setError("Scan a packed order.");
      })
      .catch((err: Error) => setError(err.message));
  }, []);

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
        }),
      });
      setActive(shipped);
      setDone(`${shipped.number} shipped.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ship failed");
    }
  }

  const serviceOptions = services.length
    ? services
    : [{ id: "rackline_ground", company: "Rackline", service: "Ground", connectionId: null, provider: "rackline" }];

  return (
    <FloorFrame title="Ship" description="Scan a packed order, shop rates, buy a label, close it out." error={error}>
      <FloorScanBox label="Scan packed order" placeholder="ORD-…" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <Card>
          <p className="mb-3 font-medium">Packed, ready to ship</p>
          <ul className="space-y-2 text-sm">
            {orders.map((row) => (
              <li key={row.id}>
                <button className="w-full text-left" onClick={() => setActive(row)}>
                  <span className="font-mono">{row.number}</span> {row.customerName} <StatusBadge status={row.status} />
                </button>
              </li>
            ))}
            {orders.length === 0 ? <li className="text-muted-foreground">Nothing packed yet.</li> : null}
          </ul>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{active.number}</h2>
            <StatusBadge status={active.status} />
          </div>
          <p>{active.customerName}</p>
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
          {rates.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {rates.map((rate) => (
                <li key={rate.id}>
                  <button
                    type="button"
                    className="underline-offset-4 hover:underline"
                    onClick={() => {
                      setCarrierService(rate.id);
                      setTrackingCompany(rate.company);
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
          {canShipOrder(active.status) ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  void api<{ rates: CarrierRate[] }>(`/api/orders/${active.id}/rates`, { method: "POST" })
                    .then((result) => setRates(result.rates))
                    .catch((err: Error) => setError(err.message))
                }
              >
                Shop rates
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void api<ShippingLabel>(`/api/orders/${active.id}/label`, {
                    method: "POST",
                    body: JSON.stringify({ carrierService, trackingNumber: trackingNumber || undefined }),
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
              {active.labelStatus === "purchased" && active.status !== "shipped" ? (
                <Button
                  variant="secondary"
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
                <Button variant="secondary" asChild>
                  <Link to={`/outbound/orders/${active.id}/shipping-label`}>Print label</Link>
                </Button>
              ) : null}
              <Button onClick={() => void ship()}>{active.source === "shopify" ? "Ship & fulfill" : "Ship"}</Button>
            </div>
          ) : (
            <p>Already shipped.</p>
          )}
        </Card>
      )}
    </FloorFrame>
  );
}
