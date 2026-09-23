import { useEffect, useState, type ReactNode } from "react";
import { Factory, Plus, Wrench, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { api, type WarehouseMapInfo } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, ToneBadge, onSubmit } from "../../components/ui";
import { useWarehouse } from "../../warehouse";
import { useOperatingMode } from "../../use-operating-mode";
import { useWrite } from "../../use-write";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { GARAGE_MODE_LABEL, GARAGE_SWITCH_LABEL, MANUFACTURER_MODE_LABEL, type OperatingMode } from "@/domain/operating-mode";

export function WarehouseSetupPage() {
  const operating = useOperatingMode();
  const garage = operating.garage;
  const warehouse = useWarehouse();
  const write = useWrite();
  const [loaded, setLoaded] = useState(false);
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
  const currentId = warehouse.warehouseId;

  useEffect(() => {
    api<WarehouseMapInfo[]>("/api/warehouses")
      .then((rows) => {
        const current = rows.find((row) => row.id === currentId) ?? rows[0];
        setLoaded(true);
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
      .catch((err: Error) => write.setError(err.message));
  }, [currentId]);

  const setOperatingMode = (operatingMode: OperatingMode) =>
    write.run(
      "Change mode",
      () => operating.setMode(operatingMode),
      operatingMode === "garage"
        ? "Garage Mode is on. Same parts, orders, and builds."
        : "Manufacturer is on. The rest of the floor is open.",
    );

  async function save() {
    if (!currentId) return;
    await write.run(
      "Save warehouse",
      () =>
        api<WarehouseMapInfo>(`/api/warehouses/${currentId}`, {
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
        }),
      "Warehouse saved.",
    );
  }

  async function addWarehouse() {
    const created = await write.run("Add warehouse", () =>
      api<WarehouseMapInfo>("/api/warehouses", {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      }),
    );
    if (!created) return;
    toast.success("Warehouse added. Reloading…");
    window.location.reload();
  }

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Warehouse"
        description="Name, ship-from address, origin city, and map size for this building. Bays live under Stock → Locations."
      />
      <ErrorBanner error={write.error} />

      <Card>
        <div className="space-y-3">
          <SectionHeading
            title="Operating mode"
            description="Switching keeps the same parts, orders, and builds. Only what shows on the floor changes."
          />
          <div className="grid gap-3 md:grid-cols-2">
            <ModeOption
              icon={Wrench}
              title={GARAGE_MODE_LABEL}
              body="The bench founders and inventors start on. Receive, make, pick, and ship. Yard, waves, ASN, equipment, and 3PL stay packed away."
              current={garage}
              switchLabel={`Switch to ${GARAGE_SWITCH_LABEL}`}
              disabled={operating.busy || write.busy || !operating.owner}
              onSwitch={() => void setOperatingMode("garage")}
            />
            <ModeOption
              icon={Factory}
              title={MANUFACTURER_MODE_LABEL}
              body="Yard, waves, ASN, equipment, and 3PL are on this floor, next to the founder bench."
              current={!garage}
              switchLabel={`Switch to ${MANUFACTURER_MODE_LABEL}`}
              disabled={operating.busy || write.busy || !operating.owner}
              onSwitch={() => void setOperatingMode("warehouse")}
            />
          </div>
        </div>
      </Card>

      <Card>
        <form className="space-y-4" onSubmit={onSubmit(save)}>
          <SectionHeading title="Building" description={`Settings for ${warehouse.warehouse?.name ?? "this warehouse"}.`} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Timezone">
              <Input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="America/Los_Angeles" />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Live starts this building&apos;s day at local midnight. Use an IANA name such as America/Los_Angeles.
          </p>

          <div className="space-y-3 border-t pt-4">
            <SectionHeading
              title="Address"
              description={
                garage
                  ? "Ship-from for labels. A second building and Traffic open with Manufacturer."
                  : "Ship-from for labels, and the origin for Analytics → Traffic. Lane estimates fly from this city, not live GPS."
              }
            />
            <Field label="Ship-from address">
              <Textarea
                value={shipFromAddress}
                onChange={(e) => setShipFromAddress(e.target.value)}
                rows={3}
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
          </div>

          <div className="space-y-3 border-t pt-4">
            <SectionHeading title="Map size" description="The floor size the Map draws bays on." />
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
          </div>

          <div className="flex justify-end border-t pt-3">
            <Button type="submit" disabled={write.busy || !loaded || !currentId}>
              Save warehouse
            </Button>
          </div>
        </form>
      </Card>

      {garage ? null : (
        <Card>
          <div className="space-y-3">
            <SectionHeading
              title="Add warehouse"
              description="Creates another building on this org, then reloads so it appears in the switcher."
            />
            <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit(addWarehouse)}>
              <div className="min-w-[12rem] flex-1">
                <Field label="Name">
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder="West building" />
                </Field>
              </div>
              <Button type="submit" variant="outline" disabled={write.busy}>
                <Plus className="size-4" />
                Add warehouse
              </Button>
            </form>
          </div>
        </Card>
      )}
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="min-w-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function ModeOption({
  icon: Icon,
  title,
  body,
  current,
  switchLabel,
  disabled,
  onSwitch,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  current: boolean;
  switchLabel: string;
  disabled: boolean;
  onSwitch: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3",
        current ? "border-primary/50 bg-primary/5 ring-2 ring-primary/10" : "bg-card",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{title}</p>
            {current ? <ToneBadge tone="success">Current</ToneBadge> : null}
          </div>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
      {current ? null : (
        <div className="mt-auto flex justify-end">
          <Button size="sm" variant="outline" disabled={disabled} onClick={onSwitch}>
            {switchLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
