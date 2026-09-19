import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Location, type Order } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";
import { DocumentFrame, DocumentHeader, DocumentRail, DocumentActivity } from "../components/document";
import { ORDER_STEPS, canPackOrder, canPickOrder, canShipOrder } from "@/domain/status";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields } from "./ReceiptsPage";

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
        description="Shopify checkouts and floor orders. Pick, pack, then ship."
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
      <Table columns={["Number", "Channel", "Customer", "Lines", "Status"]}>
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
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCompany, setTrackingCompany] = useState("");
  const [carrierService, setCarrierService] = useState("rackline_ground");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [next, nextLocations] = await Promise.all([api<Order>(`/api/orders/${id}`), api<Location[]>("/api/locations")]);
    setOrder(next);
    setLocations(nextLocations);
    const storage = nextLocations.find((row) => row.type === "storage") ?? nextLocations[0];
    const stocked = await locationWithStock(next, nextLocations);
    setPickLocation(next.pickLocationId || stocked || storage?.id || "");
    setTrackingNumber(next.trackingNumber || "");
    setTrackingCompany(next.trackingCompany || "");
    setCarrierService(next.carrierService || "rackline_ground");
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function pick() {
    setError(null);
    try {
      setOrder(await api<Order>(`/api/orders/${id}/pick`, { method: "POST", body: JSON.stringify({ locationId: pickLocation }) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pick failed");
    }
  }

  async function pack() {
    setError(null);
    try {
      setOrder(await api<Order>(`/api/orders/${id}/pack`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pack failed");
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
            {canPickOrder(order.status) ? <Button onClick={() => void pick()}>Pick</Button> : null}
            {canPackOrder(order.status) ? <Button onClick={() => void pack()}>Pack</Button> : null}
            {canShipOrder(order.status) ? (
              <Button onClick={() => void ship()}>{order.source === "shopify" ? "Ship & fulfill" : "Ship"}</Button>
            ) : null}
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
            <DocumentActivity refId={order.id} />
          </DocumentRail>
        }
      >
        <Table columns={["SKU", "Item", "Qty"]}>
          {(order.lines ?? []).map((line) => (
            <tr key={line.id}>
              <td className="px-4 py-3 font-mono">{line.sku}</td>
              <td className="px-4 py-3">{line.itemName}</td>
              <td className="px-4 py-3 font-mono">{line.qty}</td>
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

async function locationWithStock(order: Order, locations: Location[]): Promise<string | null> {
  for (const line of order.lines ?? []) {
    try {
      const item = await api<Item>(`/api/items/${line.itemId}`);
      const bay =
        (item.onHand ?? []).find((row) => row.qty >= line.qty) ?? (item.onHand ?? []).find((row) => row.qty > 0);
      if (bay) return bay.locationId;
    } catch {
      /* try the next line */
    }
  }
  return locations.find((row) => row.type === "storage")?.id ?? locations[0]?.id ?? null;
}
