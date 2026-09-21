import { useEffect, useState } from "react";
import { api, type Location, type Zone } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Select, Table, onSubmit } from "../../components/ui";
import { useWarehouse, inWarehouse } from "../../warehouse";

export function ZonesPage() {
  const { warehouseId } = useWarehouse();
  const [zones, setZones] = useState<Zone[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [assignZoneId, setAssignZoneId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    const [nextZones, nextLocations] = await Promise.all([
      api<Zone[]>(`/api/zones${query}`),
      api<Location[]>("/api/locations"),
    ]);
    setZones(nextZones);
    const scoped = inWarehouse(nextLocations, warehouseId);
    setLocations(scoped);
    if (!locationId && scoped[0]) setLocationId(scoped[0].id);
    if (!assignZoneId && nextZones[0]) setAssignZoneId(nextZones[0].id);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [warehouseId]);

  async function create() {
    setError(null);
    try {
      await api<Zone>("/api/zones", {
        method: "POST",
        body: JSON.stringify({ warehouseId, code, name }),
      });
      setCode("");
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create zone");
    }
  }

  async function assign() {
    setError(null);
    try {
      await api(`/api/locations/${locationId}/zone`, {
        method: "POST",
        body: JSON.stringify({ zoneId: assignZoneId || null }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign zone");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Zones"
        description="Pick / put zones for this warehouse. Assign bays so waves can stay in-zone."
      />
      <ErrorBanner error={error} />
      <Card className="mb-3">
        <form className="grid gap-3 md:grid-cols-3" onSubmit={onSubmit(create)}>
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="A" />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Aisle A" />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Add zone</Button>
          </div>
        </form>
      </Card>
      <Table columns={["Code", "Name"]}>
        {zones.map((zone) => (
          <tr key={zone.id}>
            <td className="px-2.5 py-1.5 font-mono">{zone.code}</td>
            <td className="px-2.5 py-1.5">{zone.name}</td>
          </tr>
        ))}
      </Table>
      <Card className="mt-6 max-w-xl space-y-3">
        <p className="text-sm font-medium">Assign location to zone</p>
        <Field label="Location">
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} — {location.name}
                {location.zoneId ? " (zoned)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Zone">
          <Select value={assignZoneId} onChange={(e) => setAssignZoneId(e.target.value)}>
            <option value="">Clear zone</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.code} — {zone.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={() => void assign()}>Assign</Button>
      </Card>
    </div>
  );
}
