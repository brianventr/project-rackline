import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Location, type Purchase } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";
import { DocumentFrame, DocumentHeader, DocumentRail, DocumentActivity } from "../components/document";
import { PURCHASE_STEPS, canReceivePurchase, canStartPurchase } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields } from "./ReceiptsPage";

type Line = { itemId: string; qty: string };

export function PurchasesPage() {
  const { id } = useParams();
  if (id) return <PurchaseDetail id={id} />;
  return <PurchaseList />;
}

function PurchaseList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [vendorName, setVendorName] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextPurchases, nextItems] = await Promise.all([api<Purchase[]>("/api/purchases"), api<Item[]>("/api/items")]);
    setPurchases(nextPurchases);
    setItems(nextItems);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<Purchase>("/api/purchases", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          vendorName,
          notes,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      navigate(`/inbound/purchases/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create purchase");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inbound"
        title="Purchases"
        description="What you ordered from a vendor. Receive against it on the dock, including partials."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New purchase"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-6">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <Field label="Vendor">
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required placeholder="Harbor Components" />
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Restock, lead time, packing slip" />
            </Field>
            <LineFields items={items} lines={lines} setLines={setLines} />
            <Button type="submit">Create purchase</Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Vendor", "Status", "Lines"]}>
        {inWarehouse(purchases, warehouseId).map((purchase) => (
          <tr key={purchase.id}>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/inbound/purchases/${purchase.id}`}>
                {purchase.number}
              </Link>
            </td>
            <td className="px-4 py-3">{purchase.vendorName}</td>
            <td className="px-4 py-3">
              <StatusBadge status={purchase.status} />
            </td>
            <td className="px-4 py-3 text-sm">
              {summarizeLines(
                (purchase.lines ?? []).map((line) => ({ sku: line.sku, itemName: line.itemName, qty: line.qtyOrdered })),
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function PurchaseDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [next, nextLocations] = await Promise.all([
      api<Purchase>(`/api/purchases/${id}`),
      api<Location[]>("/api/locations"),
    ]);
    setPurchase(next);
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
      setPurchase(await api<Purchase>(`/api/purchases/${id}/start`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark ordered");
    }
  }

  async function receive() {
    if (!purchase) return;
    setError(null);
    try {
      const lines = (purchase.lines ?? [])
        .map((line) => ({ itemId: line.itemId, qty: Number(qtys[line.itemId] || 0) }))
        .filter((line) => line.qty > 0);
      const next = await api<Purchase>(`/api/purchases/${id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      setPurchase(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive");
    }
  }

  if (!purchase) return <ErrorBanner error={error} />;
  const remaining = hasRemaining(
    (purchase.lines ?? []).map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qtyOrdered,
      qtyReceived: line.qtyReceived,
    })),
  );

  return (
    <div className="space-y-6">
      <DocumentHeader
        eyebrow="Inbound"
        title={purchase.number}
        description={`${purchase.vendorName}${purchase.notes ? ` · ${purchase.notes}` : ""}`}
        status={purchase.status}
        steps={PURCHASE_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/inbound/purchases")}>
              All purchases
            </Button>
            {canStartPurchase(purchase.status) ? <Button onClick={() => void start()}>Mark ordered</Button> : null}
            {canReceivePurchase(purchase.status) && remaining ? <Button onClick={() => void receive()}>Receive</Button> : null}
            {canReceivePurchase(purchase.status) && remaining ? (
              <Button variant="secondary">
                <Link to={`/floor/receive?purchase=${purchase.id}`}>Floor</Link>
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
            <DocumentActivity refId={purchase.id} refreshKey={`${purchase.status}:${(purchase.lines ?? []).map((line) => line.qtyReceived).join(",")}`} />
          </DocumentRail>
        }
      >
        <Table columns={["SKU", "Item", "Ordered", "Received", "This receive"]}>
          {(purchase.lines ?? []).map((line) => (
            <tr key={line.id}>
              <td className="px-4 py-3 font-mono">{line.sku}</td>
              <td className="px-4 py-3">{line.itemName}</td>
              <td className="px-4 py-3 font-mono">{line.qtyOrdered}</td>
              <td className="px-4 py-3 font-mono">{line.qtyReceived}</td>
              <td className="px-4 py-3">
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
            </tr>
          ))}
        </Table>
      </DocumentFrame>
    </div>
  );
}
