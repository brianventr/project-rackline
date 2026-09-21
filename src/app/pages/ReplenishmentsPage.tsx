import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type Location, type ReplenishSuggestion, type Replenishment } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";
import { DocumentHeader, DocumentActivity } from "../components/document";
import { REPLENISH_STEPS, canPostReplenishment } from "@/domain/status";
import { remainingToReplenish } from "@/domain/partial-replenish";
import { useWarehouse, inWarehouse } from "../warehouse";

export function ReplenishmentsPage() {
  const { id } = useParams();
  if (id) return <ReplenishmentDetail id={id} />;
  return <ReplenishmentList />;
}

function ReplenishmentList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [rows, setRows] = useState<Replenishment[]>([]);
  const [suggestions, setSuggestions] = useState<ReplenishSuggestion[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    const [nextRows, nextSuggestions, nextItems, nextLocations] = await Promise.all([
      api<Replenishment[]>("/api/replenishments"),
      api<ReplenishSuggestion[]>(`/api/replenishments/suggestions${query}`),
      api<Item[]>("/api/items"),
      api<Location[]>("/api/locations"),
    ]);
    setRows(nextRows);
    setSuggestions(nextSuggestions);
    setItems(nextItems);
    setLocations(nextLocations);
    const first = nextSuggestions[0];
    if (first) {
      setItemId(first.itemId);
      setQty(String(first.qty));
      setFromLocationId(first.fromLocationId);
      setToLocationId(first.toLocationId);
    } else {
      if (nextItems[0]) setItemId(nextItems[0].id);
      const bulk = nextLocations.find((row) => row.slotRole === "bulk") ?? nextLocations[0];
      const pick = nextLocations.find((row) => row.slotRole === "pick") ?? nextLocations[1];
      if (bulk) setFromLocationId(bulk.id);
      if (pick) setToLocationId(pick.id);
    }
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [warehouseId]);

  async function create() {
    setError(null);
    try {
      const created = await api<Replenishment>("/api/replenishments", {
        method: "POST",
        body: JSON.stringify({ warehouseId, itemId, qty: Number(qty), fromLocationId, toLocationId }),
      });
      navigate(`/stock/replenish/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create replenishment");
    }
  }

  async function fromSuggestion(row: ReplenishSuggestion) {
    setError(null);
    try {
      const created = await api<Replenishment>("/api/replenishments", {
        method: "POST",
        body: JSON.stringify({
          warehouseId: row.warehouseId,
          itemId: row.itemId,
          qty: row.qty,
          fromLocationId: row.fromLocationId,
          toLocationId: row.toLocationId,
        }),
      });
      navigate(`/stock/replenish/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create replenishment");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Stock"
        title="Replenish"
        description="Move remaining qty from bulk into a pick face when it drops below pick min. Distinct from dock putaway."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary">
              <Link to="/floor/replenish">Floor</Link>
            </Button>
            <Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New replenishment"}</Button>
          </div>
        }
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-3">
          <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmit(create)}>
            <Field label="Item">
              <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} — {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Qty">
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="From bulk">
              <Select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} {location.slotRole && location.slotRole !== "none" ? `(${location.slotRole})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="To pick face">
              <Select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} {location.slotRole && location.slotRole !== "none" ? `(${location.slotRole})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <Button type="submit">Create replenishment</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {suggestions.length ? (
        <Card className="mb-3">
          <p className="mb-3 font-medium">Suggested from pick min</p>
          <ul className="space-y-2 text-sm">
            {suggestions.map((row) => (
              <li key={`${row.itemId}:${row.toLocationId}`} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
                <div>
                  <p className="font-medium">
                    <span className="font-mono">{row.sku}</span> {row.qty} from {row.fromCode} → {row.toCode}
                  </p>
                  <p className="text-muted-foreground">
                    Pick face {row.pickQty}/{row.pickMin}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => void fromSuggestion(row)}>
                  Queue
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Table columns={["Number", "Item", "Move", "Moved", "Status"]}>
        {inWarehouse(rows, warehouseId).map((row) => (
          <tr key={row.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/stock/replenish/${row.id}`}>
                {row.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5">
              {row.sku} — {row.itemName}
            </td>
            <td className="px-2.5 py-1.5 font-mono text-sm">
              {row.fromCode} → {row.toCode}
            </td>
            <td className="px-2.5 py-1.5 font-mono">
              {row.qtyMoved ?? 0}/{row.qty}
            </td>
            <td className="px-2.5 py-1.5 capitalize">{row.status.replaceAll("_", " ")}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function ReplenishmentDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Replenishment | null>(null);
  const [thisQty, setThisQty] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Replenishment>(`/api/replenishments/${id}`)
      .then((next) => {
        setDoc(next);
        setThisQty(String(next.remaining ?? remainingToReplenish(next.qty, next.qtyMoved ?? 0)));
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    setError(null);
    try {
      setDoc(await api<Replenishment>(`/api/replenishments/${id}/start`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    }
  }

  async function post() {
    setError(null);
    try {
      const next = await api<Replenishment>(`/api/replenishments/${id}/post`, {
        method: "POST",
        body: JSON.stringify({ qty: Number(thisQty) }),
      });
      setDoc(next);
      setThisQty(String(next.remaining ?? remainingToReplenish(next.qty, next.qtyMoved ?? 0)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Post failed");
    }
  }

  if (!doc) return <ErrorBanner error={error} />;
  const remaining = doc.remaining ?? remainingToReplenish(doc.qty, doc.qtyMoved ?? 0);

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Stock"
        title={doc.number}
        description={`${doc.sku} · moved ${doc.qtyMoved ?? 0}/${doc.qty} from ${doc.fromCode} to ${doc.toCode}`}
        status={doc.status}
        steps={REPLENISH_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/stock/replenish")}>
              All replenishments
            </Button>
            {doc.status === "draft" ? <Button onClick={() => void start()}>Start</Button> : null}
            {canPostReplenishment(doc.status) && remaining > 0 ? <Button onClick={() => void post()}>Post</Button> : null}
            <Button variant="secondary">
              <Link to={`/floor/replenish?id=${doc.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      {canPostReplenishment(doc.status) && remaining > 0 ? (
        <Field label={`This move (remaining ${remaining})`}>
          <Input type="number" min={1} max={remaining} value={thisQty} onChange={(e) => setThisQty(e.target.value)} />
        </Field>
      ) : null}
      <DocumentActivity refId={doc.id} refreshKey={`${doc.status}:${doc.qtyMoved ?? 0}`} />
    </div>
  );
}
