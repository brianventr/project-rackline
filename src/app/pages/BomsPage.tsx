import { useEffect, useState } from "react";
import { api, type Bom, type Item, type Me } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";

type Line = { itemId: string; qty: string };

export function BomsPage({ me }: { me: Me }) {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [itemId, setItemId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextBoms, nextItems] = await Promise.all([api<Bom[]>("/api/boms"), api<Item[]>("/api/items")]);
    setBoms(nextBoms);
    setItems(nextItems);
    const finished = nextItems.find((item) => item.type === "finished" || item.type === "wip");
    if (!itemId && finished) setItemId(finished.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api("/api/boms", {
        method: "POST",
        body: JSON.stringify({
          itemId,
          lines: lines
            .filter((line) => line.itemId)
            .map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      setLines([{ itemId: "", qty: "1" }]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create BOM");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/api/boms/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete BOM");
    }
  }

  const parents = items.filter((item) => item.type === "finished" || item.type === "wip");

  return (
    <div>
      <PageHeader
        eyebrow="Make"
        title="Recipes"
        description="One recipe per finished or WIP SKU. Work orders explode this by quantity."
      />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="space-y-4" onSubmit={onSubmit(create)}>
          <Field label="Parent item">
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Select parent</option>
              {parents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} — {item.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[1fr_120px]">
                <Select
                  value={line.itemId}
                  onChange={(e) =>
                    setLines((current) =>
                      current.map((row, i) => (i === index ? { ...row, itemId: e.target.value } : row)),
                    )
                  }
                >
                  <option value="">Component</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) =>
                    setLines((current) =>
                      current.map((row, i) => (i === index ? { ...row, qty: e.target.value } : row)),
                    )
                  }
                />
              </div>
            ))}
            <Button variant="ghost" onClick={() => setLines((current) => [...current, { itemId: "", qty: "1" }])}>
              Add component
            </Button>
          </div>
          <Button type="submit">Save BOM</Button>
        </form>
      </Card>
      {boms.map((bom) => (
        <Card key={bom.id} className="mb-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              {bom.sku} — {bom.itemName}
            </h2>
            {me.role === "owner" ? (
              <button className="text-sm text-bad" onClick={() => remove(bom.id)}>
                Delete
              </button>
            ) : null}
          </div>
          <Table columns={["Component", "Qty each"]}>
            {bom.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <span className="font-mono">{line.sku}</span> {line.itemName}
                </td>
                <td className="px-4 py-3 font-mono tabular">{line.qty}</td>
              </tr>
            ))}
          </Table>
        </Card>
      ))}
    </div>
  );
}
