import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Factory, Plus, Wrench, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api, errorText, type CarrierHub, type CarrierServiceOption, type WarehouseMapInfo } from "../../api";
import { Button, Card, ErrorBanner, Field, Input, PageHeader, ToneBadge, onSubmit } from "../../components/ui";
import {
  NumberField,
  SelectField,
  TextField,
  TextareaField,
  useZodForm,
  type ZodFormOutput,
} from "../../components/form-kit";
import { Term } from "../../components/term";
import { useWarehouse } from "../../warehouse";
import { useOperatingMode } from "../../use-operating-mode";
import { useWrite } from "../../use-write";
import { cn } from "@/lib/utils";
import { optionalText, wholeNumber } from "@/domain/form-schemas";
import {
  GARAGE_MODE_LABEL,
  GARAGE_SWITCH_LABEL,
  MANUFACTURER_MODE_LABEL,
  MODE_SWITCH_RULES,
  type OperatingMode,
} from "@/domain/operating-mode";
import { isValidTimeZone } from "@/domain/time-zone";
import { RATE_STRATEGIES, RATE_STRATEGY_LABELS } from "@/domain/ship-rules";
import { MAX_DELIVERY_DAYS } from "@/domain/rate-choice";
import { describeNorth, NORTH_PRESETS, normalizeHeading } from "@/domain/compass";
import { CompassRose } from "../../components/CompassRose";
import { TrackingPageCard } from "./TrackingPageCard";
import { CustomerNotificationsCard } from "./CustomerNotificationsCard";

function mapSize(label: string) {
  return wholeNumber(1, {
    empty: `Enter the map ${label}.`,
    notWhole: `Map ${label} must be a whole number.`,
    tooSmall: `Map ${label} must be 1 or more.`,
  });
}

