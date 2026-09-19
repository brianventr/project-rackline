import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Location, type Me } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";
import { useWarehouse } from "../warehouse";

const types = ["receiving", "storage", "production", "shipping"];

export function LocationsPage({ me }: { me: Me }) {
  const { id } = useParams();
  if (id) return <LocationDetail me={me} id={id} />;
  return <LocationList me={me} />;
}

function LocationDetail({ me, id }: { me: Me; id: string }) {
  const navigate = useNavigate();
  const [location, setLocation] = useState<(Location & { contents?: { itemId: string; sku: string; itemName: string; qty: number }[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Location & { contents?: { itemId: string; sku: string; itemName: string; qty: number }[] }>(`/api/locations/${id}`)
      .then(setLocation)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (!location) return <ErrorBanner error={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Stock"
        title={location.code}
        description={location.name}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/stock/locations")}>
              All locations
            </Button>
            <Button variant="secondary">
              <Link to={`/map?location=${location.id}`}>Map</Link>
            </Button>
            <Button>
              <Link to={`/floor/putaway?from=${encodeURIComponent(location.barcode)}`}>Move</Link>
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />
      <div className="max-w-sm rounded-lg border p-3">
        <BarcodeLabel value={location.barcode} className="mx-auto h-16" />
      </div>
      <Table columns={["SKU", "Item", "Qty"]}>
        {(location.contents ?? []).map((row) => (
          <tr key={row.itemId}>
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/stock/items/${row.itemId}`}>
                {row.sku}
              </Link>
            </td>
            <td className="px-4 py-3">{row.itemName}</td>
            <td className="px-4 py-3 font-mono">{row.qty}</td>
          </tr>
        ))}
      </Table>
      {me.role === "owner" ? (
        <p className="text-sm text-muted-foreground">Drag this bay on the map to match the real floor.</p>
      ) : null}
    </div>
  );
}

function LocationList({ me }: { me: Me }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("storage");
  const [aisle, setAisle] = useState("A");
  const [rack, setRack] = useState("01");
  const [bay, setBay] = useState("01");
  const [level, setLevel] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState(false);
  const { warehouseId } = useWarehouse();

  async function load() {
    setLocations(await api<Location[]>("/api/locations"));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, []);

  async function create() {
    setError(null);
    try {
      if (!warehouseId) throw new Error("Create a warehouse first");
      await api("/api/locations", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          code,
          name,
          type,
          barcode: code,
          aisle: type === "storage" ? aisle : undefined,
          rack: type === "storage" ? rack : undefined,
          bay: type === "storage" ? bay : undefined,
          level: Number(level),
        }),
      });
      setCode("");
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create location");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/api/locations/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete location");
    }
  }

  if (labels) {
    return (
      <div>
        <PageHeader
          eyebrow="Bin labels"
          title="Print location barcodes"
          description="Tape these on the physical bay. Scanning the label is enough to move stock."
          actions={
            <div className="flex gap-2 print:hidden">
              <Button variant="ghost" onClick={() => setLabels(false)}>
                Back
              </Button>
              <Button onClick={() => window.print()}>Print</Button>
            </div>
          }
        />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-3">
          {locations.filter((location) => !warehouseId || location.warehouseId === warehouseId).map((location) => (
            <div key={location.id} className="break-inside-avoid rounded-xl border border-line bg-card p-3">
              <p className="font-mono text-sm font-semibold">{location.code}</p>
              <p className="text-xs text-muted-foreground">{location.name}</p>
              <BarcodeLabel value={location.barcode} className="mt-2 w-full" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {location.area} · {location.posX},{location.posY},{location.posZ}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Stock"
        title="Locations"
        description="Each code is a physical bay on the map. Print barcodes, then scan to move slots."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setLabels(true)}>
              Print labels
            </Button>
            <Link className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold" to="/map">
              Open map
            </Link>
            <Link className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground" to="/map?edit=1">
              Build floor
            </Link>
          </div>
        }
      />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={onSubmit(create)}>
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A-01-04" required />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Level">
            <Input type="number" min={1} value={level} onChange={(e) => setLevel(e.target.value)} />
          </Field>
          {type === "storage" ? (
            <>
              <Field label="Aisle">
                <Input value={aisle} onChange={(e) => setAisle(e.target.value)} placeholder="A" />
              </Field>
              <Field label="Rack">
                <Input value={rack} onChange={(e) => setRack(e.target.value)} placeholder="01" />
              </Field>
              <Field label="Bay">
                <Input value={bay} onChange={(e) => setBay(e.target.value)} placeholder="01" />
              </Field>
            </>
          ) : null}
          <div className="flex items-end">
            <Button type="submit">Add location</Button>
          </div>
        </form>
      </Card>
      <Table columns={["Code", "Name", "Bay", "Map", "Barcode", ""]}>
        {locations
          .filter((location) => !warehouseId || location.warehouseId === warehouseId)
          .map((location) => (
          <tr key={location.id}>
            <td className="px-4 py-3 font-mono">
              <Link className="underline decoration-line underline-offset-2" to={`/stock/locations/${location.id}`}>
                {location.code}
              </Link>
            </td>
            <td className="px-4 py-3">{location.name}</td>
            <td className="px-4 py-3 text-sm text-muted-foreground">
              {location.area}
              {location.aisle ? ` · ${location.aisle}-${location.rack}-${location.bay}` : ""} L{location.level}
            </td>
            <td className="px-4 py-3 font-mono text-xs">
              {location.posX},{location.posY},{location.posZ}
            </td>
            <td className="px-4 py-3 font-mono text-xs">{location.barcode}</td>
            <td className="px-4 py-3 text-right">
              {me.role === "owner" ? (
                <button className="text-sm text-bad" onClick={() => remove(location.id)}>
                  Delete
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
