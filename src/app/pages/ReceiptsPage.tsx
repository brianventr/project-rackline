import { useEffect, useState } from "react";
import { api, type Item, type Location, type Me, type Receipt } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";

type Line = { itemId: string; qty: string };

export function ReceiptsPage({ me }: { me: Me }) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [receiveLocation, setReceiveLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const warehouseId = me.warehouses[0]?.id;

  async function load() {
    const [nextReceipts, nextItems, nextLocations] = await Promise.all([
      api<Receipt[]>("/api/receipts"),
      api<Item[]>("/api/items"),
      api<Location[]>("/api/locations"),
    ]);
    setReceipts(nextReceipts);
    setItems(nextItems);
    setLocations(nextLocations);
    if (!receiveLocation) {
      const recv = nextLocations.find((location) => location.type === "receiving") ?? nextLocations[0];
      if (recv) setReceiveLocation(recv.id);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      await api("/api/receipts", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
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
      setError(err instanceof Error ? err.message : "Could not create receipt");
    }
  }

  async function receive(id: string) {
    setError(null);
    try {
      await api(`/api/receipts/${id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId: receiveLocation }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inbound"
        title="Receive"
        description="Draft a receipt, then post it into a bin. Posting writes the inventory ledger."
      />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="space-y-4" onSubmit={onSubmit(create)}>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="PO or vendor reference" />
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
          <Button type="submit">Create receipt</Button>
        </form>
      </Card>
      <div className="mb-4 max-w-sm">
        <Field label="Post into location">
          <Select value={receiveLocation} onChange={(e) => setReceiveLocation(e.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} — {location.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Table columns={["Number", "Status", "Lines", "Notes", ""]}>
        {receipts.map((receipt) => (
          <tr key={receipt.id}>
            <td className="px-4 py-3 font-mono">{receipt.number}</td>
            <td className="px-4 py-3">
              <StatusBadge status={receipt.status} />
            </td>
            <td className="px-4 py-3 text-sm">{summarizeLines(receipt.lines)}</td>
            <td className="px-4 py-3 text-muted">{receipt.notes || "—"}</td>
            <td className="px-4 py-3 text-right">
              {receipt.status === "draft" ? (
                <Button onClick={() => receive(receipt.id)}>Receive</Button>
              ) : (
                <span className="text-xs text-muted">Posted</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
