import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Location, type Order } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";
import { DocumentFrame, DocumentHeader, DocumentRail, DocumentActivity } from "../components/document";
import { ORDER_STEPS, canPackOrder, canPickOrder, canShipOrder, canStartPick, canCancelOrder, canUnpickOrder } from "@/domain/status";
import { hasUnpicked } from "@/domain/partial-pick";
import { hasUnpacked } from "@/domain/partial-pack";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields } from "./ReceiptsPage";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";

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
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      navigate(`/outbound/orders/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create order");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Outbound"
        title="Orders"
        description="Shopify checkouts and floor orders. Start pick to reserve ATP, then pick from the suggested bay."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New order"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-6">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <Field label="Customer">
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
            </Field>
            <LineFields items={items} lines={lines} setLines={setLines} />
            <Button type="submit">Create floor order</Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Channel", "Customer", "Lines", "Allocated", "Status"]}>
        {inWarehouse(orders, warehouseId).map((order) => (
          <tr key={order.id}>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/outbound/orders/${order.id}`}>
                {order.number}
              </Link>
            </td>
            <td className="px-4 py-3">{order.source === "shopify" ? "Shopify" : "Floor"}</td>
            <td className="px-4 py-3">{order.customerName}</td>
            <td className="px-4 py-3 text-sm">{summarizeLines(order.lines)}</td>
            <td className="px-4 py-3 font-mono tabular">{order.allocatedUnits ?? 0}</td>
            <td className="px-4 py-3">
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
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [next, nextLocations] = await Promise.all([api<Order>(`/api/orders/${id}`), api<Location[]>("/api/locations")]);
    setOrder(next);
    setLocations(nextLocations);
    setPickLocation(defaultPickLocation(next, nextLocations));
    setQtys(qtyDefaults(next));
    setPackQtys(packQtyDefaults(next));
    setUnpickQtys(unpickQtyDefaults(next));
    setTrackingNumber(next.trackingNumber || "");
    setTrackingCompany(next.trackingCompany || "");
    setCarrierService(next.carrierService || "rackline_ground");
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
          }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ship failed");
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

  return (
    <div className="space-y-6">
      <DocumentHeader
        eyebrow="Outbound"
        title={order.number}
        description={order.customerName}
        status={order.status}
        steps={ORDER_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/outbound/orders")}>
              All orders
            </Button>
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
              <Button disabled={!thisPack} onClick={() => void pack()}>
                Pack
              </Button>
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
            <Button variant="secondary">
              <Link to={`/outbound/orders/${order.id}/pack-slip`}>Pack slip</Link>
            </Button>
            <Button variant="secondary">
              <Link to={`/outbound/orders/${order.id}/shipping-label`}>Label</Link>
            </Button>
            <Button variant="secondary">
              <Link to={floorActionForOrder(order.status, order.id)}>Floor</Link>
            </Button>
            {order.status === "shipped" && order.source === "shopify" && order.shopifySyncStatus === "failed" ? (
              <Button variant="secondary" onClick={() => void retryShopify()}>
                Retry Shopify
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card className="space-y-3">
              <p className="text-sm">
                Channel: {order.source === "shopify" ? <Link className="underline" to="/setup/shopify">Shopify</Link> : "Floor"}
              </p>
              {order.source === "shopify" ? <StatusBadge status={order.shopifySyncStatus || "inbound"} /> : null}
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
                  <option value="rackline_ground">Rackline Ground</option>
                  <option value="ups_ground">UPS Ground</option>
                  <option value="usps_priority">USPS Priority</option>
                </Select>
              </Field>
              <Field label="Tracking">
                <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
              </Field>
              <Field label="Carrier">
                <Input value={trackingCompany} onChange={(e) => setTrackingCompany(e.target.value)} />
              </Field>
              {order.shipToAddress ? <p className="whitespace-pre-line text-sm text-muted-foreground">{order.shipToAddress}</p> : null}
              <Button
                variant="secondary"
                onClick={() =>
                  void api(`/api/orders/${id}/label`, {
                    method: "POST",
                    body: JSON.stringify({ carrierService, trackingNumber: trackingNumber || undefined }),
                  })
                    .then(() => load())
                    .catch((err: Error) => setError(err.message))
                }
              >
                Buy label
              </Button>
            </Card>
            <DocumentActivity
              refId={order.id}
              refreshKey={`${order.status}:${(order.lines ?? []).map((line) => `${line.qtyPicked}:${line.qtyPacked}`).join(",")}`}
            />
          </DocumentRail>
        }
      >
        <Table columns={["SKU", "Item", "Ordered", "Picked", "Packed", "Allocated", "Bay", "This pick", "This pack", "This unpick", "Lot / serial"]}>
          {(order.lines ?? []).map((line) => (
            <tr key={line.id}>
              <td className="px-4 py-3 font-mono">{line.sku}</td>
              <td className="px-4 py-3">{line.itemName}</td>
              <td className="px-4 py-3 font-mono">{line.qty}</td>
              <td className="px-4 py-3 font-mono">{line.qtyPicked ?? 0}</td>
              <td className="px-4 py-3 font-mono">{line.qtyPacked ?? 0}</td>
              <td className="px-4 py-3 font-mono text-sm">
                {(line.allocations ?? []).length
                  ? (line.allocations ?? []).map((row) => `${row.locationCode} ×${row.qty}`).join(", ")
                  : (line.allocatedQty ?? 0) > 0
                    ? line.allocatedQty
                    : "—"}
              </td>
              <td className="px-4 py-3 font-mono text-sm">
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
              <td className="px-4 py-3">
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
              <td className="px-4 py-3">
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
              <td className="px-4 py-3">
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
              <td className="px-4 py-3">
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
