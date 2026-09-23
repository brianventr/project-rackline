import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, History, MonitorSmartphone, Plus, Printer, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Item, type Location, type Order, type WarehouseMapInfo, type Wave } from "../../api";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  ToneBadge,
} from "../../components/ui";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../../components/data-table/DataTable";
import { DocLink, Muted, RelativeTime } from "../../components/cells";
import { ActionButton } from "../../components/document";
import { FormSheet } from "../../components/form-sheet";
import { refreshApi, useApiQuery } from "../../query";
import { useWrite } from "../../use-write";
import {
  packSlipJobs,
  pickListJobs,
  printJobButtonLabel,
  shippingLabelJobs,
  wavePickListJobs,
  type PrintJob,
} from "@/domain/print-station";
import { SCAN_PREFIX_CHEATSHEET } from "@/domain/barcodes";
import { usePrint, type PrinterRecord, type PrintStationRecord } from "../../print/PrintProvider";
import { useScanner } from "../../scanner/ScannerProvider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PrintJobRow = {
  id: string;
  kind: string;
  payloadFormat: string;
  status: string;
  error: string | null;
  createdAt: number;
};

const CONNECTION_LABEL: Record<PrinterRecord["connection"], string> = {
  browser: "Browser",
  download: "ZPL download",
  qz: "QZ Tray",
};

const MEDIA_LABEL: Record<PrinterRecord["media"], string> = {
  letter: "Letter",
  "4x6": "4×6",
  "2x1": "2×1",
};

const QUEUE_TABS: TabDef<PrintJob>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "pick", label: "Pick lists", match: (job) => job.kind === "pick-list" },
  { id: "slip", label: "Pack slips", match: (job) => job.kind === "pack-slip" },
  { id: "label", label: "Shipping labels", match: (job) => job.kind === "shipping-label" },
];

const QUEUE_COLUMNS: DataColumn<PrintJob>[] = [
  {
    id: "document",
    header: "Document",
    sortValue: (job) => job.title,
    cell: (job) => <DocLink to={job.href}>{job.title}</DocLink>,
  },
  {
    id: "kind",
    header: "Print",
    sortValue: (job) => printJobButtonLabel(job.kind),
    cell: (job) => printJobButtonLabel(job.kind),
  },
  {
    id: "detail",
    header: "Detail",
    sortValue: (job) => job.subtitle,
    cell: (job) => <span className="text-muted-foreground">{job.subtitle}</span>,
  },
  {
    id: "media",
    header: "Media",
    sortValue: (job) => job.mediaHint ?? null,
    cell: (job) => (job.mediaHint ? MEDIA_LABEL[job.mediaHint] : <Muted>—</Muted>),
  },
];

const JOB_FACETS: FacetDef<PrintJobRow>[] = [
  { id: "kind", label: "Kind", value: (job) => job.kind },
  { id: "status", label: "Status", value: (job) => job.status },
];

const JOB_COLUMNS: DataColumn<PrintJobRow>[] = [
  {
    id: "when",
    header: "When",
    sortValue: (job) => job.createdAt,
    csv: (job) => new Date(job.createdAt).toISOString(),
    cell: (job) => <RelativeTime at={job.createdAt} />,
  },
  {
    id: "kind",
    header: "Kind",
    sortValue: (job) => job.kind,
    cell: (job) => <span className="font-mono text-xs">{job.kind}</span>,
  },
  {
    id: "format",
    header: "Format",
    sortValue: (job) => job.payloadFormat,
    cell: (job) => <span className="font-mono text-xs uppercase">{job.payloadFormat}</span>,
  },
  { id: "status", header: "Status", sortValue: (job) => job.status, cell: (job) => <StatusBadge status={job.status} /> },
  {
    id: "error",
    header: "Error",
    sortValue: (job) => job.error,
    cell: (job) => (job.error ? <span className="text-destructive">{job.error}</span> : <Muted>—</Muted>),
  },
];

