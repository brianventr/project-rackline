import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Grid3x3, Plus } from "lucide-react";
import { api, type Location, type Zone } from "../../api";
import { Button, EmptyState, ErrorBanner, Field, Input, PageHeader, Select } from "../../components/ui";
import { DataTable, type DataColumn, type FacetDef } from "../../components/data-table/DataTable";
import { RelativeTime } from "../../components/cells";
import { FormSheet } from "../../components/form-sheet";
import { apiMutate, useApiQuery } from "../../query";
import { useWrite } from "../../use-write";
import { useWarehouse, inWarehouse } from "../../warehouse";

type ZoneRow = Zone & { bays: number };
type BayRow = Location & { zoneCode: string | null };

const ZONE_COLUMNS: DataColumn<ZoneRow>[] = [
  {
    id: "code",
    header: "Code",
    sortValue: (zone) => zone.code,
    cell: (zone) => <span className="font-mono font-medium">{zone.code}</span>,
  },
  { id: "name", header: "Name", sortValue: (zone) => zone.name, cell: (zone) => zone.name },
  {
    id: "bays",
    header: "Bays",
    align: "right",
    sortValue: (zone) => zone.bays,
    cell: (zone) => <span className="font-mono">{zone.bays}</span>,
  },
  {
    id: "created",
    header: "Added",
    sortValue: (zone) => zone.createdAt,
    csv: (zone) => new Date(zone.createdAt).toISOString(),
    cell: (zone) => <RelativeTime at={zone.createdAt} />,
  },
];

const BAY_FACETS: FacetDef<BayRow>[] = [
  {
    id: "zone",
    label: "Zone",
    value: (bay) => bay.zoneCode ?? "none",
    format: (value) => (value === "none" ? "No zone" : value),
  },
  { id: "type", label: "Type", value: (bay) => bay.type || null },
];

