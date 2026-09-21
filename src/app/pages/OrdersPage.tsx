import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type CarrierHub, type CarrierRate, type CarrierServiceOption, type Item, type Location, type Order, type ShippingLabel } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";
import { DocumentActionGrid, DocumentActivity, DocumentFact, DocumentFrame, DocumentHeader, DocumentRail } from "../components/document";
import { ORDER_STEPS, canPackOrder, canPickOrder, canShipOrder, canShipCartonOrder, canStartPick, canCancelOrder, canUnpickOrder } from "@/domain/status";
import { canRelabelException } from "@/domain/tracker";
import { hasUnpicked } from "@/domain/partial-pick";
import { hasUnpacked } from "@/domain/partial-pack";
import { canShipLabeledCarton, canUncartonOrderPackage } from "@/domain/cartons";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields } from "./ReceiptsPage";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";
import { PickMap } from "../components/PickMap";
import { Textarea } from "@/components/ui/textarea";

type Line = { itemId: string; qty: string };

export function OrdersPage() {
  const { id } = useParams();
  if (id) return <OrderDetail id={id} />;
  return <OrderList />;
}

function OrderList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [shipToAddress, setShipToAddress] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextOrders, nextItems] = await Promise.all([api<Order[]>("/api/orders"), api<Item[]>("/api/items")]);
    setOrders(nextOrders);
    setItems(nextItems);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<Order>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          customerName,
          shipToAddress: shipToAddress || undefined,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      navigate(`/outbound/orders/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create order");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <PageHeader
        eyebrow="Outbound"
        title="Orders"
        description="Shopify checkouts and floor orders. Start pick to reserve ATP, then pick from the suggested bay."
        actions={<Button size="xs" onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New order"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-3">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <Field label="Customer">
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
            </Field>
            <Field label="Ship to">
              <Textarea
                value={shipToAddress}
                onChange={(e) => setShipToAddress(e.target.value)}
                placeholder={"14 Dock Street\nPortland, OR 97201"}
                rows={3}
              />
            </Field>
            <LineFields items={items} lines={lines} setLines={setLines} />
            <Button type="submit">Create floor order</Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Channel", "Customer", "Lines", "Allocated", "Status"]}>
        {inWarehouse(orders, warehouseId).map((order) => (
          <tr key={order.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/outbound/orders/${order.id}`}>
                {order.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5">{order.source === "shopify" ? "Shopify" : "Floor"}</td>
            <td className="px-2.5 py-1.5">{order.customerName}</td>
            <td className="px-2.5 py-1.5 text-sm">{summarizeLines(order.lines)}</td>
            <td className="px-2.5 py-1.5 font-mono tabular">{order.allocatedUnits ?? 0}</td>
            <td className="px-2.5 py-1.5">
              <StatusBadge status={order.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function OrderDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [pickLocation, setPickLocation] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [packQtys, setPackQtys] = useState<Record<string, string>>({});
  const [unpickQtys, setUnpickQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
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

  async function load() {
    const [next, nextLocations, hub] = await Promise.all([
      api<Order>(`/api/orders/${id}`),
      api<Location[]>("/api/locations"),
      api<CarrierHub>("/api/carriers"),
    ]);
    setOrder(next);
    setLocations(nextLocations);
    setServices(hub.enabledServices);
    setPickLocation(defaultPickLocation(next, nextLocations));
    setQtys(qtyDefaults(next));
    setPackQtys(packQtyDefaults(next));
    setUnpickQtys(unpickQtyDefaults(next));
    setTrackingNumber(next.trackingNumber || "");
    setTrackingCompany(next.trackingCompany || "");
    setCarrierService(next.carrierService || hub.enabledServices.find((row) => row.isDefault)?.id || "rackline_ground");
    setWeightOz(String(next.packageWeightOz || 16));
    setLengthIn(String(next.packageLengthIn || 12));
    setWidthIn(String(next.packageWidthIn || 9));
    setHeightIn(String(next.packageHeightIn || 6));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function startPick() {
    setError(null);
    try {
      const next = await api<Order>(`/api/orders/${id}/start`, { method: "POST" });
      setOrder(next);
      setPickLocation(defaultPickLocation(next, locations));
      setQtys(qtyDefaults(next));
      setPackQtys(packQtyDefaults(next));
      setUnpickQtys(unpickQtyDefaults(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start pick");
    }
  }

  async function pick() {
    if (!order) return;
    setError(null);
    try {
      const lines = (order.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(qtys[line.id] || 0),
          lotCode: lots[line.id] || undefined,
          serials: serials[line.id] || undefined,
          weightGrams: parseWeightGrams(weights[line.id]),
        }))
        .filter((line) => line.qty > 0);
      const next = await api<Order>(`/api/orders/${id}/pick`, {
        method: "POST",
        body: JSON.stringify({ locationId: pickLocation, lines }),
      });
      setOrder(next);
      setPickLocation(defaultPickLocation(next, locations));
      setQtys(qtyDefaults(next));
      setPackQtys(packQtyDefaults(next));
      setUnpickQtys(unpickQtyDefaults(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pick failed");
    }
  }

  async function pack() {
    if (!order) return;
    setError(null);
    try {
      const lines = (order.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(packQtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      const next = await api<Order>(`/api/orders/${id}/pack`, {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
      setOrder(next);
      setPackQtys(packQtyDefaults(next));
      setUnpickQtys(unpickQtyDefaults(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pack failed");
    }
  }

  async function packIntoCarton() {
    if (!order) return;
    setError(null);
    try {
      const lines = (order.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(packQtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      const next = await api<Order>(`/api/orders/${id}/packages`, {
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
      setOrder(next);
      setPackQtys(packQtyDefaults(next));
      setUnpickQtys(unpickQtyDefaults(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Carton failed");
    }
  }

  async function unpick() {
    if (!order) return;
    setError(null);
    try {
      const lines = (order.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qty: Number(unpickQtys[line.id] || 0),
        }))
        .filter((line) => line.qty > 0);
      const next = await api<Order>(`/api/orders/${id}/unpick`, {
        method: "POST",
        body: JSON.stringify({ locationId: pickLocation || undefined, lines }),
      });
      setOrder(next);
      setPickLocation(defaultPickLocation(next, locations));
      setQtys(qtyDefaults(next));
      setPackQtys(packQtyDefaults(next));
      setUnpickQtys(unpickQtyDefaults(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unpick failed");
    }
  }

  async function cancel() {
    setError(null);
    try {
      const next = await api<Order>(`/api/orders/${id}/cancel`, { method: "POST" });
      setOrder(next);
      setQtys(qtyDefaults(next));
      setPackQtys(packQtyDefaults(next));
      setUnpickQtys(unpickQtyDefaults(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  async function ship() {
    setError(null);
    try {
      setOrder(
        await api<Order>(`/api/orders/${id}/ship`, {
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
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ship failed");
    }
  }

  async function shipCarton(pkgId: string) {
    setError(null);
    try {
      setOrder(await api<Order>(`/api/orders/${id}/packages/${pkgId}/ship`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not ship carton");
    }
  }

  async function uncarton(pkgId: string) {
    setError(null);
    try {
      setOrder(await api<Order>(`/api/orders/${id}/packages/${pkgId}/uncarton`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not drop carton");
    }
  }

  async function retryShopify() {
    setError(null);
    try {
      setOrder(await api<Order>(`/api/orders/${id}/shopify/fulfill`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Shopify fulfill failed");
    }
  }

  async function relabel(pkgId?: string) {
    setError(null);
    try {
      const path = pkgId ? `/api/orders/${id}/packages/${pkgId}/relabel` : `/api/orders/${id}/relabel`;
      const label = await api<ShippingLabel>(path, { method: "POST" });
      setTrackingNumber(label.trackingNumber);
      setTrackingCompany(label.carrierCompany);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not relabel");
    }
  }

  if (!order) return <ErrorBanner error={error} />;
  const remaining = hasUnpicked(
    (order.lines ?? []).map((line) => ({
      lineId: line.id,
      sku: line.sku,
      qtyOrdered: line.qty,
      qtyPicked: line.qtyPicked ?? 0,
    })),
  );
  const unpacked = hasUnpacked(
    (order.lines ?? []).map((line) => ({
      lineId: line.id,
      sku: line.sku,
      qtyPicked: line.qtyPicked ?? 0,
      qtyPacked: line.qtyPacked ?? 0,
    })),
  );
  const thisPick = Object.values(qtys).some((value) => Number(value) > 0);
  const thisPack = Object.values(packQtys).some((value) => Number(value) > 0);
  const thisUnpick = Object.values(unpickQtys).some((value) => Number(value) > 0);
  const unpickable = (order.lines ?? []).some((line) => (line.unpickRemaining ?? 0) > 0);
  const packages = order.packages ?? [];
  const hasPackages = packages.length > 0;
  const showWorkflow =
    (canStartPick(order.status) && remaining) ||
    (canPickOrder(order.status) && remaining) ||
    (canPackOrder(order.status) && unpacked) ||
    (canUnpickOrder(order.status) && unpickable) ||
    canCancelOrder(order.status) ||
    canShipOrder(order.status);

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Outbound"
        title={order.number}
        description={order.customerName}
        status={order.status}
        steps={ORDER_STEPS}
        actions={
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button variant="ghost" size="xs" onClick={() => navigate("/outbound/orders")}>
                All orders
              </Button>
              {canPickOrder(order.status) ? (
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`/outbound/orders/${order.id}/pick-list`}>Pick list</Link>
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" asChild>
                <Link to={`/outbound/orders/${order.id}/pack-slip`}>Pack slip</Link>
              </Button>
              {!hasPackages ? (
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`/outbound/orders/${order.id}/shipping-label`}>Label</Link>
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" asChild>
                <Link to={floorActionForOrder(order.status, order.id)}>Floor</Link>
              </Button>
              {order.source === "shopify" &&
              (order.shopifySyncStatus === "failed" ||
                packages.some((pkg) => pkg.shippedAt && !pkg.shopifyFulfillmentId)) ? (
                <Button variant="secondary" size="sm" onClick={() => void retryShopify()}>
                  Retry Shopify
                </Button>
              ) : null}
            </div>
            {showWorkflow ? (
              <div className="flex flex-wrap justify-end gap-2">
                {canStartPick(order.status) && remaining ? (
                  <Button variant="secondary" onClick={() => void startPick()}>
                    Start pick
                  </Button>
                ) : null}
                {canPickOrder(order.status) && remaining ? (
                  <Button disabled={!thisPick} onClick={() => void pick()}>
                    Pick
                  </Button>
                ) : null}
                {canPackOrder(order.status) && unpacked ? (
                  <>
                    <Button disabled={!thisPack} onClick={() => void pack()}>
                      Pack
                    </Button>
                    <Button variant="secondary" disabled={!thisPack} onClick={() => void packIntoCarton()}>
                      Pack into carton
                    </Button>
                  </>
                ) : null}
                {canUnpickOrder(order.status) && unpickable ? (
                  <Button variant="secondary" disabled={!thisUnpick} onClick={() => void unpick()}>
                    Unpick
                  </Button>
                ) : null}
                {canCancelOrder(order.status) ? (
                  <Button variant="secondary" onClick={() => void cancel()}>
                    Cancel
                  </Button>
                ) : null}
                {canShipOrder(order.status) ? (
                  <Button onClick={() => void ship()}>{order.source === "shopify" ? "Ship & fulfill" : "Ship"}</Button>
                ) : null}
              </div>
            ) : null}
          </div>
        }
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card className="space-y-3">
              <DocumentFact label="Channel">
                {order.source === "shopify" ? (
                  <Link className="underline" to="/setup/shopify">
                    Shopify
                  </Link>
                ) : (
                  "Floor"
                )}
              </DocumentFact>
              {order.source === "shopify" ? (
                <DocumentFact label="Shopify">
                  <StatusBadge status={order.shopifySyncStatus || "inbound"} />
                </DocumentFact>
              ) : null}
              {order.shopifySyncError ? <p className="text-sm text-destructive">{order.shopifySyncError}</p> : null}
              <Field label="Pick from">
                <Select value={pickLocation} onChange={(e) => setPickLocation(e.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Carrier service">
                <Select value={carrierService} onChange={(e) => setCarrierService(e.target.value)}>
                  {(services.length ? services : [{ id: "rackline_ground", company: "Rackline", service: "Ground" }]).map(
                    (row) => (
                      <option key={row.id} value={row.id}>
                        {row.company} {row.service}
                      </option>
                    ),
                  )}
                </Select>
              </Field>
              <Field label="Tracking">
                <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
              </Field>
              <Field label="Carrier">
                <Input value={trackingCompany} onChange={(e) => setTrackingCompany(e.target.value)} />
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
              {order.shipToAddress ? <p className="whitespace-pre-line text-sm text-muted-foreground">{order.shipToAddress}</p> : null}
              {!hasPackages && order.labelStatus && order.labelStatus !== "none" ? (
                <DocumentFact label="Label">
                  <StatusBadge status={order.labelStatus} />
                </DocumentFact>
              ) : null}
              {!hasPackages && order.trackerStatus ? (
                <DocumentFact label="Tracker">
                  <StatusBadge status={order.trackerStatus} />
                </DocumentFact>
              ) : null}
              {order.postageCents ? (
                <p className="text-sm text-muted-foreground">Postage ${(order.postageCents / 100).toFixed(2)}</p>
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
              <DocumentActionGrid>
                <Button
                  variant="secondary"
                  size="sm"
                  className={hasPackages ? "col-span-2" : undefined}
                  onClick={() =>
                    void api<{ rates: CarrierRate[] }>(`/api/orders/${id}/rates`, {
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
                {!hasPackages ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void api<ShippingLabel>(`/api/orders/${id}/label`, {
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
                        .then((label) => {
                          setTrackingNumber(label.trackingNumber);
                          setTrackingCompany(label.carrierCompany);
                          return load();
                        })
                        .catch((err: Error) => setError(err.message))
                    }
                  >
                    Buy label
                  </Button>
                ) : null}
                {!hasPackages && order.labelStatus === "purchased" && order.status !== "shipped" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void api(`/api/orders/${id}/label/void`, { method: "POST" })
                        .then(() => load())
                        .catch((err: Error) => setError(err.message))
                    }
                  >
                    Void
                  </Button>
                ) : null}
                {!hasPackages &&
                canRelabelException({
                  status: order.status,
                  trackerStatus: order.trackerStatus,
                  labelStatus: order.labelStatus,
                  trackingNumber: order.trackingNumber,
                }).ok ? (
                  <Button variant="secondary" size="sm" onClick={() => void relabel()}>
                    Relabel
                  </Button>
                ) : null}
                {!hasPackages && order.trackingNumber ? (
                  <Button variant="secondary" size="sm" asChild>
                    <Link to={`/outbound/orders/${id}/shipping-label`}>Print label</Link>
                  </Button>
                ) : null}
              </DocumentActionGrid>
            </Card>
            {hasPackages ? (
              <Card className="space-y-3">
                <h3 className="font-medium">Cartons</h3>
                <ul className="space-y-3 text-sm">
                  {packages.map((pkg) => {
                    const canBuy = !pkg.shippedAt;
                    const canRelabel =
                      canRelabelException({
                        status: order.status,
                        trackerStatus: pkg.trackerStatus,
                        labelStatus: pkg.labelStatus,
                        trackingNumber: pkg.trackingNumber,
                      }).ok && !pkg.shippedAt;
                    const canPrint = Boolean(pkg.trackingNumber);
                    const canShip = canShipCartonOrder(order.status) && canShipLabeledCarton(pkg).ok;
                    const canDrop = canUncartonOrderPackage({ status: order.status, shippedAt: pkg.shippedAt }).ok;
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
                          <Button className="w-full" size="sm" onClick={() => void shipCarton(pkg.id)}>
                            Ship carton
                          </Button>
                        ) : null}
                        {canBuy || canPrint || canRelabel || canDrop ? (
                          <DocumentActionGrid>
                            {canBuy ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  void api<ShippingLabel>(`/api/orders/${id}/packages/${pkg.id}/label`, {
                                    method: "POST",
                                    body: JSON.stringify({
                                      carrierService,
                                      weightOz: pkg.weightOz || Number(weightOz),
                                      lengthIn: pkg.lengthIn || Number(lengthIn),
                                      widthIn: pkg.widthIn || Number(widthIn),
                                      heightIn: pkg.heightIn || Number(heightIn),
                                    }),
                                  })
                                    .then(() => load())
                                    .catch((err: Error) => setError(err.message))
                                }
                              >
                                Buy
                              </Button>
                            ) : null}
                            {canPrint ? (
                              <Button variant="secondary" size="sm" asChild>
                                <Link to={`/outbound/orders/${id}/packages/${pkg.id}/shipping-label`}>Print</Link>
                              </Button>
                            ) : null}
                            {canRelabel ? (
                              <Button variant="secondary" size="sm" onClick={() => void relabel(pkg.id)}>
                                Relabel
                              </Button>
                            ) : null}
                            {canDrop ? (
                              <Button variant="secondary" size="sm" onClick={() => void uncarton(pkg.id)}>
                                Drop
                              </Button>
                            ) : null}
                          </DocumentActionGrid>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ) : null}
            <DocumentActivity
              refId={order.id}
              refreshKey={`${order.status}:${(order.lines ?? []).map((line) => `${line.qtyPicked}:${line.qtyPacked}`).join(",")}`}
            />
          </DocumentRail>
        }
      >
        <PickMap
          lines={order.lines ?? []}
          locations={locations}
          selectedLocationId={pickLocation}
          onSelectLocation={setPickLocation}
        />
        <Table columns={["SKU", "Item", "Ordered", "Picked", "Packed", "Allocated", "Bay", "This pick", "This pack", "This unpick", "Lot / serial"]}>
          {(order.lines ?? []).map((line) => (
            <tr key={line.id}>
              <td className="px-2.5 py-1.5 font-mono">{line.sku}</td>
              <td className="px-2.5 py-1.5">{line.itemName}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qty}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qtyPicked ?? 0}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qtyPacked ?? 0}</td>
              <td className="px-2.5 py-1.5 font-mono text-sm">
                {(line.allocations ?? []).length
                  ? (line.allocations ?? []).map((row) => `${row.locationCode} ×${row.qty}`).join(", ")
                  : (line.allocatedQty ?? 0) > 0
                    ? line.allocatedQty
                    : "—"}
              </td>
              <td className="px-2.5 py-1.5 font-mono text-sm">
                {line.suggestedLocation ? (
                  <button
                    type="button"
                    className="underline-offset-4 hover:underline"
                    onClick={() => setPickLocation(line.suggestedLocation!.locationId)}
                  >
                    {line.suggestedLocation.locationCode}
                    <span className="text-muted-foreground"> ×{line.suggestedLocation.qty}</span>
                  </button>
                ) : (
                  <span className="text-muted-foreground">{line.remaining > 0 ? "—" : "Done"}</span>
                )}
              </td>
              <td className="px-2.5 py-1.5">
                {line.remaining > 0 ? (
                  <Input
                    type="number"
                    min={0}
                    max={line.remaining}
                    value={qtys[line.id] ?? "0"}
                    onChange={(e) => setQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : (
                  <span className="text-muted-foreground">Done</span>
                )}
              </td>
              <td className="px-2.5 py-1.5">
                {(line.packRemaining ?? 0) > 0 ? (
                  <Input
                    type="number"
                    min={0}
                    max={line.packRemaining}
                    value={packQtys[line.id] ?? "0"}
                    onChange={(e) => setPackQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : (
                  <span className="text-muted-foreground">{(line.qtyPicked ?? 0) > 0 ? "Done" : "—"}</span>
                )}
              </td>
              <td className="px-2.5 py-1.5">
                {(line.unpickRemaining ?? 0) > 0 ? (
                  <Input
                    type="number"
                    min={0}
                    max={line.unpickRemaining}
                    value={unpickQtys[line.id] ?? "0"}
                    onChange={(e) => setUnpickQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-2.5 py-1.5">
                {line.trackLot ? (
                  <Input
                    placeholder="Lot"
                    value={lots[line.id] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial ? (
                  <Input
                    className="mt-1"
                    placeholder="Serials"
                    value={serials[line.id] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.id]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  className="mt-1"
                  show={line.catchWeight}
                  value={weights[line.id] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.id]: value }))}
                />
              </td>
            </tr>
          ))}
        </Table>
      </DocumentFrame>
    </div>
  );
}

function floorActionForOrder(status: string, id: string): string {
  if (status === "picked" || status === "packing") return `/floor/pack?id=${id}`;
  if (status === "packed") return `/floor/ship?id=${id}`;
  return `/floor/pick?id=${id}`;
}

function qtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.remaining ?? 0)]));
}

function packQtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.packRemaining ?? 0)]));
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
