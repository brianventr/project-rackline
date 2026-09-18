import { useEffect, useState } from "react";
import { api, type Item, type Location, type Me, type WorkOrder } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit } from "../components/ui";

export function WorkOrdersPage({ me }: { me: Me }) {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [outputLocationId, setOutputLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const warehouseId = me.warehouses[0]?.id;

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
    if (!itemId && finished) setItemId(finished.id);
    const storage = nextLocations.find((location) => location.type === "storage") ?? nextLocations[0];
    const prod = nextLocations.find((location) => location.type === "production") ?? nextLocations[0];
    if (!sourceLocationId && storage) setSourceLocationId(storage.id);
    if (!outputLocationId && prod) setOutputLocationId(prod.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api("/api/work-orders", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          itemId,
          qty: Number(qty),
          sourceLocationId,
          outputLocationId,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create work order");
    }
  }

  async function complete(id: string) {
    setError(null);
    try {
      await api(`/api/work-orders/${id}/complete`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    }
  }

  const parents = items.filter((item) => item.type === "finished" || item.type === "wip");

  return (
    <div>
      <PageHeader
        eyebrow="Manufacturing"
        title="Work orders"
        description="Completing a work order consumes BOM components from the source bin and puts finished goods in the output bin."
      />
      <ErrorBanner error={error} />
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
      <Table columns={["Number", "Item", "Qty", "Status", ""]}>
        {orders.map((order) => (
          <tr key={order.id}>
            <td className="px-4 py-3 font-mono">{order.number}</td>
            <td className="px-4 py-3">
              {order.sku} — {order.itemName}
            </td>
            <td className="px-4 py-3 font-mono tabular">{order.qty}</td>
            <td className="px-4 py-3">
              <StatusBadge status={order.status} />
            </td>
            <td className="px-4 py-3 text-right">
              {order.status === "draft" ? <Button onClick={() => complete(order.id)}>Complete</Button> : null}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
