import { useEffect, useState } from "react";
import { api, type Item, type Me } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";

const types = ["raw", "wip", "finished", "packaging"];

export function ItemsPage({ me }: { me: Me }) {
  const [items, setItems] = useState<Item[]>([]);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("raw");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setItems(await api<Item[]>("/api/items"));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api("/api/items", {
        method: "POST",
        body: JSON.stringify({ sku, name, type }),
      });
      setSku("");
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create item");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/api/items/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete item");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Items"
        description="Raw materials, WIP, packaging, and finished goods. Quantities are each."
      />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={onSubmit(create)}>
          <Field label="SKU">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} required />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit">Add item</Button>
          </div>
        </form>
      </Card>
      {items.length === 0 ? (
        <p className="text-sm text-muted">No SKUs yet. Add a part or load the Northwind demo.</p>
      ) : (
        <Table columns={["SKU", "Name", "Type", ""]}>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-3 font-mono text-sm">{item.sku}</td>
              <td className="px-4 py-3">{item.name}</td>
              <td className="px-4 py-3 capitalize">{item.type}</td>
              <td className="px-4 py-3 text-right">
                {me.role === "owner" ? (
                  <button className="text-sm text-bad" onClick={() => remove(item.id)}>
                    Delete
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
