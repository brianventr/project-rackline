import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Client, type Item, type KitBuild, type Location } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";
import { DocumentHeader, DocumentActivity } from "../components/document";
import { AsBuiltList } from "../components/as-built";
import { KIT_STEPS, canCompleteKit, canDekit } from "@/domain/status";
import { useWarehouse, inWarehouse } from "../warehouse";

export function KitsPage() {
  const { id } = useParams();
  if (id) return <KitDetail id={id} />;
  return <KitList />;
}

function KitList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const [kits, setKits] = useState<KitBuild[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [outputLocationId, setOutputLocationId] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextKits, nextItems, nextLocations, nextClients] = await Promise.all([
      api<KitBuild[]>("/api/kits"),
      api<Item[]>("/api/items"),
      api<Location[]>("/api/locations"),
      api<Client[]>("/api/clients"),
    ]);
    setKits(nextKits);
    setItems(nextItems);
    setLocations(nextLocations);
    setClients(nextClients);
    const finished = nextItems.find((item) => item.type === "finished" || item.type === "wip");
    if (finished) setItemId(finished.id);
    const storage = nextLocations.find((location) => location.type === "storage") ?? nextLocations[0];
    const pick = nextLocations.find((location) => location.slotRole === "pick") ?? storage;
    if (storage) setSourceLocationId(storage.id);
    if (pick) setOutputLocationId(pick.id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      const created = await api<KitBuild>("/api/kits", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          itemId,
          qty: Number(qty),
          sourceLocationId,
          outputLocationId,
          clientId: clientId || null,
        }),
      });
      navigate(`/make/kits/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create kit");
    }
  }

  const parents = items.filter((item) => item.type === "finished" || item.type === "wip");

  return (
    <div>
      <PageHeader
        eyebrow="Make"
        title="Kits"
        description="Assemble a finished SKU from its recipe. Complete a partial qty; dekit a finished build."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New kit"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-3">
          <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmit(create)}>
            <Field label="Build item">
              <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Select item</option>
                {parents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sku} — {item.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Client">
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">House (not billed)</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.code} — {client.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantity">
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Consume from">
              <Select value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} — {location.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Put finished">
              <Select value={outputLocationId} onChange={(e) => setOutputLocationId(e.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} — {location.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <Button type="submit">Release kit</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Table columns={["Number", "Item", "Qty", "Completed", "Status"]}>
        {inWarehouse(kits, warehouseId).map((kit) => (
          <tr key={kit.id}>
            <td className="px-2.5 py-1.5 font-mono">
              <Link className="hover:underline" to={`/make/kits/${kit.id}`}>
                {kit.number}
              </Link>
            </td>
            <td className="px-2.5 py-1.5">
              {kit.sku} — {kit.itemName}
            </td>
            <td className="px-2.5 py-1.5 font-mono">{kit.qty}</td>
            <td className="px-2.5 py-1.5 font-mono">{kit.qtyCompleted ?? 0}</td>
            <td className="px-2.5 py-1.5 capitalize">{kit.status}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function KitDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [kit, setKit] = useState<KitBuild | null>(null);
  const [serials, setSerials] = useState("");
  const [thisQty, setThisQty] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<KitBuild>(`/api/kits/${id}`)
      .then((next) => {
        setKit(next);
        setThisQty(String(next.remaining ?? next.qty));
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function complete() {
    setError(null);
    try {
      const next = await api<KitBuild>(`/api/kits/${id}/complete`, {
        method: "POST",
        body: JSON.stringify({ qty: Number(thisQty), serials: serials || undefined }),
      });
      setKit(next);
      setThisQty(String(next.remaining ?? 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    }
  }

  async function dekit() {
    setError(null);
    try {
      setKit(await api<KitBuild>(`/api/kits/${id}/dekit`, { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dekit failed");
    }
  }

  if (!kit) return <ErrorBanner error={error} />;
  const remaining = kit.remaining ?? Math.max(0, kit.qty - (kit.qtyCompleted ?? 0));

  return (
    <div className="space-y-3">
      <DocumentHeader
        eyebrow="Make"
        title={kit.number}
        description={`Kit ${kit.sku} · completed ${kit.qtyCompleted ?? 0}/${kit.qty}`}
        status={kit.status}
        steps={KIT_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/make/kits")}>
              All kits
            </Button>
            {canCompleteKit(kit.status) && remaining > 0 ? <Button onClick={() => void complete()}>Complete</Button> : null}
            {canDekit(kit.status) ? <Button variant="secondary" onClick={() => void dekit()}>Dekit</Button> : null}
            <Button variant="secondary">
              <Link to={`/floor/kit?id=${kit.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      {canCompleteKit(kit.status) && remaining > 0 ? (
        <Field label={`This complete (remaining ${remaining})`}>
          <Input type="number" min={1} max={remaining} value={thisQty} onChange={(e) => setThisQty(e.target.value)} />
        </Field>
      ) : null}
      {kit.trackSerial && canCompleteKit(kit.status) && remaining > 0 ? (
        <Field label="Finished serials (optional — generated if blank)">
          <Input value={serials} onChange={(e) => setSerials(e.target.value)} placeholder="LAMP-2001" />
        </Field>
      ) : null}
      <Table columns={["Component", "Qty each"]}>
        {(kit.components ?? []).map((line) => (
          <tr key={line.itemId}>
            <td className="px-2.5 py-1.5">
              <span className="font-mono">{line.sku}</span> {line.itemName}
            </td>
            <td className="px-2.5 py-1.5 font-mono">{line.qty}</td>
          </tr>
        ))}
      </Table>
      {(kit.asBuilt ?? []).length ? (
        <AsBuiltList title="As-built" empty="No component lots were recorded." rows={kit.asBuilt ?? []} mode="from" />
      ) : null}
      <DocumentActivity refId={kit.id} refreshKey={`${kit.status}:${kit.qtyCompleted ?? 0}`} />
    </div>
  );
}
