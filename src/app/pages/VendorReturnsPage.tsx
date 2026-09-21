import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Location, type Purchase, type VendorReturn } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";
import { DocumentFrame, DocumentHeader, DocumentRail, DocumentActivity } from "../components/document";
import { VENDOR_RETURN_STEPS, canPostVendorReturn } from "@/domain/status";
import { hasUnreturned } from "@/domain/partial-rtv";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields } from "./ReceiptsPage";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";

type Line = { itemId: string; qty: string };

export function VendorReturnsPage() {
  const { id } = useParams();
  if (id) return <VendorReturnDetail id={id} />;
  return <VendorReturnList />;
}

function VendorReturnList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [returns, setReturns] = useState<VendorReturn[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [vendorName, setVendorName] = useState("Harbor Components");
  const [purchaseId, setPurchaseId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextReturns, nextItems, nextPurchases] = await Promise.all([
      api<VendorReturn[]>("/api/vendor-returns"),
      api<Item[]>("/api/items"),
      api<Purchase[]>("/api/purchases"),
    ]);
    setReturns(nextReturns);
    setItems(nextItems);
    setPurchases(nextPurchases);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<VendorReturn>("/api/vendor-returns", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          vendorName,
          purchaseId: purchaseId || null,
          notes,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      navigate(`/inbound/vendor-returns/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create vendor return");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Inbound"
        title="Vendor returns"
        description="RTV stock back to a vendor from a bay. Partial qty is allowed; over-return is blocked."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New vendor return"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-3">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <Field label="Vendor">
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required placeholder="Harbor Components" />
            </Field>
            <Field label="Original purchase">
              <Select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}>
                <option value="">None</option>
                {inWarehouse(purchases, warehouseId).map((purchase) => (
                  <option key={purchase.id} value={purchase.id}>
                    {purchase.number} · {purchase.vendorName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Wrong lot, damaged carton…" />
            </Field>
            <LineFields items={items} lines={lines} setLines={setLines} />
            <Button type="submit">Create vendor return</Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Vendor", "Purchase", "Status", "Lines"]}>
        {inWarehouse(returns, warehouseId).map((rtv) => (
          <tr key={rtv.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/inbound/vendor-returns/${rtv.id}`}>
                {rtv.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5">{rtv.vendorName}</td>
            <td className="px-2.5 py-1.5 font-mono">
              {rtv.purchaseId ? (
                <Link className="hover:underline" to={`/inbound/purchases/${rtv.purchaseId}`}>
                  {rtv.purchaseNumber || "PO"}
                </Link>
              ) : (
                "—"
              )}
            </td>
            <td className="px-2.5 py-1.5">
              <StatusBadge status={rtv.status} />
            </td>
            <td className="px-2.5 py-1.5 text-sm">
              {summarizeLines(
                (rtv.lines ?? []).map((line) => ({ sku: line.sku, itemName: line.itemName, qty: line.qtyExpected })),
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function VendorReturnDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [rtv, setRtv] = useState<VendorReturn | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [next, nextLocations] = await Promise.all([
      api<VendorReturn>(`/api/vendor-returns/${id}`),
      api<Location[]>("/api/locations"),
    ]);
    setRtv(next);
    setLocations(nextLocations);
    const from = nextLocations.find((row) => row.code === "A-01-01") ?? nextLocations.find((row) => row.type === "storage") ?? nextLocations[0];
    if (from) setLocationId(next.locationId || from.id);
    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    setError(null);
    try {
      setRtv(await api<VendorReturn>(`/api/vendor-returns/${id}/start`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    }
  }

  async function postReturn() {
    if (!rtv) return;
    setError(null);
    try {
      const lines = (rtv.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(qtys[line.itemId] || 0),
          lotCode: lots[line.itemId] || undefined,
          serials: serials[line.itemId] || undefined,
          weightGrams: parseWeightGrams(weights[line.itemId]),
        }))
        .filter((line) => line.qty > 0);
      const next = await api<VendorReturn>(`/api/vendor-returns/${id}/return`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      setRtv(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not return to vendor");
    }
  }

  if (!rtv) return <ErrorBanner error={error} />;
  const remaining = hasUnreturned(
    (rtv.lines ?? []).map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qtyExpected,
      qtyReturned: line.qtyReturned,
    })),
  );

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Inbound"
        title={rtv.number}
        description={`${rtv.vendorName}${rtv.notes ? ` · ${rtv.notes}` : ""}`}
        status={rtv.status}
        steps={VENDOR_RETURN_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/inbound/vendor-returns")}>
              All vendor returns
            </Button>
            {rtv.status === "open" ? <Button onClick={() => void start()}>Start</Button> : null}
            {canPostVendorReturn(rtv.status) && remaining ? <Button onClick={() => void postReturn()}>Return to vendor</Button> : null}
            {canPostVendorReturn(rtv.status) && remaining ? (
              <Button variant="secondary">
                <Link to={`/floor/rtv?id=${rtv.id}`}>Floor</Link>
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
              <Field label="Ship from">
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.code} — {location.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </Card>
            <DocumentActivity
              refId={rtv.id}
              refreshKey={`${rtv.status}:${(rtv.lines ?? []).map((line) => line.qtyReturned).join(",")}`}
            />
          </DocumentRail>
        }
      >
        <Table columns={["SKU", "Item", "Expected", "Returned", "This return", "Lot / serial"]}>
          {(rtv.lines ?? []).map((line) => (
            <tr key={line.id}>
              <td className="px-2.5 py-1.5 font-mono">{line.sku}</td>
              <td className="px-2.5 py-1.5">{line.itemName}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qtyExpected}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qtyReturned}</td>
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
              <td className="px-2.5 py-1.5 space-y-2">
                {line.trackLot ? (
                  <Input
                    placeholder="Lot"
                    value={lots[line.itemId] ?? ""}
                    onChange={(e) => setLots((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                {line.trackSerial ? (
                  <Input
                    placeholder="Serials"
                    value={serials[line.itemId] ?? ""}
                    onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                  />
                ) : null}
                <CatchWeightInput
                  show={line.catchWeight}
                  value={weights[line.itemId] ?? ""}
                  onChange={(value) => setWeights((current) => ({ ...current, [line.itemId]: value }))}
                />
              </td>
            </tr>
          ))}
        </Table>
      </DocumentFrame>
    </div>
  );
}
