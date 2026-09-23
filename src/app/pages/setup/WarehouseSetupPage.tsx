import { useEffect, useState, type ReactNode } from "react";
import { Factory, Plus, Wrench, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api, errorText, type WarehouseMapInfo } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, ToneBadge, onSubmit } from "../../components/ui";
import { NumberField, TextField, TextareaField, useZodForm, type ZodFormOutput } from "../../components/form-kit";
import { Term } from "../../components/term";
import { useWarehouse } from "../../warehouse";
import { useOperatingMode } from "../../use-operating-mode";
import { useWrite } from "../../use-write";
import { cn } from "@/lib/utils";
import { optionalText, wholeNumber } from "@/domain/form-schemas";
import { GARAGE_MODE_LABEL, GARAGE_SWITCH_LABEL, MANUFACTURER_MODE_LABEL, type OperatingMode } from "@/domain/operating-mode";
import { isValidTimeZone } from "@/domain/time-zone";

function mapSize(label: string) {
  return wholeNumber(1, {
    empty: `Enter the map ${label}.`,
    notWhole: `Map ${label} must be a whole number.`,
    tooSmall: `Map ${label} must be 1 or more.`,
  });
}

/**
 * PATCH /api/warehouses/:id (`src/routes/catalog.ts`): a blank name keeps the old one, map sizes are
 * whole numbers above 0, and the timezone must be an IANA name (`parseTimeZone`).
 */
const buildingFormSchema = z.object({
  name: optionalText,
  timeZone: z.string().superRefine((value, ctx) => {
    if (!value.trim()) {
      ctx.addIssue({ code: "custom", message: "Enter a timezone, like America/Los_Angeles.", input: value });
    } else if (!isValidTimeZone(value.trim())) {
      ctx.addIssue({ code: "custom", message: "Use an IANA timezone name, like America/Los_Angeles.", input: value });
    }
  }),
  shipFromAddress: optionalText,
  city: optionalText,
  region: optionalText,
  country: optionalText,
  mapWidth: mapSize("width"),
  mapDepth: mapSize("depth"),
  mapHeight: mapSize("height"),
});

export function WarehouseSetupPage() {
  const operating = useOperatingMode();
  const garage = operating.garage;
  const warehouse = useWarehouse();
  const write = useWrite();
  const [loaded, setLoaded] = useState(false);
  const form = useZodForm(buildingFormSchema, {
    name: "",
    timeZone: "UTC",
    shipFromAddress: "",
    city: "",
    region: "",
    country: "",
    mapWidth: "42",
    mapDepth: "28",
    mapHeight: "8",
  });
  const [newName, setNewName] = useState("");
  const currentId = warehouse.warehouseId;

  // Load this building's settings into the form.
  const { reset } = form;
  useEffect(() => {
    api<WarehouseMapInfo[]>("/api/warehouses")
      .then((rows) => {
        const current = rows.find((row) => row.id === currentId) ?? rows[0];
        setLoaded(true);
        if (!current) return;
        reset({
          name: current.name,
          timeZone: current.timeZone || "UTC",
          shipFromAddress: current.shipFromAddress || "",
          city: current.city || "",
          region: current.region || "",
          country: current.country || "",
          mapWidth: String(current.mapWidth),
          mapDepth: String(current.mapDepth),
          mapHeight: String(current.mapHeight),
        });
      })
      .catch((err: unknown) => write.setError(errorText(err, "Could not load this warehouse.")));
  }, [currentId]);

  const setOperatingMode = (operatingMode: OperatingMode) =>
    write.run(
      "Change mode",
      () => operating.setMode(operatingMode),
      operatingMode === "garage"
        ? "Garage Mode is on. Same parts, orders, and builds."
        : "Manufacturer is on. The rest of the floor is open.",
    );

  async function save(values: ZodFormOutput<typeof buildingFormSchema>) {
    if (!currentId) return;
    await write.run(
      "Save warehouse",
      () =>
        api<WarehouseMapInfo>(`/api/warehouses/${currentId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: values.name,
            mapWidth: values.mapWidth,
            mapDepth: values.mapDepth,
            mapHeight: values.mapHeight,
            shipFromAddress: values.shipFromAddress,
            city: values.city,
            region: values.region,
            country: values.country,
            timeZone: values.timeZone,
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
            description={
              <>
                Switching between <Term id="garage-mode">Garage Mode</Term> and Manufacturer keeps the same parts, orders, and
                builds. Only what shows on the floor changes.
              </>
            }
          />
          <div className="grid gap-3 md:grid-cols-2">
            <ModeOption
              icon={Wrench}
              title={GARAGE_MODE_LABEL}
              body={
                <>
                  The bench founders and inventors start on. Receive, make, pick, and ship. Yard, waves,{" "}
                  <Term id="asn">ASN</Term>, equipment, and <Term id="3pl-client">3PL</Term> stay packed away.
                </>
              }
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
        <form className="space-y-4" onSubmit={form.handleSubmit(save)}>
          <SectionHeading title="Building" description={`Settings for ${warehouse.warehouse?.name ?? "this warehouse"}.`} />
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <TextField form={form} name="name" label="Name" />
            <TextField
              form={form}
              name="timeZone"
              label="Timezone"
              placeholder="America/Los_Angeles"
              description="Live starts this building's day at local midnight. Use an IANA name such as America/Los_Angeles."
            />
          </div>

          <div className="space-y-3 border-t pt-4">
            <SectionHeading
              title="Address"
              description={
                garage
                  ? "Ship-from for labels. A second building and Traffic open with Manufacturer."
                  : "Ship-from for labels, and the origin for Analytics → Traffic. Lane estimates fly from this city, not live GPS."
              }
            />
            <TextareaField
              form={form}
              name="shipFromAddress"
              label="Ship-from address"
              rows={3}
              placeholder="14 Dock St, Portland, OR 97209"
            />
            <div className="grid grid-cols-3 items-start gap-3">
              <TextField form={form} name="city" label="City" placeholder="Portland" />
              <TextField form={form} name="region" label="State" placeholder="OR" />
              <TextField form={form} name="country" label="Country" placeholder="US" />
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <SectionHeading title="Map size" description="The floor size the Map draws bays on." />
            <div className="grid grid-cols-3 items-start gap-3">
              <NumberField form={form} name="mapWidth" label="Map width" min={1} />
              <NumberField form={form} name="mapDepth" label="Map depth" min={1} />
              <NumberField form={form} name="mapHeight" label="Map height" min={1} />
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
  body: ReactNode;
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
