import { useEffect, useState } from "react";
import { api, type Location, type Me } from "../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../components/ui";

const types = ["receiving", "storage", "production", "shipping"];

export function LocationsPage({ me }: { me: Me }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("storage");
  const [error, setError] = useState<string | null>(null);
  const warehouseId = me.warehouses[0]?.id;

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
        body: JSON.stringify({ warehouseId, code, name, type }),
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

  return (
    <div>
      <PageHeader
        eyebrow="Warehouse"
        title="Locations"
        description="Bins, docks, and benches. Stock lives here — never on the item record alone."
      />
      <ErrorBanner error={error} />
      <Card className="mb-6">
        <form className="grid gap-3 md:grid-cols-4" onSubmit={onSubmit(create)}>
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A-01-01" required />
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
          <div className="flex items-end">
            <Button type="submit">Add location</Button>
          </div>
        </form>
      </Card>
      <Table columns={["Code", "Name", "Type", "Warehouse", ""]}>
        {locations.map((location) => (
          <tr key={location.id}>
            <td className="px-4 py-3 font-mono">{location.code}</td>
            <td className="px-4 py-3">{location.name}</td>
            <td className="px-4 py-3 capitalize">{location.type}</td>
            <td className="px-4 py-3">{location.warehouseName}</td>
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
