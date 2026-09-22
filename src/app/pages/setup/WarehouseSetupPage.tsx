import { useEffect, useState } from "react";
import { api, type WarehouseMapInfo } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, onSubmit } from "../../components/ui";
import { useWarehouse } from "../../warehouse";
import { useSession } from "../../session";
import { GARAGE_MODE_LABEL, isGarageMode, type OperatingMode } from "@/domain/operating-mode";

export function WarehouseSetupPage() {
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  const warehouse = useWarehouse();
  const [name, setName] = useState("");
  const [mapWidth, setMapWidth] = useState("42");
  const [mapDepth, setMapDepth] = useState("28");
  const [mapHeight, setMapHeight] = useState("8");
  const [shipFromAddress, setShipFromAddress] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [timeZone, setTimeZone] = useState("UTC");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
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
        setShipFromAddress(current.shipFromAddress || "");
        setCity(current.city || "");
        setRegion(current.region || "");
        setCountry(current.country || "");
        setTimeZone(current.timeZone || "UTC");
      })
      .catch((err: Error) => setError(err.message));
  }, [currentId]);

  async function setOperatingMode(operatingMode: OperatingMode) {
    setError(null);
    setOk(null);
    setModeBusy(true);
    try {
      await api("/api/organization", {
        method: "PATCH",
        body: JSON.stringify({ operatingMode }),
      });
      window.location.assign("/today");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change mode");
      setModeBusy(false);
    }
  }

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
          shipFromAddress,
          city,
          region,
          country,
          timeZone,
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
      <PageHeader
        eyebrow="Setup"
        title="Warehouse"
        description="Name, ship-from address, origin city, and map size for this building. Bays live under Stock → Locations."
      />
      <ErrorBanner error={error} />
      {ok ? <p className="mb-4 text-sm">{ok}</p> : null}
      <Card className="mb-6 max-w-xl space-y-3">
        <div className="space-y-2">
          <p className="text-sm font-medium">{garage ? GARAGE_MODE_LABEL : "Full warehouse"}</p>
          <p className="text-sm text-muted-foreground">
            {garage
              ? "The bench founders and inventors start on. Receive, make, pick, and ship. Yard, waves, ASN, equipment, and 3PL stay packed away until you open the full warehouse — same ledger."
              : "Yard, waves, ASN, equipment, and 3PL are on this floor. Garage Mode puts them away and leaves the founder bench: receive, make, pick, and ship."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={garage ? "primary" : "ghost"}
              disabled={modeBusy || garage}
              onClick={() => void setOperatingMode("garage")}
            >
              {GARAGE_MODE_LABEL}
            </Button>
            <Button
              type="button"
              variant={garage ? "ghost" : "primary"}
              disabled={modeBusy || !garage}
              onClick={() => void setOperatingMode("warehouse")}
            >
              Open the full warehouse
            </Button>
          </div>
        </div>
      </Card>
      <Card className="mb-6 max-w-xl space-y-3">
        <form className="space-y-3" onSubmit={onSubmit(save)}>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Ship-from address">
            <textarea
              value={shipFromAddress}
              onChange={(e) => setShipFromAddress(e.target.value)}
              rows={3}
              className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              placeholder="14 Dock St, Portland, OR 97209"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Portland" />
            </Field>
            <Field label="State">
              <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="OR" />
            </Field>
            <Field label="Country">
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" />
            </Field>
          </div>
          <Field label="Timezone">
            <Input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="America/Los_Angeles" />
          </Field>
          <p className="text-xs text-muted-foreground">
            Live starts this building&apos;s day at local midnight. Use an IANA name such as America/Los_Angeles.
          </p>
          <p className="text-xs text-muted-foreground">
            {garage
              ? "Ship-from for labels. A second building and Traffic open with the full warehouse."
              : "Origin for Analytics → Traffic. Lane estimates fly from this city, not live GPS."}
          </p>
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
      {garage ? null : (
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
      )}
    </div>
  );
}