export function LabelsSetupPage() {
  const printerCtx = usePrint();
  const scanner = useScanner();
  const orders = useApiQuery<Order[]>("/api/orders");
  const waves = useApiQuery<Wave[]>("/api/waves");
  const items = useApiQuery<Item[]>("/api/items");
  const locations = useApiQuery<Location[]>("/api/locations");
  const warehouses = useApiQuery<WarehouseMapInfo[]>("/api/warehouses");
  const jobs = useApiQuery<PrintJobRow[]>("/api/print-jobs?limit=20");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingPrinter, setAddingPrinter] = useState(false);
  const [addingStation, setAddingStation] = useState(false);
  const [view, setView] = useState("printers");
  const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

  useEffect(() => {
    printerCtx
      .refresh()
      .catch((err: Error) => setError(err.message))
      .finally(() => setReady(true));
  }, []);

  const queue = useMemo(
    () => [
      ...pickListJobs(orders.data ?? []),
      ...wavePickListJobs(waves.data ?? []),
      ...packSlipJobs(orders.data ?? []),
      ...shippingLabelJobs(orders.data ?? []),
    ],
    [orders.data, waves.data],
  );

  const printerColumns = useMemo<DataColumn<PrinterRecord>[]>(
    () => [
      {
        id: "name",
        header: "Printer",
        sortValue: (row) => row.name,
        cell: (row) => (
          <span className="flex items-center gap-2">
            <span className="font-medium">{row.name}</span>
            {row.isDefault ? <StatusBadge status="default" /> : null}
          </span>
        ),
      },
      {
        id: "connection",
        header: "Connection",
        sortValue: (row) => CONNECTION_LABEL[row.connection],
        cell: (row) => (
          <span className="flex flex-col">
            <span>{CONNECTION_LABEL[row.connection]}</span>
            {row.qzPrinterName ? <span className="font-mono text-xs text-muted-foreground">{row.qzPrinterName}</span> : null}
          </span>
        ),
      },
      { id: "media", header: "Media", sortValue: (row) => row.media, cell: (row) => MEDIA_LABEL[row.media] ?? row.media },
      {
        id: "dpi",
        header: "DPI",
        align: "right",
        defaultHidden: true,
        sortValue: (row) => row.dpi,
        cell: (row) => <span className="font-mono">{row.dpi}</span>,
      },
      {
        id: "actions",
        header: "",
        hideable: false,
        align: "right",
        className: "w-px",
        cell: (row) => (
          <ActionButton
            variant="ghost"
            className="text-destructive hover:text-destructive"
            action={{
              label: "Remove",
              icon: Trash2,
              onSelect: async () => {
                await api(`/api/printers/${row.id}`, { method: "DELETE" });
                await printerCtx.refresh();
                void refreshApi();
              },
              success: `Removed ${row.name}.`,
              confirm: {
                title: `Remove ${row.name}?`,
                body: "Stations that print to it lose that printer slot and fall back to their default or the browser. Print history stays.",
                confirmLabel: "Remove printer",
                cancelLabel: "Keep printer",
                tone: "danger",
              },
            }}
          />
        ),
      },
    ],
    [printerCtx.refresh],
  );

  const stationColumns = useMemo<DataColumn<PrintStationRecord>[]>(() => {
    const printerName = (id: string | null) => printerCtx.printers.find((row) => row.id === id)?.name ?? null;
    const warehouseName = (id: string | null) =>
      id ? ((warehouses.data ?? []).find((row) => row.id === id)?.name ?? "Unknown warehouse") : "Any warehouse";
    const printerCell = (id: string | null) => {
      const name = printerName(id);
      return name ? name : <Muted>None</Muted>;
    };
    return [
      {
        id: "name",
        header: "Station",
        sortValue: (row) => row.name,
        cell: (row) => (
          <span className="flex items-center gap-2">
            <span className="font-medium">{row.name}</span>
            {row.id === printerCtx.station?.id ? (
              <ToneBadge tone="success" dot={false}>
                This workstation
              </ToneBadge>
            ) : null}
          </span>
        ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        sortValue: (row) => warehouseName(row.warehouseId),
        cell: (row) => warehouseName(row.warehouseId),
      },
      {
        id: "default",
        header: "Default",
        sortValue: (row) => printerName(row.defaultPrinterId),
        cell: (row) => printerCell(row.defaultPrinterId),
      },
      {
        id: "bay",
        header: "Bay / SKU",
        sortValue: (row) => printerName(row.bayPrinterId),
        cell: (row) => printerCell(row.bayPrinterId),
      },
      {
        id: "shipping",
        header: "Shipping",
        sortValue: (row) => printerName(row.shippingPrinterId),
        cell: (row) => printerCell(row.shippingPrinterId),
      },
    ];
  }, [printerCtx.printers, printerCtx.station?.id, warehouses.data]);

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Setup"
        title="Printers"
        description="Register printers and stations. Floor Print and shipping labels follow this workstation binding."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/floor/print">
              <Printer className="size-4" />
              Floor print
            </Link>
          </Button>
        }
      />
      <ErrorBanner error={error} />

      <Tabs value={view} onValueChange={setView}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="printers">Printers and stations</TabsTrigger>
          <TabsTrigger value="queue">Ready to print ({queue.length})</TabsTrigger>
          <TabsTrigger value="jobs">Recent jobs</TabsTrigger>
          <TabsTrigger value="sheets">Sheets and scanning</TabsTrigger>
        </TabsList>

        <TabsContent value="printers" className="space-y-(--density-gap)">
          <Card>
            <div className="space-y-3">
              <SectionHeading title="This workstation" description={`Saved in this browser. ${printerCtx.statusLabel}`} />
              <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
                <Field label="Station">
                  <Select
                    value={printerCtx.stationId ?? ""}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      printerCtx.setStationId(id);
                      const station = printerCtx.stations.find((row) => row.id === id);
                      toast.success(
                        station ? `This workstation prints through ${station.name}.` : "Station cleared for this workstation.",
                      );
                    }}
                  >
                    <option value="">Select a station…</option>
                    {printerCtx.stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <fieldset className="space-y-1">
                  <legend className="sr-only">Scan feedback</legend>
                  <label className="flex min-h-8 items-center gap-2 text-sm">
                    <Switch checked={scanner.prefs.beep} onCheckedChange={(value) => scanner.setPrefs({ beep: value })} />
                    Beep on scan
                  </label>
                  <label className="flex min-h-8 items-center gap-2 text-sm">
                    <Switch
                      checked={scanner.prefs.vibrate}
                      onCheckedChange={(value) => scanner.setPrefs({ vibrate: value })}
                    />
                    Vibrate on scan
                    {canVibrate ? null : <span className="text-xs text-muted-foreground">Not on this device</span>}
                  </label>
                  <label className="flex min-h-8 items-center gap-2 text-sm">
                    <Switch checked={scanner.prefs.flash} onCheckedChange={(value) => scanner.setPrefs({ flash: value })} />
                    Flash the screen on scan
                  </label>
                </fieldset>
              </div>
            </div>
          </Card>

          <section className="space-y-2">
            <SectionHeading
              title="Printers"
              description="Browser prints HTML. ZPL download saves a file for a thermal printer. QZ Tray sends ZPL straight to a local printer."
              action={
                <Button size="sm" onClick={() => setAddingPrinter(true)}>
                  <Plus className="size-4" />
                  Add printer
                </Button>
              }
            />
            <DataTable
              id="printers"
              paramPrefix="p_"
              data={printerCtx.printers}
              loading={!ready}
              columns={printerColumns}
              getRowId={(row) => row.id}
              defaultSort={{ id: "name", desc: false }}
              empty={
                <EmptyState
                  icon={Printer}
                  title="No printers yet."
                  body="Add one per label or sheet printer. The first one becomes the default."
                  action={
                    <Button size="sm" onClick={() => setAddingPrinter(true)}>
                      Add printer
                    </Button>
                  }
                />
              }
            />
          </section>

          <section className="space-y-2">
            <SectionHeading
              title="Stations"
              description="A station is a bench or desk. It says which printer takes sheets, bay and SKU labels, and shipping labels."
              action={
                <Button size="sm" variant="outline" onClick={() => setAddingStation(true)}>
                  <Plus className="size-4" />
                  Add station
                </Button>
              }
            />
            <DataTable
              id="print-stations"
              paramPrefix="st_"
              data={printerCtx.stations}
              loading={!ready}
              columns={stationColumns}
              getRowId={(row) => row.id}
              defaultSort={{ id: "name", desc: false }}
              empty={
                <EmptyState
                  icon={MonitorSmartphone}
                  title="No stations yet."
                  body="Add a station, then pick it for this workstation above."
                  action={
                    <Button size="sm" variant="outline" onClick={() => setAddingStation(true)}>
                      Add station
                    </Button>
                  }
                />
              }
            />
          </section>
        </TabsContent>

        <TabsContent value="queue" className="space-y-2">
          <SectionHeading
            title="Ready to print"
            description="Pick lists for open tickets and waves, plus pack slips and shipping labels for orders far enough along."
          />
          <DataTable
            id="print-queue"
            paramPrefix="q_"
            data={queue}
            loading={orders.isLoading}
            error={orders.error?.message}
            columns={QUEUE_COLUMNS}
            getRowId={(job) => job.href}
            rowHref={(job) => job.href}
            tabs={QUEUE_TABS}
            defaultTab="all"
            defaultSort={{ id: "document", desc: false }}
            search={{ placeholder: "Search order, wave, customer", text: (job) => `${job.title} ${job.subtitle}` }}
            empty={
              <EmptyState
                icon={ClipboardList}
                title="Nothing to print."
                body="Open orders and waves show up here with their pick list, slip, or label."
              />
            }
          />
        </TabsContent>

        <TabsContent value="jobs" className="space-y-2">
          <SectionHeading title="Recent print jobs" description="The last 20 jobs sent from any workstation." />
          <DataTable
            id="print-jobs"
            paramPrefix="j_"
            data={jobs.data}
            loading={jobs.isLoading}
            error={jobs.error?.message}
            columns={JOB_COLUMNS}
            getRowId={(job) => job.id}
            facets={JOB_FACETS}
            defaultSort={{ id: "when", desc: true }}
            exportName="print-jobs"
            empty={
              <EmptyState icon={History} title="No jobs yet." body="Print a pick list, slip, or label and it is logged here." />
            }
          />
        </TabsContent>

        <TabsContent value="sheets">
          <div className="grid gap-(--density-gap) md:grid-cols-2">
            <Card>
              <div className="space-y-3">
                <SectionHeading title="Label sheets" description="Print a sheet of barcodes to stick on bays, bins, and gear." />
                <ul className="divide-y rounded-md border text-sm">
                  <SheetLink
                    to="/stock/locations?labels=1"
                    label="Print bay labels"
                    meta={locations.data ? `${locations.data.length} bays` : null}
                  />
                  <SheetLink
                    to="/stock/items?labels=1"
                    label="Print SKU labels"
                    meta={items.data ? `${items.data.length} items` : null}
                  />
                  <SheetLink to="/equipment?labels=1" label="Print equipment labels" meta={null} />
                </ul>
              </div>
            </Card>
            <Card>
              <div className="space-y-3">
                <SectionHeading
                  title="Scan prefixes"
                  description="USB and Bluetooth guns work on every screen. Camera scan uses BarcodeDetector or ZXing fallback."
                />
                <div className="flex flex-wrap gap-1">
                  {SCAN_PREFIX_CHEATSHEET.map((prefix) => (
                    <span
                      key={prefix}
                      className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-px font-mono text-[11px]"
                    >
                      <ScanLine className="size-3 text-muted-foreground" />
                      {prefix}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <PrinterSheet
        open={addingPrinter}
        onOpenChange={setAddingPrinter}
        isFirst={printerCtx.printers.length === 0}
        onSaved={printerCtx.refresh}
      />
      <StationSheet
        open={addingStation}
        onOpenChange={setAddingStation}
        printers={printerCtx.printers}
        warehouses={warehouses.data ?? []}
        onSaved={printerCtx.refresh}
      />
    </div>
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

function SheetLink({ to, label, meta }: { to: string; label: string; meta: string | null }) {
  return (
    <li>
      <Link to={to} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/60">
        <span className="font-medium">{label}</span>
        {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
      </Link>
    </li>
  );
}

function PrinterSheet({
  open,
  onOpenChange,
  isFirst,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isFirst: boolean;
  onSaved: () => Promise<void>;
}) {
  const [printerName, setPrinterName] = useState("Thermal 4x6");
  const [printerConnection, setPrinterConnection] = useState<"browser" | "qz" | "download">("download");
  const [printerMedia, setPrinterMedia] = useState<"letter" | "4x6" | "2x1">("4x6");
  const [qzName, setQzName] = useState("");
  const write = useWrite();

  useEffect(() => {
    if (open) write.setError(null);
  }, [open]);

  async function submit() {
    const done = await write.run(
      "Add printer",
      async () => {
        await api("/api/printers", {
          method: "POST",
          body: JSON.stringify({
            name: printerName,
            connection: printerConnection,
            media: printerMedia,
            dpi: 203,
            qzPrinterName: qzName || undefined,
            isDefault: isFirst,
          }),
        });
        await onSaved();
        return true;
      },
      `Printer ${printerName} added.`,
    );
    if (done) onOpenChange(false);
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add printer"
      description={isFirst ? "Your first printer becomes the default." : "Assign it to a station to use it."}
      submitLabel="Add printer"
      onSubmit={submit}
      busy={write.busy}
      error={write.error}
    >
      <Field label="Name">
        <Input value={printerName} onChange={(e) => setPrinterName(e.target.value)} placeholder="Printer name" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Connection">
          <Select value={printerConnection} onChange={(e) => setPrinterConnection(e.target.value as PrinterRecord["connection"])}>
            <option value="browser">Browser</option>
            <option value="download">ZPL download</option>
            <option value="qz">QZ Tray</option>
          </Select>
        </Field>
        <Field label="Media">
          <Select value={printerMedia} onChange={(e) => setPrinterMedia(e.target.value as PrinterRecord["media"])}>
            <option value="letter">Letter</option>
            <option value="4x6">4×6</option>
            <option value="2x1">2×1</option>
          </Select>
        </Field>
      </div>
      {printerConnection === "qz" ? (
        <Field label="QZ printer name">
          <Input value={qzName} onChange={(e) => setQzName(e.target.value)} placeholder="QZ printer name" />
        </Field>
      ) : null}
    </FormSheet>
  );
}

function StationSheet({
  open,
  onOpenChange,
  printers,
  warehouses,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  printers: PrinterRecord[];
  warehouses: WarehouseMapInfo[];
  onSaved: () => Promise<void>;
}) {
  const [stationName, setStationName] = useState("Pack bench");
  const [stationWarehouseId, setStationWarehouseId] = useState("");
  const [stationDefault, setStationDefault] = useState("");
  const [stationBay, setStationBay] = useState("");
  const [stationShipping, setStationShipping] = useState("");
  const write = useWrite();

  useEffect(() => {
    if (open) write.setError(null);
  }, [open]);

  async function submit() {
    const done = await write.run(
      "Add station",
      async () => {
        await api("/api/print-stations", {
          method: "POST",
          body: JSON.stringify({
            name: stationName,
            warehouseId: stationWarehouseId || null,
            defaultPrinterId: stationDefault || null,
            bayPrinterId: stationBay || null,
            shippingPrinterId: stationShipping || null,
          }),
        });
        await onSaved();
        return true;
      },
      `Station ${stationName} added.`,
    );
    if (done) onOpenChange(false);
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add station"
      description="Pick which printer takes each kind of job. Leave a slot on None to use the default."
      submitLabel="Add station"
      onSubmit={submit}
      busy={write.busy}
      error={write.error}
    >
      <Field label="Name">
        <Input value={stationName} onChange={(e) => setStationName(e.target.value)} placeholder="Station name" autoFocus />
      </Field>
      <Field label="Warehouse">
        <Select value={stationWarehouseId} onChange={(e) => setStationWarehouseId(e.target.value)}>
          <option value="">Any warehouse</option>
          {warehouses.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
      </Field>
      <PrinterPick label="Default" value={stationDefault} onChange={setStationDefault} printers={printers} />
      <PrinterPick label="Bay / SKU" value={stationBay} onChange={setStationBay} printers={printers} />
      <PrinterPick label="Shipping" value={stationShipping} onChange={setStationShipping} printers={printers} />
    </FormSheet>
  );
}

function PrinterPick({
  label,
  value,
  onChange,
  printers,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  printers: PrinterRecord[];
}) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        {printers.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
