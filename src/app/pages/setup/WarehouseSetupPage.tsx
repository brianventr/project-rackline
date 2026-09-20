import { useEffect, useState } from "react";
import { api, type WarehouseMapInfo } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, onSubmit } from "../../components/ui";
import { useWarehouse } from "../../warehouse";

export function WarehouseSetupPage() {
  const warehouse = useWarehouse();
  const [name, setName] = useState("");
  const [mapWidth, setMapWidth] = useState("42");
  const [mapDepth, setMapDepth] = useState("28");
  const [mapHeight, setMapHeight] = useState("8");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const currentId = warehouse.warehouseId;

  useEffect(() => {
    api<WarehouseMapInfo[]>("/api/warehouses")
      .then((rows) => {
        const current = rows.find((row) => row.id === currentId) ?? rows[0];
        if (!current) return;
        setName(current.name);
        setMapWidth(String(current.mapWidth));
        setMapDepth(String(current.mapDepth));
        setMapHeight(String(current.mapHeight));
      })
      .catch((err: Error) => setError(err.message));
  }, [currentId]);

  async function save() {
    if (!currentId) return;
    setError(null);
    setOk(null);
    try {
      await api<WarehouseMapInfo>(`/api/warehouses/${currentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          mapWidth: Number(mapWidth),
          mapDepth: Number(mapDepth),
          mapHeight: Number(mapHeight),
        }),
      });
      setOk("Warehouse saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save warehouse");
    }
  }

  async function addWarehouse() {
    setError(null);
    setOk(null);
    try {
      await api<WarehouseMapInfo>("/api/warehouses", {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      });
      setOk("Warehouse added. Reloading…");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add warehouse");
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Setup" title="Warehouse" description="Name and map size for this building. Bays live under Stock → Locations." />
      <ErrorBanner error={error} />
      {ok ? <p className="mb-4 text-sm">{ok}</p> : null}
      <Card className="mb-6 max-w-xl space-y-3">
        <form className="space-y-3" onSubmit={onSubmit(save)}>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Map width">
              <Input type="number" min={1} value={mapWidth} onChange={(e) => setMapWidth(e.target.value)} />
            </Field>
            <Field label="Map depth">
              <Input type="number" min={1} value={mapDepth} onChange={(e) => setMapDepth(e.target.value)} />
            </Field>
            <Field label="Map height">
              <Input type="number" min={1} value={mapHeight} onChange={(e) => setMapHeight(e.target.value)} />
            </Field>
          </div>
          <Button type="submit">Save warehouse</Button>
        </form>
      </Card>
      <Card className="max-w-xl space-y-3">
        <p className="text-sm font-medium">Add warehouse</p>
        <p className="text-sm text-muted-foreground">Creates another building on this org, then reloads so it appears in the switcher.</p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit(addWarehouse)}>
          <div className="min-w-[12rem] flex-1">
            <Field label="Name">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder="West building" />
            </Field>
          </div>
          <Button type="submit">Add warehouse</Button>
        </form>
      </Card>
    </div>
  );
}
