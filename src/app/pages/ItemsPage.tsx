import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Me } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";

const types = ["raw", "wip", "finished", "packaging"];

export function ItemsPage({ me }: { me: Me }) {
  const { id } = useParams();
  if (id) return <ItemDetail me={me} id={id} />;
  return <ItemList />;
}

function ItemList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("raw");
  const [barcode, setBarcode] = useState("");
  const [reorderPoint, setReorderPoint] = useState("0");
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
      const created = await api<Item>("/api/items", {
        method: "POST",
        body: JSON.stringify({ sku, name, type, barcode: barcode || sku, reorderPoint: Number(reorderPoint) }),
      });
      setSku("");
      setName("");
      setBarcode("");
      setReorderPoint("0");
      navigate(`/stock/items/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create item");
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Stock" title="Items" description="Raw materials, WIP, packaging, and finished goods. Each SKU has a barcode." />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="grid gap-3 md:grid-cols-6" onSubmit={onSubmit(create)}>
          <Field label="SKU">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} required />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Barcode">
            <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Defaults to SKU" />
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
          <Field label="Reorder point">
            <Input type="number" min={0} value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Add item</Button>
          </div>
        </form>
      </Card>
      <Table columns={["SKU", "Barcode", "Name", "Type", "Reorder"]}>
        {items.map((item) => (
          <tr key={item.id}>
            <td className="px-4 py-3 font-mono text-sm">
              <Link className="hover:underline" to={`/stock/items/${item.id}`}>
                {item.sku}
              </Link>
            </td>
            <td className="px-4 py-3 font-mono text-sm">{item.barcode}</td>
            <td className="px-4 py-3">{item.name}</td>
            <td className="px-4 py-3 capitalize">{item.type}</td>
            <td className="px-4 py-3">{item.reorderPoint}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ItemDetail({ me, id }: { me: Me; id: string }) {
  const navigate = useNavigate();
  const [item, setItem] = useState<Item | null>(null);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Item>(`/api/items/${id}`)
      .then((next) => {
        setItem(next);
        setName(next.name);
        setBarcode(next.barcode);
        setReorderPoint(String(next.reorderPoint ?? 0));
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function save() {
    setError(null);
    try {
      setItem(
        await api<Item>(`/api/items/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ name, barcode, reorderPoint: Number(reorderPoint) }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update item");
    }
  }

  async function remove() {
    setError(null);
    try {
      await api(`/api/items/${id}`, { method: "DELETE" });
      navigate("/stock/items");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete item");
    }
  }

  if (!item) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Stock"
        title={item.sku}
        description={item.name}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/stock/items")}>
              All items
            </Button>
            <Button onClick={() => void save()}>Save</Button>
            {me.role === "owner" ? (
              <Button variant="danger" onClick={() => void remove()}>
                Delete
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorBanner error={error} />
      <div className="max-w-sm rounded-lg border p-3">
        <BarcodeLabel value={item.barcode || item.sku} className="mx-auto h-16" />
      </div>
      <Card className="grid gap-3 md:grid-cols-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Barcode">
          <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </Field>
        <Field label="Reorder point">
          <Input type="number" min={0} value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
        </Field>
      </Card>
      <Table columns={["Location", "Qty"]}>
        {(item.onHand ?? []).map((row) => (
          <tr key={row.locationId}>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/stock/locations/${row.locationId}`}>
                {row.locationCode}
              </Link>
            </td>
            <td className="px-4 py-3 font-mono">{row.qty}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
