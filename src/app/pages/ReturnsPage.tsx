import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Client, type Item, type Location, type Order, type Rma } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, onSubmit, summarizeLines } from "../components/ui";
import { DocumentFrame, DocumentHeader, DocumentRail, DocumentActivity } from "../components/document";
import { RETURN_STEPS, canReceiveReturn } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useWarehouse, inWarehouse } from "../warehouse";
import { LineFields } from "./ReceiptsPage";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../components/expiry-field";
import { DispositionSelect } from "../components/disposition-field";
import { parseDisposition, type ReturnDisposition } from "@/domain/return-disposition";

type Line = { itemId: string; qty: string };

export function ReturnsPage() {
  const { id } = useParams();
  if (id) return <ReturnDetail id={id} />;
  return <ReturnList />;
}

function ReturnList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [returns, setReturns] = useState<Rma[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [orderId, setOrderId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "1" }]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextReturns, nextItems, nextOrders, nextClients] = await Promise.all([
      api<Rma[]>("/api/returns"),
      api<Item[]>("/api/items"),
      api<Order[]>("/api/orders"),
      api<Client[]>("/api/clients"),
    ]);
    setReturns(nextReturns);
    setItems(nextItems);
    setOrders(nextOrders);
    setClients(nextClients);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<Rma>("/api/returns", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          customerName,
          orderId: orderId || null,
          clientId: clientId || null,
          notes,
          lines: lines.filter((line) => line.itemId).map((line) => ({ itemId: line.itemId, qty: Number(line.qty) })),
        }),
      });
      navigate(`/outbound/returns/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create return");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Outbound"
        title="Returns"
        description="Customer RMAs. Receive back into a bay as restock, scrap, or hold."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New return"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-3">
          <form className="space-y-4" onSubmit={onSubmit(create)}>
            <Field label="Customer">
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
            </Field>
            <Field label="Original order">
              <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">None</option>
                {inWarehouse(orders, warehouseId).map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.number} · {order.customerName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Client">
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">From the order, or house</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.code} — {client.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Wrong color, damaged carton…" />
            </Field>
            <LineFields items={items} lines={lines} setLines={setLines} />
            <Button type="submit">Create return</Button>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Customer", "Order", "Status", "Lines"]}>
        {inWarehouse(returns, warehouseId).map((rma) => (
          <tr key={rma.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/outbound/returns/${rma.id}`}>
                {rma.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5">{rma.customerName}</td>
            <td className="px-2.5 py-1.5 font-mono">
              {rma.orderId ? (
                <Link className="hover:underline" to={`/outbound/orders/${rma.orderId}`}>
                  {rma.orderNumber || "Order"}
                </Link>
              ) : (
                "—"
              )}
            </td>
            <td className="px-2.5 py-1.5">
              <StatusBadge status={rma.status} />
            </td>
            <td className="px-2.5 py-1.5 text-sm">
              {summarizeLines(
                (rma.lines ?? []).map((line) => ({ sku: line.sku, itemName: line.itemName, qty: line.qtyExpected })),
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ReturnDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [rma, setRma] = useState<Rma | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<Record<string, ReturnDisposition>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [next, nextLocations] = await Promise.all([api<Rma>(`/api/returns/${id}`), api<Location[]>("/api/locations")]);
    setRma(next);
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(next.locationId || dock.id);
    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    setDispositions(
      Object.fromEntries(
        (next.lines ?? []).map((line) => {
          try {
            return [line.itemId, parseDisposition(line.disposition)];
          } catch {
            return [line.itemId, "restock" as const];
          }
        }),
      ),
    );
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    setError(null);
    try {
      setRma(await api<Rma>(`/api/returns/${id}/start`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start receiving");
    }
  }

  async function receive() {
    if (!rma) return;
    setError(null);
    try {
      const lines = (rma.lines ?? [])
        .map((line) => ({
          itemId: line.itemId,
          qty: Number(qtys[line.itemId] || 0),
          serials: serials[line.itemId] || undefined,
          weightGrams: parseWeightGrams(weights[line.itemId]),
          expiresOn: parseExpiryInput(expiries[line.itemId]),
          disposition: dispositions[line.itemId] ?? "restock",
        }))
        .filter((line) => line.qty > 0);
      const next = await api<Rma>(`/api/returns/${id}/receive`, {
        method: "POST",
        body: JSON.stringify({ locationId, lines }),
      });
      setRma(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
      setDispositions(
        Object.fromEntries(
          (next.lines ?? []).map((line) => {
            try {
              return [line.itemId, parseDisposition(line.disposition)];
            } catch {
              return [line.itemId, "restock" as const];
            }
          }),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive return");
    }
  }

  if (!rma) return <ErrorBanner error={error} />;
  const remaining = hasRemaining(
    (rma.lines ?? []).map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qtyExpected,
      qtyReceived: line.qtyReceived,
    })),
  );

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Outbound"
        title={rma.number}
        description={`${rma.customerName}${rma.notes ? ` · ${rma.notes}` : ""}`}
        status={rma.status}
        steps={RETURN_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/outbound/returns")}>
              All returns
            </Button>
            {rma.status === "open" ? <Button onClick={() => void start()}>Start receiving</Button> : null}
            {canReceiveReturn(rma.status) && remaining ? <Button onClick={() => void receive()}>Receive</Button> : null}
            {canReceiveReturn(rma.status) && remaining ? (
              <Button variant="secondary">
                <Link to={`/floor/return?id=${rma.id}`}>Floor</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card className="space-y-3">
              {rma.orderId ? (
                <p className="text-sm">
                  Against{" "}
                  <Link className="underline" to={`/outbound/orders/${rma.orderId}`}>
                    {rma.orderNumber || "order"}
                  </Link>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No original order linked.</p>
              )}
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
            <DocumentActivity refId={rma.id} refreshKey={`${rma.status}:${(rma.lines ?? []).map((line) => line.qtyReceived).join(",")}`} />
          </DocumentRail>
        }
      >
        <Table columns={["SKU", "Item", "Expected", "Received", "This receive", "Disposition", "Serials"]}>
          {(rma.lines ?? []).map((line) => (
            <tr key={line.id}>
              <td className="px-2.5 py-1.5 font-mono">{line.sku}</td>
              <td className="px-2.5 py-1.5">{line.itemName}</td>
              <td className="px-2.5 py-1.5 font-mono">{line.qtyExpected}</td>
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
                {line.remaining > 0 ? (
                  <DispositionSelect
                    value={dispositions[line.itemId] ?? "restock"}
                    onChange={(value) => setDispositions((current) => ({ ...current, [line.itemId]: value }))}
                  />
                ) : (
                  <span className="text-muted-foreground capitalize">{line.disposition || "restock"}</span>
                )}
              </td>
              <td className="px-2.5 py-1.5">
                {line.trackSerial ? (
                  <Input
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
