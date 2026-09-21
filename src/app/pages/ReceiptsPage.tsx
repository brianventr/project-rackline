import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Location, type Receipt } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";
import { DocumentFrame, DocumentHeader, DocumentRail, DocumentActivity } from "../components/document";
import { RECEIPT_STEPS, canReceive } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useWarehouse, inWarehouse } from "../warehouse";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../components/expiry-field";

type Line = { itemId: string; qty: string };

export function ReceiptsPage() {
  const { id } = useParams();
  if (id) return <ReceiptDetail id={id} />;
  return <ReceiptList />;
}

function ReceiptList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextReceipts, nextItems] = await Promise.all([api<Receipt[]>("/api/receipts"), api<Item[]>("/api/items")]);
    setReceipts(nextReceipts);
    setItems(nextItems);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<Receipt>("/api/receipts", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          notes,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      navigate(`/inbound/receipts/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create receipt");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <PageHeader
        eyebrow="Inbound"
        title="Receipts"
        description="Create the inbound document here. Receive it on the dock, including partials."
        actions={<Button size="xs" onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New receipt"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-3">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="PO or vendor reference" />
            </Field>
            <LineFields items={items} lines={lines} setLines={setLines} />
            <Button type="submit">Create receipt</Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Status", "Lines", "Notes"]}>
        {inWarehouse(receipts, warehouseId).map((receipt) => (
          <tr key={receipt.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/inbound/receipts/${receipt.id}`}>
                {receipt.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5">
              <StatusBadge status={receipt.status} />
            </td>
            <td className="px-2.5 py-1.5 text-sm">{summarizeLines(receipt.lines)}</td>
            <td className="px-2.5 py-1.5 text-muted-foreground">{receipt.notes || "—"}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ReceiptDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [next, nextLocations] = await Promise.all([
      api<Receipt>(`/api/receipts/${id}`),
      api<Location[]>("/api/locations"),
    ]);
    setReceipt(next);
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(next.locationId || dock.id);
    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    setError(null);
    try {
      setReceipt(await api<Receipt>(`/api/receipts/${id}/start`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start receiving");
    }
  }

  async function receive() {
    if (!receipt) return;
    setError(null);
    try {
      const lines = (receipt.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(qtys[line.itemId] || 0),
          lotCode: lots[line.itemId] || undefined,
          serials: serials[line.itemId] || undefined,
          weightGrams: parseWeightGrams(weights[line.itemId]),
          expiresOn: parseExpiryInput(expiries[line.itemId]),
        }))
        .filter((line) => line.qty > 0);
      const next = await api<Receipt>(`/api/receipts/${id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      setReceipt(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive");
    }
  }

  if (!receipt) return <ErrorBanner error={error} />;
  const remaining = hasRemaining(
    (receipt.lines ?? []).map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qty,
      qtyReceived: line.qtyReceived,
    })),
  );

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Inbound"
        title={receipt.number}
        description={receipt.notes || "Inbound receipt"}
        status={receipt.status}
        steps={RECEIPT_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/inbound/receipts")}>
              All receipts
            </Button>
            {receipt.status === "draft" ? <Button onClick={() => void start()}>Start receiving</Button> : null}
            {canReceive(receipt.status) && remaining ? <Button onClick={() => void receive()}>Receive</Button> : null}
            {canReceive(receipt.status) && remaining ? (
              <Button variant="secondary">
                <Link to={`/floor/receive?id=${receipt.id}`}>Floor</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <Field label="Receive into">
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </Card>
            <DocumentActivity refId={receipt.id} refreshKey={`${receipt.status}:${(receipt.lines ?? []).map((line) => line.qtyReceived).join(",")}`} />
          </DocumentRail>
        }
      >
        <Table columns={["SKU", "Item", "Expected", "Received", "This receive", "Lot / serial"]}>
          {(receipt.lines ?? []).map((line) => (
            <tr key={line.id}>
              <td className="px-2.5 py-1.5 font-mono">{line.sku}</td>
              <td className="px-2.5 py-1.5">{line.itemName}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qty}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qtyReceived}</td>
              <td className="px-2.5 py-1.5">
                {line.remaining > 0 ? (
                  <Input
                    type="number"
                    min={0}
                    max={line.remaining}
                    value={qtys[line.itemId] ?? "0"}
                    onChange={(e) => setQtys((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : (
                  <span className="text-muted-foreground">Done</span>
                )}
              </td>
              <td className="px-2.5 py-1.5">
                {line.trackLot ? (
                  <Input
                    placeholder="Lot"
                    value={lots[line.itemId] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial ? (
                  <Input
                    className="mt-1"
                    placeholder="Serials"
                    value={serials[line.itemId] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  className="mt-1"
                  show={line.catchWeight}
                  value={weights[line.itemId] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.itemId]: value }))}
                />
                <ExpiryInput
                  className="mt-1"
                  show={line.trackExpiry}
                  value={expiries[line.itemId] ?? ""}
                  onChange={(value) => setExpiries((current) => ({ ...current, [line.itemId]: value }))}
                />
              </td>
            </tr>
          ))}
        </Table>
      </DocumentFrame>
    </div>
  );
}

export function LineFields({
  items,
  lines,
  setLines,
}: {
  items: Item[];
  lines: Line[];
  setLines: (updater: (current: Line[]) => Line[]) => void;
}) {
  return (
    <div className="space-y-2">
      {lines.map((line, index) => (
        <div key={index} className="grid gap-2 md:grid-cols-[1fr_120px]">
          <Select
            value={line.itemId}
            onChange={(e) => setLines((current) => current.map((row, i) => (i === index ? { ...row, itemId: e.target.value } : row)))}
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
            onChange={(e) => setLines((current) => current.map((row, i) => (i === index ? { ...row, qty: e.target.value } : row)))}
          />
        </div>
      ))}
      <Button variant="ghost" onClick={() => setLines((current) => [...current, { itemId: "", qty: "1" }])}>
        Add line
      </Button>
    </div>
  );
}
