import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useWatch } from "react-hook-form";
import { ArrowRightLeft, Hammer, Map as MapIcon, MapPin, Plus, Printer, Tags, Trash2 } from "lucide-react";
import { api, errorText, type InventoryRow, type Location, type Me } from "../api";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Table, ToneBadge } from "../components/ui";
import { NumberField, SelectField, TextField, useZodForm, type ZodFormInput, type ZodFormOutput } from "../components/form-kit";
import { SampleDataButton } from "../components/onboarding";
import { Term } from "../components/term";
import {
  DetailSkeleton,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type BulkAction, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, Muted, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { refreshApi, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { toast } from "sonner";
import { useWarehouse, inWarehouse } from "../warehouse";
import { usePrint } from "../print/PrintProvider";
import { openTour } from "../tour";
import { FORM_LOCATION_TYPES, locationFormSchema, wholeNumber } from "@/domain/form-schemas";

const types = ["receiving", "storage", "production", "shipping"];

type LocationContents = {
  itemId: string;
  sku: string;
  itemName: string;
  itemType?: string;
  imageUrl?: string | null;
  qty: number;
}[];

type LocationDetailRow = Location & { contents?: LocationContents };

type LocationRow = Location & { units: number; skus: number };

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function slotRoleOf(location: Pick<Location, "slotRole">): string | null {
  return location.slotRole && location.slotRole !== "none" ? location.slotRole : null;
}

function position(location: Location): string {
  const slot = location.aisle ? ` · ${location.aisle}-${location.rack}-${location.bay}` : "";
  return `${location.area}${slot} L${location.level}`;
}

export function LocationsPage({ me }: { me: Me }) {
  const { id } = useParams();
  if (id) return <LocationDetail me={me} id={id} />;
  return <LocationList me={me} />;
}

const LOCATION_TABS: TabDef<LocationRow>[] = [
  { id: "all", label: "All", match: () => true },
  ...types.map((type) => ({ id: type, label: capitalize(type), match: (row: LocationRow) => row.type === type })),
  { id: "empty", label: "Empty", match: (row) => row.units <= 0 },
];

const LOCATION_FACETS: FacetDef<LocationRow>[] = [
  {
    id: "role",
    label: "Slot role",
    value: (row) => slotRoleOf(row) ?? "none",
    format: (value) => (value === "none" ? "None" : capitalize(value)),
  },
  { id: "area", label: "Area", value: (row) => row.area || null },
];

const LOCATION_COLUMNS: DataColumn<LocationRow>[] = [
  {
    id: "code",
    header: "Location",
    sortValue: (row) => row.code,
    csv: (row) => row.code,
    cell: (row) => (
      <span className="flex flex-col">
        <DocLink to={`/stock/locations/${row.id}`}>{row.code}</DocLink>
        {row.name && row.name !== row.code ? <span className="text-xs text-muted-foreground">{row.name}</span> : null}
      </span>
    ),
  },
  {
    id: "name",
    header: "Name",
    defaultHidden: true,
    sortValue: (row) => row.name,
    cell: (row) => row.name,
  },
  {
    id: "type",
    header: "Type",
    sortValue: (row) => row.type,
    cell: (row) => capitalize(row.type),
  },
  {
    id: "position",
    header: "Bay",
    sortValue: (row) => position(row),
    cell: (row) => <span className="text-muted-foreground">{position(row)}</span>,
  },
  {
    id: "role",
    header: "Role",
    sortValue: (row) => slotRoleOf(row),
    csv: (row) => slotRoleOf(row) ?? "",
    cell: (row) => {
      const role = slotRoleOf(row);
      return role ? <ToneBadge tone={role === "pick" ? "info" : "neutral"}>{role}</ToneBadge> : <Muted>—</Muted>;
    },
  },
  {
    id: "units",
    header: "Units",
    align: "right",
    sortValue: (row) => row.units,
    cell: (row) => (row.units > 0 ? <span className="font-mono">{row.units}</span> : <Muted>Empty</Muted>),
  },
  {
    id: "skus",
    header: "SKUs",
    align: "right",
    defaultHidden: true,
    sortValue: (row) => row.skus,
    cell: (row) => <span className="font-mono">{row.skus}</span>,
  },
  {
    id: "map",
    header: "Map",
    defaultHidden: true,
    csv: (row) => `${row.posX},${row.posY},${row.posZ}`,
    cell: (row) => (
      <span className="font-mono text-xs">
        {row.posX},{row.posY},{row.posZ}
      </span>
    ),
  },
  {
    id: "barcode",
    header: "Barcode",
    defaultHidden: true,
    sortValue: (row) => row.barcode,
    cell: (row) =>
      row.barcode !== row.code ? <span className="font-mono text-xs">{row.barcode}</span> : <Muted>Same as code</Muted>,
  },
];

function deleteConfirmBody(rows: { code: string; units: number }[]) {
  const stocked = rows.filter((row) => row.units > 0).map((row) => row.code);
  if (stocked.length) {
    return `${stocked.join(", ")} still ${stocked.length === 1 ? "holds" : "hold"} stock. Those on-hand rows are removed with the location and do not move anywhere. This cannot be undone.`;
  }
  return "The location leaves the map and its barcode stops scanning. This cannot be undone.";
}

function LocationList({ me }: { me: Me }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const locations = useApiQuery<Location[]>("/api/locations");
  const inventory = useApiQuery<InventoryRow[]>("/api/inventory");
  const [creating, setCreating] = useState(false);
  const [labels, setLabels] = useState(params.get("labels") === "1");
  const [labelError, setLabelError] = useState<string | null>(null);
  const printer = usePrint();

  const scoped = useMemo(
    () => (locations.data ?? []).filter((location) => !warehouseId || location.warehouseId === warehouseId),
    [locations.data, warehouseId],
  );

  const rows = useMemo<LocationRow[]>(() => {
    const stock = new Map<string, { units: number; skus: number }>();
    for (const row of inWarehouse(inventory.data ?? [], warehouseId)) {
      if (row.qty <= 0) continue;
      const current = stock.get(row.locationId) ?? { units: 0, skus: 0 };
      stock.set(row.locationId, { units: current.units + row.qty, skus: current.skus + 1 });
    }
    return scoped.map((location) => ({ ...location, ...(stock.get(location.id) ?? { units: 0, skus: 0 }) }));
  }, [scoped, inventory.data, warehouseId]);

  const bulkActions: BulkAction<LocationRow>[] =
    me.role === "owner"
      ? [
          {
            label: "Delete",
            icon: Trash2,
            tone: "danger",
            confirm: (selected) => ({
              title: `Delete ${selected.length === 1 ? selected[0]!.code : `${selected.length} locations`}?`,
              body: deleteConfirmBody(selected),
              confirmLabel: selected.length === 1 ? "Delete location" : "Delete locations",
              cancelLabel: "Keep",
              tone: "danger",
            }),
            run: async (selected) => {
              const results = await Promise.allSettled(
                selected.map((location) => api(`/api/locations/${location.id}`, { method: "DELETE" })),
              );
              void refreshApi();
              const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
              if (failed.length) {
                // The count leads; the server's own sentence (and its fix) goes underneath, unwrapped.
                toast.error(`${failed.length} could not be deleted.`, {
                  description: errorText(failed[0]!.reason, "Something went wrong. Try again."),
                });
              }
              const deleted = selected.length - failed.length;
              if (deleted) toast.success(`Deleted ${deleted} ${deleted === 1 ? "location" : "locations"}.`);
            },
          },
        ]
      : [];

  if (labels) {
    return (
      <div>
        <PageHeader
          eyebrow="Bin labels"
          title="Print location barcodes"
          description="Tape these on the physical bay. Scanning the label is enough to move stock."
          actions={
            <div className="flex gap-2 print:hidden">
              <Button
                variant="ghost"
                onClick={() => {
                  setLabels(false);
                  navigate("/stock/locations");
                }}
              >
                Back
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void printer
                    .print({
                      kind: "sheet",
                      title: "bay-labels",
                      forceConnection: "download",
                      data: {
                        labelsJson: JSON.stringify(
                          scoped.map((location) => ({
                            kind: "bay",
                            code: location.code,
                            name: location.name,
                            barcode: location.barcode,
                          })),
                        ),
                      },
                    })
                    .then((result) => {
                      if (!result.ok) setLabelError(result.message);
                    });
                }}
              >
                Download ZPL
              </Button>
              <Button onClick={() => window.print()}>Print</Button>
            </div>
          }
        />
        <ErrorBanner error={labelError ?? locations.error?.message ?? null} />
        {locations.isLoading ? <p className="text-sm text-muted-foreground">Loading labels…</p> : null}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-3">
          {scoped.map((location) => (
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
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Stock"
        title="Locations"
        description="Each code is a physical bay on the map. Print barcodes, then scan to move slots."
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to="/map">
                <MapIcon className="size-4" />
                Open map
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/map?edit=1">
                <Hammer className="size-4" />
                Build floor
              </Link>
            </Button>
          </>
        }
      />
      <DataTable
        id="locations"
        data={rows}
        loading={locations.isLoading || inventory.isLoading}
        error={locations.error?.message ?? inventory.error?.message}
        columns={LOCATION_COLUMNS}
        getRowId={(row) => row.id}
        rowHref={(row) => `/stock/locations/${row.id}`}
        tabs={LOCATION_TABS}
        defaultTab="all"
        facets={LOCATION_FACETS}
        defaultSort={{ id: "code", desc: false }}
        search={{
          placeholder: "Search code, name, aisle",
          text: (row) => [row.code, row.name, row.barcode, row.area, row.aisle, position(row)].filter(Boolean).join(" "),
        }}
        bulkActions={bulkActions}
        exportName="locations"
        toolbar={
          <>
            <Button size="sm" variant="outline" onClick={() => setLabels(true)}>
              <Tags className="size-4" />
              Print labels
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New location
            </Button>
          </>
        }
        empty={
          <EmptyState
            icon={MapPin}
            title="No locations yet."
            body={
              <>
                Add the docks and bays stock sits in, or draw them on the map with Build floor. A storage code reads aisle,
                rack, bay, level.{" "}
                <button
                  type="button"
                  onClick={() => openTour("hierarchy")}
                  className="rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  How addresses work
                </button>
              </>
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {me.role === "owner" ? (
                  <Button size="sm" asChild>
                    <Link to="/welcome">Set up your building</Link>
                  </Button>
                ) : null}
                <Button size="sm" variant={me.role === "owner" ? "outline" : "primary"} onClick={() => setCreating(true)}>
                  New location
                </Button>
                <SampleDataButton />
                <Button size="sm" variant="outline" asChild>
                  <Link to="/map?edit=1">Build floor</Link>
                </Button>
              </div>
            }
          />
        }
      />
      <NewLocationSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

const LOCATION_TYPE_OPTIONS = FORM_LOCATION_TYPES.map((value) => ({ value, label: capitalize(value) }));
const SLOT_ROLE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "pick", label: "Pick face" },
  { value: "bulk", label: "Bulk" },
];

/**
 * POST /api/locations. Blank level keeps sending 0 as the sheet always did (`Number("")`); the
 * server lifts anything below 1 to 1, so the bay lands on level 1 either way.
 */
const newLocationSchema = locationFormSchema.extend({
  level: wholeNumber(1, {
    blankAs: 0,
    notWhole: "Level must be a whole number.",
    tooSmall: "Level must be 1 or more.",
  }),
});

type NewLocationInput = ZodFormInput<typeof newLocationSchema>;
type NewLocationValues = ZodFormOutput<typeof newLocationSchema>;

const NEW_LOCATION_DEFAULTS: NewLocationInput = {
  code: "",
  name: "",
  type: "storage",
  slotRole: "none",
  aisle: "A",
  rack: "01",
  bay: "01",
  level: "1",
};

function NewLocationSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { warehouseId } = useWarehouse();
  const { error, setError, busy, run } = useWrite();
  const form = useZodForm(newLocationSchema, NEW_LOCATION_DEFAULTS);
  const type = useWatch({ control: form.control, name: "type" });

  // Keep what was typed between opens, but start each open without stale inline errors.
  const { reset, getValues } = form;
  useEffect(() => {
    if (!open) return;
    setError(null);
    reset(getValues(), { keepDefaultValues: true });
  }, [open, setError, reset, getValues]);

  async function create(values: NewLocationValues) {
    const storage = values.type === "storage";
    const created = await run(
      "Create location",
      async () => {
        if (!warehouseId) throw new Error("Create a warehouse first.");
        return api<Location>("/api/locations", {
          method: "POST",
          body: JSON.stringify({
            warehouseId,
            code: values.code,
            name: values.name,
            type: values.type,
            barcode: values.code,
            slotRole: storage ? values.slotRole : "none",
            aisle: storage ? values.aisle : undefined,
            rack: storage ? values.rack : undefined,
            bay: storage ? values.bay : undefined,
            level: values.level,
          }),
        });
      },
      (row) => `Location ${row?.code ?? values.code} added.`,
    );
    if (!created) return;
    // Clear the code and name for the next bay; keep type, slot, and position to speed up a run of bays.
    reset({ ...getValues(), code: "", name: "" }, { keepDefaultValues: true });
    onOpenChange(false);
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New location"
      description="A dock, bay, or work cell. The code prints as its barcode."
      submitLabel="Add location"
      onSubmit={form.handleSubmit(create)}
      busy={busy}
      error={error}
    >
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <TextField form={form} name="code" label="Code" placeholder="A-01-04" autoFocus />
        <SelectField form={form} name="type" label="Type" options={LOCATION_TYPE_OPTIONS} />
      </div>
      <TextField form={form} name="name" label="Name" />
      {type === "storage" ? (
        <>
          <SelectField
            form={form}
            name="slotRole"
            label="Slot role"
            options={SLOT_ROLE_OPTIONS}
            description={
              <>
                Pickers take stock from a <Term id="pick-face">pick face</Term>. A <Term id="bulk-bay">bulk bay</Term> holds the
                extra that tops it up.
              </>
            }
          />
          <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-4">
            <TextField form={form} name="aisle" label="Aisle" placeholder="A" />
            <TextField form={form} name="rack" label="Rack" placeholder="01" />
            <TextField form={form} name="bay" label="Bay" placeholder="01" />
            <NumberField form={form} name="level" label="Level" min={1} />
          </div>
        </>
      ) : (
        <NumberField form={form} name="level" label="Level" min={1} />
      )}
    </FormSheet>
  );
}

function LocationDetail({ me, id }: { me: Me; id: string }) {
  const navigate = useNavigate();
  const detail = useApiQuery<LocationDetailRow>(`/api/locations/${id}`);
  const { error, run } = useWrite();
  const location = detail.data;

  if (!location) {
    return detail.error ? <ErrorBanner error={detail.error.message} /> : <DetailSkeleton />;
  }

  const contents = location.contents ?? [];
  const units = contents.reduce((sum, row) => sum + row.qty, 0);
  const role = slotRoleOf(location);

  async function remove() {
    const done = await run(
      "Delete location",
      () => api(`/api/locations/${id}`, { method: "DELETE" }),
      `Deleted ${location?.code ?? "location"}.`,
    );
    if (done) navigate("/stock/locations");
  }

  const menu: DocumentAction[] = [
    { label: "Open on map", icon: MapIcon, to: `/map?location=${location.id}` },
    { label: "Print label", icon: Printer, onSelect: () => window.print() },
    ...(me.role === "owner"
      ? [
          {
            label: "Delete location",
            icon: Trash2,
            tone: "danger" as const,
            onSelect: remove,
            confirm: {
              title: `Delete ${location.code}?`,
              body: deleteConfirmBody([{ code: location.code, units }]),
              confirmLabel: "Delete location",
              cancelLabel: "Keep location",
              tone: "danger" as const,
            },
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Stock"
        list={{ label: "Locations", to: "/stock/locations" }}
        title={location.code}
        description={location.name}
        status={capitalize(location.type)}
        steps={[]}
        meta={
          role ? <ToneBadge tone={role === "pick" ? "info" : "neutral"}>{role === "pick" ? "Pick face" : role}</ToneBadge> : null
        }
        primary={{ label: "Move stock", icon: ArrowRightLeft, to: `/floor/putaway?from=${encodeURIComponent(location.barcode)}` }}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Bay</p>
                <DocumentFact label="Type">{capitalize(location.type)}</DocumentFact>
                <DocumentFact label="Slot role">{role ? capitalize(role) : <Muted>None</Muted>}</DocumentFact>
                <DocumentFact label="Area">{location.area || <Muted>—</Muted>}</DocumentFact>
                {location.aisle ? (
                  <DocumentFact label="Aisle · rack · bay">
                    <span className="font-mono">
                      {location.aisle}-{location.rack}-{location.bay}
                    </span>
                  </DocumentFact>
                ) : null}
                <DocumentFact label="Level">
                  <span className="font-mono">{location.level}</span>
                </DocumentFact>
                <DocumentFact label="Map position">
                  <span className="font-mono">
                    {location.posX},{location.posY},{location.posZ}
                  </span>
                </DocumentFact>
                {me.role === "owner" ? (
                  <p className="text-xs text-muted-foreground">
                    Drag this bay on the{" "}
                    <Link className="underline underline-offset-2 hover:text-foreground" to={`/map?location=${location.id}`}>
                      map
                    </Link>{" "}
                    to match the real floor.
                  </p>
                ) : null}
              </div>
            </Card>
            <Card>
              <div className="space-y-2">
                <p className="text-sm font-medium">Barcode</p>
                <BarcodeLabel value={location.barcode} className="mx-auto h-16" />
              </div>
            </Card>
          </DocumentRail>
        }
      >
        <div className="space-y-2">
          <p className="text-sm font-medium">
            In this bay{" "}
            <span className="font-normal text-muted-foreground">
              · {units} {units === 1 ? "unit" : "units"} · {contents.length} {contents.length === 1 ? "SKU" : "SKUs"}
            </span>
          </p>
          {contents.length ? (
            <Table columns={["Item", "Type", "Qty"]}>
              {contents.map((row) => (
                <tr key={row.itemId}>
                  <td>
                    <SkuCell sku={row.sku} name={row.itemName} imageUrl={row.imageUrl} to={`/stock/items/${row.itemId}`} />
                  </td>
                  <td>{row.itemType ? capitalize(row.itemType) : <Muted>—</Muted>}</td>
                  <td className="font-mono tabular-nums">{row.qty}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState
              icon={MapPin}
              title="Nothing in this bay."
              body="Stock shows here once something is received, put away, or moved in."
            />
          )}
        </div>
      </DocumentFrame>
    </div>
  );
}
