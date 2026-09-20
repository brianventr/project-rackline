import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Location, type WorkOrder } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";
import { DocumentHeader, DocumentActivity } from "../components/document";
import { AsBuiltList } from "../components/as-built";
import { WORK_ORDER_STEPS, canCompleteWorkOrder } from "@/domain/status";
import { useWarehouse, inWarehouse } from "../warehouse";

export function WorkOrdersPage() {
  const { id } = useParams();
  if (id) return <WorkOrderDetail id={id} />;
  return <WorkOrderList />;
}

function WorkOrderList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [outputLocationId, setOutputLocationId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextOrders, nextItems, nextLocations] = await Promise.all([
      api<WorkOrder[]>("/api/work-orders"),
      api<Item[]>("/api/items"),
      api<Location[]>("/api/locations"),
    ]);
    setOrders(nextOrders);
    setItems(nextItems);
    setLocations(nextLocations);
    const finished = nextItems.find((item) => item.type === "finished" || item.type === "wip");
    if (finished) setItemId(finished.id);
    const storage = nextLocations.find((location) => location.type === "storage") ?? nextLocations[0];
    const prod = nextLocations.find((location) => location.type === "production") ?? nextLocations[0];
    if (storage) setSourceLocationId(storage.id);
    if (prod) setOutputLocationId(prod.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<WorkOrder>("/api/work-orders", {
        method: "POST",
        body: JSON.stringify({ warehouseId, itemId, qty: Number(qty), sourceLocationId, outputLocationId }),
      });
      navigate(`/make/work-orders/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create work order");
    }
  }

  const parents = items.filter((item) => item.type === "finished" || item.type === "wip");

  return (
    <div>
      <PageHeader
        eyebrow="Make"
        title="Work orders"
        description="Completing a work order consumes the recipe and puts finished goods in the output bay."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New work order"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-6">
          <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmit(create)}>
            <Field label="Build item">
              <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Select item</option>
                {parents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} — {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity">
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Consume from">
              <Select value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} — {location.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Put away finished">
              <Select value={outputLocationId} onChange={(e) => setOutputLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} — {location.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <Button type="submit">Release work order</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Item", "Qty", "Status"]}>
        {inWarehouse(orders, warehouseId).map((order) => (
          <tr key={order.id}>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/make/work-orders/${order.id}`}>
                {order.number}
              </Link>
            </td>
            <td className="px-4 py-3">
              {order.sku} — {order.itemName}
            </td>
            <td className="px-4 py-3 font-mono">{order.qty}</td>
            <td className="px-4 py-3">
              <StatusBadge status={order.status} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function WorkOrderDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<WorkOrder>(`/api/work-orders/${id}`)
      .then(setOrder)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    setError(null);
    try {
      setOrder(await api<WorkOrder>(`/api/work-orders/${id}/start`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    }
  }

  async function complete() {
    setError(null);
    try {
      setOrder(await api<WorkOrder>(`/api/work-orders/${id}/complete`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    }
  }

  if (!order) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-6">
      <DocumentHeader
        eyebrow="Make"
        title={order.number}
        description={`Build ${order.sku} × ${order.qty}`}
        status={order.status}
        steps={WORK_ORDER_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/make/work-orders")}>
              All work orders
            </Button>
            {order.status === "draft" ? <Button onClick={() => void start()}>Start</Button> : null}
            {canCompleteWorkOrder(order.status) ? <Button onClick={() => void complete()}>Complete</Button> : null}
            <Button variant="secondary">
              <Link to={`/floor/assemble?id=${order.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      {(order.asBuilt ?? []).length ? (
        <AsBuiltList title="As-built" empty="No component lots were recorded." rows={order.asBuilt ?? []} mode="from" />
      ) : null}
      <DocumentActivity refId={order.id} />
    </div>
  );
}
