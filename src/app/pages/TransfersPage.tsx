import { useEffect, useState } from "react";
import { api, type Item, type Location, type Me, type Transfer } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";

type Line = { itemId: string; qty: string };

export function TransfersPage({ me }: { me: Me }) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const warehouseId = me.warehouses[0]?.id;

  async function load() {
    const [nextTransfers, nextItems, nextLocations] = await Promise.all([
      api<Transfer[]>("/api/transfers"),
      api<Item[]>("/api/items"),
      api<Location[]>("/api/locations"),
    ]);
    setTransfers(nextTransfers);
    setItems(nextItems);
    setLocations(nextLocations);
    const recv = nextLocations.find((location) => location.type === "receiving") ?? nextLocations[0];
    const storage = nextLocations.find((location) => location.type === "storage") ?? nextLocations[1];
    if (!fromLocationId && recv) setFromLocationId(recv.id);
    if (!toLocationId && storage) setToLocationId(storage.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api("/api/transfers", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          fromLocationId,
          toLocationId,
          notes,
          lines: lines
            .filter((line) => line.itemId)
            .map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      setNotes("");
      setLines([{ itemId: "", qty: "1" }]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create transfer");
    }
  }

  async function post(id: string) {
    setError(null);
    try {
      await api(`/api/transfers/${id}/post`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post transfer");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Putaway"
        title="Transfers"
        description="Move stock from one bin to another — dock to rack, bench to staging. Posting writes a move on the ledger."
      />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="space-y-4" onSubmit={onSubmit(create)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="From">
              <Select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} — {location.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="To">
              <Select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} — {location.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Putaway from receiving" />
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
                  <option value="">Select SKU</option>
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
              Add line
            </Button>
          </div>
          <Button type="submit">Create transfer</Button>
        </form>
      </Card>
      <Table columns={["Number", "From", "To", "Lines", "Status", ""]}>
        {transfers.map((transfer) => (
          <tr key={transfer.id}>
            <td className="px-4 py-3 font-mono">{transfer.number}</td>
            <td className="px-4 py-3 font-mono">{transfer.fromCode}</td>
            <td className="px-4 py-3 font-mono">{transfer.toCode}</td>
            <td className="px-4 py-3 text-sm">{summarizeLines(transfer.lines)}</td>
            <td className="px-4 py-3">
              <StatusBadge status={transfer.status} />
            </td>
            <td className="px-4 py-3 text-right">
              {transfer.status === "draft" ? (
                <Button onClick={() => post(transfer.id)}>Post</Button>
              ) : (
                <span className="text-xs text-muted">Moved</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
