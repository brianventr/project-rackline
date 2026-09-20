import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type Order, type ScanHit, type ShippingLabel } from "../../api";
import { Button, Card, Field, Input, Select, StatusBadge } from "../../components/ui";
import { ClaimList, FloorFrame, FloorScanBox, openFloorRow } from "./floor-ui";
import { canShipOrder } from "@/domain/status";
import { useSession } from "../../session";
import { jobForRef, useOpenJobs } from "../../jobs";

export function FloorShipPage() {
  const me = useSession();
  const { jobs, reload: reloadJobs } = useOpenJobs("ship");
  const [params] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCompany, setTrackingCompany] = useState("");
  const [carrierService, setCarrierService] = useState("rackline_ground");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    const next = await api<Order[]>("/api/orders");
    setOrders(next.filter((row) => canShipOrder(row.status)));
    const nextJobs = await reloadJobs();
    const wanted = params.get("id");
    if (wanted) {
      const match = next.find((row) => row.id === wanted) ?? (await api<Order>(`/api/orders/${wanted}`));
      openFloorRow(match, me.user.id, jobForRef(nextJobs, "order", match.id, "ship"), setActive, setError);
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
            openFloorRow(order, me.user.id, jobForRef(jobs, "order", order.id, "ship"), setActive, setError),
          );
        } else setError("Scan a packed order.");
      })
      .catch((err: Error) => setError(err.message));
  }, [jobs, me.user.id]);

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

  return (
    <FloorFrame title="Ship" description="Scan a packed order, add tracking, close it out." error={error}>
      <FloorScanBox label="Scan packed order" placeholder="ORD-…" onScan={onScan} />
      {done ? <p className="text-sm text-emerald-700">{done}</p> : null}
      {!active ? (
        <ClaimList
          title="Packed, ready to ship"
          empty="Nothing packed yet."
          rows={orders}
          userId={me.user.id}
          jobFor={(row) => jobForRef(jobs, "order", row.id, "ship")}
          onOpen={(row) => openFloorRow(row, me.user.id, jobForRef(jobs, "order", row.id, "ship"), setActive, setError)}
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
          <Field label="Carrier service">
            <Select value={carrierService} onChange={(e) => setCarrierService(e.target.value)}>
              <option value="rackline_ground">Rackline Ground</option>
              <option value="ups_ground">UPS Ground</option>
              <option value="usps_priority">USPS Priority</option>
            </Select>
          </Field>
          <Field label="Tracking number">
            <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
          </Field>
          <Field label="Carrier">
            <Input value={trackingCompany} onChange={(e) => setTrackingCompany(e.target.value)} placeholder="UPS, USPS…" />
          </Field>
          {canShipOrder(active.status) ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  if (!active) return;
                  api<ShippingLabel>(`/api/orders/${active.id}/label`, {
                    method: "POST",
                    body: JSON.stringify({ carrierService, trackingNumber: trackingNumber || undefined }),
                  })
                    .then((label) => {
                      setTrackingNumber(label.trackingNumber);
                      setTrackingCompany(label.carrierCompany);
                      setDone(`${label.trackingNumber} bought.`);
                    })
                    .catch((err: Error) => setError(err.message));
                }}
              >
                Buy label
              </Button>
              {trackingNumber || active.trackingNumber ? (
                <Button variant="secondary">
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