/**
 * PATCH /api/warehouses/:id (`src/routes/catalog.ts`): a blank name keeps the old one, map sizes are
 * whole numbers above 0, the timezone must be an IANA name (`parseTimeZone`), the default service
 * must be enabled on a connected carrier account (`resolveLabelPurchase`), and the delivery promise
 * is blank or 1 to `MAX_DELIVERY_DAYS` working days.
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
  returnAddress: optionalText,
  city: optionalText,
  region: optionalText,
  country: optionalText,
  mapWidth: mapSize("width"),
  mapDepth: mapSize("depth"),
  mapHeight: mapSize("height"),
  mapNorth: wholeNumber(0, {
    empty: "Enter where north points, 0–359.",
    notWhole: "North must be a whole number of degrees.",
    tooSmall: "North must be 0 or more.",
  }).refine((value) => value <= 359, { message: "North must be 359 or less." }),
  defaultCarrierService: z.string(),
  rateStrategy: z.string(),
  deliveryDays: z.string().superRefine((value, ctx) => {
    const text = value.trim();
    const days = Number(text);
    if (text && (!Number.isInteger(days) || days < 1 || days > MAX_DELIVERY_DAYS)) {
      ctx.addIssue({ code: "custom", message: `Promise 1 to ${MAX_DELIVERY_DAYS} working days, or leave it blank.`, input: value });
    }
  }),
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
    returnAddress: "",
    city: "",
    region: "",
    country: "",
    mapWidth: "42",
    mapDepth: "28",
    mapHeight: "8",
    mapNorth: "0",
    defaultCarrierService: "",
    rateStrategy: "default",
    deliveryDays: "",
  });
  const [newName, setNewName] = useState("");
  const [services, setServices] = useState<CarrierServiceOption[]>([]);
  const [savedService, setSavedService] = useState("");
  const currentId = warehouse.warehouseId;

  // Load this building's settings into the form.
  const { reset } = form;
  useEffect(() => {
    Promise.all([
      api<WarehouseMapInfo[]>("/api/warehouses"),
      api<CarrierHub>(`/api/carriers?warehouseId=${encodeURIComponent(currentId)}`).catch(() => null),
    ])
      .then(([rows, carriers]) => {
        const current = rows.find((row) => row.id === currentId) ?? rows[0];
        setLoaded(true);
        setServices(carriers?.enabledServices ?? []);
        if (!current) return;
        const service = carriers?.warehouseId === current.id ? (carriers.defaultService?.serviceId ?? "") : "";
        setSavedService(service);
        reset({
          name: current.name,
          timeZone: current.timeZone || "UTC",
          shipFromAddress: current.shipFromAddress || "",
          returnAddress: current.returnAddress || "",
          city: current.city || "",
          region: current.region || "",
          country: current.country || "",
          mapWidth: String(current.mapWidth),
          mapDepth: String(current.mapDepth),
          mapHeight: String(current.mapHeight),
          mapNorth: String(current.mapNorth ?? 0),
          defaultCarrierService: service,
          rateStrategy: current.rateStrategy || "default",
          deliveryDays: current.deliveryDays ? String(current.deliveryDays) : "",
        });
      })
      .catch((err: unknown) => write.setError(errorText(err, "Could not load this warehouse.")));
  }, [currentId]);

  const setOperatingMode = (operatingMode: OperatingMode) =>
    write.run(
      "Change mode",
      () => operating.setMode(operatingMode),
      operatingMode === "garage"
        ? "Garage Mode is on. One-click ship is back on the Ship queue, and scans are optional."
        : "Manufacturer is on. Orders ship through waves, with pick and pack scanned on the floor.",
    );

  async function save(values: ZodFormOutput<typeof buildingFormSchema>) {
    if (!currentId) return;
    const service = values.defaultCarrierService;
    // The server re-checks a sent default against the carrier accounts, so send it only when it changed.
    const defaultPatch =
      service === savedService
        ? {}
        : {
            defaultCarrierService: service || null,
            defaultCarrierConnectionId: services.find((row) => row.id === service)?.connectionId ?? null,
          };
    const saved = await write.run(
      "Save warehouse",
      () =>
        api<WarehouseMapInfo>(`/api/warehouses/${currentId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: values.name,
            mapWidth: values.mapWidth,
            mapDepth: values.mapDepth,
            mapHeight: values.mapHeight,
            mapNorth: values.mapNorth,
            shipFromAddress: values.shipFromAddress,
            returnAddress: values.returnAddress,
            city: values.city,
            region: values.region,
            country: values.country,
            timeZone: values.timeZone,
            rateStrategy: values.rateStrategy,
            deliveryDays: values.deliveryDays.trim() ? Number(values.deliveryDays) : null,
            ...defaultPatch,
          }),
        }),
      "Warehouse saved.",
    );
    if (saved) setSavedService(service);
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
                builds. {MODE_SWITCH_RULES}
              </>
            }
          />
          <div className="grid gap-3 md:grid-cols-2">
            <ModeOption
              icon={Wrench}
              title={GARAGE_MODE_LABEL}
              body={
                <>
                  The bench founders and inventors start on. Orders ship in one click from the Ship queue, scans are
                  optional, and the office can pick and pack. Yard, waves, <Term id="asn">ASN</Term>, equipment, and{" "}
                  <Term id="3pl-client">3PL</Term> stay packed away.
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
              body="Orders ship through waves and the floor. One-click ship is off, and pick and pack need scans on the floor. Yard, ASN, equipment, and 3PL open too."
              current={!garage}
              switchLabel={`Switch to ${MANUFACTURER_MODE_LABEL}`}
              disabled={operating.busy || write.busy || !operating.owner}
              onSwitch={() => void setOperatingMode("warehouse")}
            />
          </div>
        </div>
      </Card>

      <TrackingPageCard disabled={!operating.owner} />
      <CustomerNotificationsCard disabled={!operating.owner} />

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
              description="Live starts this building's day at local midnight."
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
            <TextareaField
              form={form}
              name="returnAddress"
              label="Return address"
              rows={2}
              placeholder="Blank sends returns to the ship-from address"
              description="Where customer return labels are addressed."
            />
            <div className="grid grid-cols-3 items-start gap-3">
              <TextField form={form} name="city" label="City" placeholder="Portland" />
              <TextField form={form} name="region" label="State" placeholder="OR" />
              <TextField form={form} name="country" label="Country" placeholder="US" />
            </div>
          </div>

          <div className="space-y-3 border-t pt-4">
            <SectionHeading
              title="Default service and rate choice"
              description={
                garage
                  ? "The ship queue, quick-ship, and an order's Ship step start on this service when the order doesn't name one."
                  : "The Ship screen starts on this service when an order doesn't name one, and Waves use its carrier's cutoff."
              }
            />
            <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
              <SelectField
                form={form}
                name="defaultCarrierService"
                label="Carrier and service"
                placeholder="No default"
                options={services.map((row) => ({ value: row.id, label: `${row.company} ${row.service}` }))}
                description={
                  <>
                    Only services turned on in <Link to="/setup/carriers" className="underline">Setup → Carriers</Link> are
                    listed.
                  </>
                }
              />
              <SelectField
                form={form}
                name="rateStrategy"
                label="Rate choice"
                options={RATE_STRATEGIES.map((strategy) => ({ value: strategy, label: RATE_STRATEGY_LABELS[strategy] }))}
                description={
                  <>
                    {garage ? "Quick-ship" : "One-click ship in Garage mode"} uses this when no{" "}
                    <Link to="/setup/shipping-rules" className="underline">
                      shipping rule
                    </Link>{" "}
                    or order names a service. Cheapest, fastest, and on time compare quotes from every connected account.
                  </>
                }
              />
              <TextField
                form={form}
                name="deliveryDays"
                label="Delivery promise (working days)"
                placeholder="5"
                description="Order day to doorstep. Cheapest on time picks the cheapest quote that arrives by then."
              />
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

          <div className="space-y-3 border-t pt-4">
            <SectionHeading
              title="Compass"
              description="Which way north points on the map, so the floor plan, the 3D racks, and Build floor can label the north, south, east, and west walls."
            />
            <div className="flex flex-wrap items-start gap-4">
              <div className="text-foreground">
                <CompassRose mapNorth={normalizeHeading(form.watch("mapNorth"))} size={72} />
              </div>
              <div className="min-w-[14rem] flex-1 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {NORTH_PRESETS.map((preset) => (
                    <Button
                      key={preset.deg}
                      type="button"
                      size="sm"
                      variant={normalizeHeading(form.watch("mapNorth")) === preset.deg ? "primary" : "secondary"}
                      onClick={() => form.setValue("mapNorth", String(preset.deg), { shouldDirty: true, shouldValidate: true })}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-2 items-start gap-3">
                  <NumberField
                    form={form}
                    name="mapNorth"
                    label="North, degrees clockwise from the top edge"
                    min={0}
                    description={describeNorth(normalizeHeading(form.watch("mapNorth")))}
                  />
                </div>
              </div>
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