export function ZonesPage() {
  const { warehouseId } = useWarehouse();
  const zonesQuery = useApiQuery<Zone[]>(`/api/zones${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ""}`);
  const locationsQuery = useApiQuery<Location[]>("/api/locations");
  const [creating, setCreating] = useState(false);
  const assign = useWrite();

  const zones = zonesQuery.data ?? [];
  const bays = useMemo<BayRow[]>(() => {
    const codes = new Map((zonesQuery.data ?? []).map((zone) => [zone.id, zone.code]));
    return inWarehouse(locationsQuery.data ?? [], warehouseId).map((location) => ({
      ...location,
      zoneCode: location.zoneId ? (codes.get(location.zoneId) ?? null) : null,
    }));
  }, [locationsQuery.data, zonesQuery.data, warehouseId]);
  const zoneRows = useMemo<ZoneRow[]>(
    () => (zonesQuery.data ?? []).map((zone) => ({ ...zone, bays: bays.filter((bay) => bay.zoneId === zone.id).length })),
    [zonesQuery.data, bays],
  );

  const bayColumns = useMemo<DataColumn<BayRow>[]>(
    () => [
      {
        id: "bay",
        header: "Bay",
        sortValue: (bay) => bay.code,
        cell: (bay) => (
          <span className="flex flex-col">
            <span className="font-mono font-medium">{bay.code}</span>
            {bay.name && bay.name !== bay.code ? <span className="text-xs text-muted-foreground">{bay.name}</span> : null}
          </span>
        ),
      },
      {
        id: "type",
        header: "Type",
        sortValue: (bay) => bay.type,
        cell: (bay) => <span className="capitalize text-muted-foreground">{bay.type}</span>,
      },
      {
        id: "zone",
        header: "Zone",
        sortValue: (bay) => bay.zoneCode,
        csv: (bay) => bay.zoneCode ?? "",
        cell: (bay) => (
          <ZoneCell
            bay={bay}
            zones={zones}
            onAssign={async (zoneId) => {
              const zone = zones.find((row) => row.id === zoneId);
              const done = await assign.run(
                "Assign zone",
                async () => {
                  await api(`/api/locations/${bay.id}/zone`, {
                    method: "POST",
                    body: JSON.stringify({ zoneId: zoneId || null }),
                  });
                  return true;
                },
                zone ? `${bay.code} is in zone ${zone.code}.` : `Cleared the zone on ${bay.code}.`,
              );
              return !!done;
            }}
          />
        ),
      },
    ],
    [zones, assign.run],
  );

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Zones"
        description="Pick / put zones for this warehouse. Assign bays so waves can stay in-zone."
      />

      <section className="space-y-2">
        <SectionHeading
          title="Zones"
          description="One row per zone in this warehouse. Bays counts the bays assigned below."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New zone
            </Button>
          }
        />
        <DataTable
          id="zones"
          paramPrefix="z_"
          data={zoneRows}
          loading={zonesQuery.isLoading}
          error={zonesQuery.error?.message}
          columns={ZONE_COLUMNS}
          getRowId={(zone) => zone.id}
          defaultSort={{ id: "code", desc: false }}
          empty={
            <EmptyState
              icon={Grid3x3}
              title="No zones yet."
              body="Group bays into zones such as an aisle or a mezzanine so waves pick in one area."
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  New zone
                </Button>
              }
            />
          }
        />
      </section>

      <section className="space-y-2">
        <SectionHeading
          title="Bays"
          description={
            zones.length
              ? "Pick a zone for each bay. The change saves right away."
              : "Add a zone first, then assign bays to it here."
          }
        />
        <ErrorBanner error={assign.error} />
        <DataTable
          id="zone-bays"
          paramPrefix="b_"
          data={bays}
          loading={locationsQuery.isLoading}
          error={locationsQuery.error?.message}
          columns={bayColumns}
          getRowId={(bay) => bay.id}
          facets={BAY_FACETS}
          defaultSort={{ id: "bay", desc: false }}
          search={{ placeholder: "Search bay", text: (bay) => `${bay.code} ${bay.name} ${bay.zoneCode ?? ""}` }}
          empty={<EmptyState icon={Grid3x3} title="No bays in this warehouse." body="Bays live under Stock → Locations." />}
        />
      </section>

      <NewZoneSheet open={creating} onOpenChange={setCreating} warehouseId={warehouseId} />
    </div>
  );
}

/** Holds the picked zone while the save runs so the select does not snap back. */
function ZoneCell({ bay, zones, onAssign }: { bay: BayRow; zones: Zone[]; onAssign: (zoneId: string) => Promise<boolean> }) {
  const [value, setValue] = useState(bay.zoneId ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(bay.zoneId ?? "");
  }, [bay.zoneId]);

  return (
    <Select
      aria-label={`Zone for ${bay.code}`}
      className="w-44"
      value={value}
      disabled={saving}
      onChange={async (e) => {
        const next = e.target.value;
        setValue(next);
        setSaving(true);
        const ok = await onAssign(next);
        setSaving(false);
        if (!ok) setValue(bay.zoneId ?? "");
      }}
    >
      <option value="">No zone</option>
      {zones.map((zone) => (
        <option key={zone.id} value={zone.id}>
          {zone.code} — {zone.name}
        </option>
      ))}
    </Select>
  );
}

function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

function NewZoneSheet({
  open,
  onOpenChange,
  warehouseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const write = useWrite();

  useEffect(() => {
    if (open) write.setError(null);
  }, [open]);

  async function submit() {
    const created = await write.run(
      "Add zone",
      () => apiMutate<Zone>("/api/zones", { body: JSON.stringify({ warehouseId, code, name }) }),
      (zone) => `Zone ${zone?.code ?? code} added.`,
    );
    if (!created) return;
    setCode("");
    setName("");
    onOpenChange(false);
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New zone"
      description="Zones belong to the warehouse picked in the top bar."
      submitLabel="Add zone"
      onSubmit={submit}
      busy={write.busy}
      error={write.error}
    >
      <Field label="Code">
        <Input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="A" autoFocus />
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Aisle A" />
      </Field>
    </FormSheet>
  );
}
