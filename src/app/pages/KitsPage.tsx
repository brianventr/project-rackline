import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Item, type KitBuild, type Location } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";
import { DocumentHeader, DocumentActivity } from "../components/document";
import { KIT_STEPS, canCompleteKit } from "@/domain/status";
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
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [nextKits, nextItems, nextLocations] = await Promise.all([
      api<KitBuild[]>("/api/kits"),
      api<Item[]>("/api/items"),
      api<Location[]>("/api/locations"),
    ]);
    setKits(nextKits);
    setItems(nextItems);
    setLocations(nextLocations);
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
        body: JSON.stringify({ warehouseId, itemId, qty: Number(qty), sourceLocationId, outputLocationId }),
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
        description="Assemble a finished SKU from its recipe in one step. No in-progress bench."
        actions={<Button onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New kit"}</Button>}
      />
      <ErrorBanner error={error} />
      {creating ? (
        <Card className="mb-6">
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
      <Table columns={["Number", "Item", "Qty", "Status"]}>
        {inWarehouse(kits, warehouseId).map((kit) => (
          <tr key={kit.id}>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/make/kits/${kit.id}`}>
                {kit.number}
              </Link>
            </td>
            <td className="px-4 py-3">
              {kit.sku} — {kit.itemName}
            </td>
            <td className="px-4 py-3 font-mono">{kit.qty}</td>
            <td className="px-4 py-3 capitalize">{kit.status}</td>
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<KitBuild>(`/api/kits/${id}`)
      .then(setKit)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function complete() {
    setError(null);
    try {
      setKit(
        await api<KitBuild>(`/api/kits/${id}/complete`, {
          method: "POST",
          body: JSON.stringify({ serials: serials || undefined }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Complete failed");
    }
  }

  if (!kit) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-6">
      <DocumentHeader
        eyebrow="Make"
        title={kit.number}
        description={`Kit ${kit.sku} × ${kit.qty}`}
        status={kit.status}
        steps={KIT_STEPS}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/make/kits")}>
              All kits
            </Button>
            {canCompleteKit(kit.status) ? <Button onClick={() => void complete()}>Complete</Button> : null}
            <Button variant="secondary">
              <Link to={`/floor/kit?id=${kit.id}`}>Floor</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      {kit.trackSerial && canCompleteKit(kit.status) ? (
        <Field label="Finished serials (optional — generated if blank)">
          <Input value={serials} onChange={(e) => setSerials(e.target.value)} placeholder="LAMP-2001" />
        </Field>
      ) : null}
      <Table columns={["Component", "Qty each"]}>
        {(kit.components ?? []).map((line) => (
          <tr key={line.itemId}>
            <td className="px-4 py-3">
              <span className="font-mono">{line.sku}</span> {line.itemName}
            </td>
            <td className="px-4 py-3 font-mono">{line.qty}</td>
          </tr>
        ))}
      </Table>
      <DocumentActivity refId={kit.id} refreshKey={kit.status} />
    </div>
  );
}
