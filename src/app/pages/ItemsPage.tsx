import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ImageOff, Package, Plus, Printer, Save, Tags, Trash2, Upload } from "lucide-react";
import { BarcodeLabel } from "../components/BarcodeLabel";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, Table, ToneBadge } from "../components/ui";
import { SkuThumb } from "../components/sku-thumb";
import {
  ActionButton,
  DetailSkeleton,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink, Muted, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { api, uploadFile, type InventoryRow, type Item, type Me } from "../api";
import { useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatExpiresOn } from "@/domain/expiry";
import { formatAsBuiltPart } from "@/domain/as-built";
import { isBelowReorder } from "@/domain/reorder";
import { cn } from "@/lib/utils";
import { SkuHandlers } from "./LaborPage";
import { usePrint } from "../print/PrintProvider";
import { useWarehouse, inWarehouse } from "../warehouse";

const types = ["raw", "wip", "finished", "packaging"];

function typeLabel(type: string): string {
  if (type === "wip") return "WIP";
  return type ? type[0]!.toUpperCase() + type.slice(1) : type;
}

function trackingFlags(item: Pick<Item, "trackLot" | "trackSerial" | "catchWeight" | "trackExpiry">): string[] {
  return [
    item.trackLot ? "Lots" : null,
    item.trackSerial ? "Serials" : null,
    item.catchWeight ? "Catch-weight" : null,
    item.trackExpiry ? "Expiry" : null,
  ].filter(Boolean) as string[];
}

export function ItemsPage({ me }: { me: Me }) {
  const { id } = useParams();
  if (id) return <ItemDetail me={me} id={id} />;
  return <ItemList />;
}

type ItemRow = Item & { onHandQty: number; belowReorder: boolean };

const ITEM_TABS: TabDef<ItemRow>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "reorder", label: "Below reorder", match: (item) => item.belowReorder },
  ...types.map((type) => ({ id: type, label: typeLabel(type), match: (item: ItemRow) => item.type === type })),
];

const ITEM_COLUMNS: DataColumn<ItemRow>[] = [
  {
    id: "sku",
    header: "Item",
    sortValue: (item) => item.sku,
    csv: (item) => item.sku,
    cell: (item) => <SkuCell sku={item.sku} name={item.name} imageUrl={item.imageUrl} to={`/stock/items/${item.id}`} />,
  },
  {
    id: "name",
    header: "Name",
    defaultHidden: true,
    sortValue: (item) => item.name,
    cell: (item) => item.name,
  },
  {
    id: "barcode",
    header: "Barcode",
    defaultHidden: true,
    sortValue: (item) => item.barcode,
    cell: (item) =>
      item.barcode && item.barcode !== item.sku ? <span className="font-mono">{item.barcode}</span> : <Muted>Same as SKU</Muted>,
  },
  {
    id: "type",
    header: "Type",
    sortValue: (item) => typeLabel(item.type),
    csv: (item) => item.type,
    cell: (item) => typeLabel(item.type),
  },
  {
    id: "tracks",
    header: "Tracks",
    csv: (item) => trackingFlags(item).join(" "),
    cell: (item) => {
      const flags = trackingFlags(item);
      if (!flags.length) return <Muted>—</Muted>;
      return (
        <span className="flex flex-wrap gap-1">
          {flags.map((flag) => (
            <span key={flag} className="rounded-md border bg-muted/50 px-1.5 py-px text-[11px] leading-4 text-muted-foreground">
              {flag}
            </span>
          ))}
        </span>
      );
    },
  },
  {
    id: "onHand",
    header: "On hand",
    align: "right",
    sortValue: (item) => item.onHandQty,
    cell: (item) => (
      <span
        className={cn("font-mono", item.belowReorder && "font-medium text-tone-warning")}
        title={item.belowReorder ? "At or below reorder point" : undefined}
      >
        {item.onHandQty}
      </span>
    ),
  },
  {
    id: "reorder",
    header: "Reorder",
    align: "right",
    sortValue: (item) => item.reorderPoint,
    cell: (item) => (item.reorderPoint > 0 ? <span className="font-mono">{item.reorderPoint}</span> : <Muted>—</Muted>),
  },
  {
    id: "baseline",
    header: "Baseline / day",
    align: "right",
    sortValue: (item) => (item.baselineShipRate != null && item.baselineShipRate > 0 ? item.baselineShipRate : null),
    csv: (item) => (item.baselineShipRate != null && item.baselineShipRate > 0 ? item.baselineShipRate : "auto"),
    cell: (item) =>
      item.baselineShipRate != null && item.baselineShipRate > 0 ? (
        <span className="font-mono">{item.baselineShipRate}</span>
      ) : (
        <Muted>auto</Muted>
      ),
  },
  {
    id: "pickMin",
    header: "Pick min",
    align: "right",
    sortValue: (item) => item.pickMin ?? 0,
    cell: (item) => ((item.pickMin ?? 0) > 0 ? <span className="font-mono">{item.pickMin}</span> : <Muted>—</Muted>),
  },
];

function ItemList() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const items = useApiQuery<Item[]>("/api/items");
  const inventory = useApiQuery<InventoryRow[]>("/api/inventory");
  const [creating, setCreating] = useState(false);
  const [labels, setLabels] = useState(params.get("labels") === "1");
  const [labelError, setLabelError] = useState<string | null>(null);
  const printer = usePrint();

  const rows = useMemo<ItemRow[]>(() => {
    const onHand = new Map<string, number>();
    for (const row of inWarehouse(inventory.data ?? [], warehouseId)) {
      onHand.set(row.itemId, (onHand.get(row.itemId) ?? 0) + row.qty);
    }
    return (items.data ?? []).map((item) => {
      const onHandQty = onHand.get(item.id) ?? 0;
      return { ...item, onHandQty, belowReorder: isBelowReorder(onHandQty, item.reorderPoint) };
    });
  }, [items.data, inventory.data, warehouseId]);

  if (labels) {
    const list = items.data ?? [];
    return (
      <div>
        <PageHeader
          eyebrow="SKU labels"
          title="Print item barcodes"
          description="Tape these on totes, bags, and finished goods. Scanning the SKU is enough to look up stock."
          actions={
            <div className="flex gap-2 print:hidden">
              <Button
                variant="ghost"
                onClick={() => {
                  setLabels(false);
                  navigate("/stock/items");
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
                      title: "sku-labels",
                      forceConnection: "download",
                      data: {
                        labelsJson: JSON.stringify(
                          list.map((item) => ({
                            kind: "item",
                            sku: item.sku,
                            name: item.name,
                            barcode: item.barcode || item.sku,
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
        <ErrorBanner error={labelError ?? items.error?.message ?? null} />
        {items.isLoading ? <p className="text-sm text-muted-foreground">Loading labels…</p> : null}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-3">
          {list.map((item) => (
            <div key={item.id} className="break-inside-avoid rounded-xl border border-line bg-card p-3">
              <p className="font-mono text-sm font-semibold">{item.sku}</p>
              <p className="text-xs text-muted-foreground">{item.name}</p>
              <BarcodeLabel value={item.barcode || item.sku} className="mt-2 w-full" />
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
        title="Items"
        description="Raw materials, WIP, packaging, and finished goods. Each SKU has a barcode."
      />
      <DataTable
        id="items"
        data={rows}
        loading={items.isLoading || inventory.isLoading}
        error={items.error?.message ?? inventory.error?.message}
        columns={ITEM_COLUMNS}
        getRowId={(item) => item.id}
        rowHref={(item) => `/stock/items/${item.id}`}
        tabs={ITEM_TABS}
        defaultTab="all"
        defaultSort={{ id: "sku", desc: false }}
        search={{
          placeholder: "Search SKU, name, barcode",
          text: (item) => [item.sku, item.name, item.barcode].filter(Boolean).join(" "),
        }}
        exportName="items"
        toolbar={
          <>
            <Button size="sm" variant="outline" onClick={() => setLabels(true)}>
              <Tags className="size-4" />
              Print labels
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New item
            </Button>
          </>
        }
        empty={
          <EmptyState
            icon={Package}
            title="No items yet."
            body="Add each SKU you stock, make, or ship. Receipts, orders, and counts pick from this list."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New item
              </Button>
            }
          />
        }
      />
      <NewItemSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function FlagField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  );
}

function NewItemSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { error, setError, busy, run } = useWrite();
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("raw");
  const [barcode, setBarcode] = useState("");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [baselineShipRate, setBaselineShipRate] = useState("");
  const [pickMin, setPickMin] = useState("0");
  const [trackLot, setTrackLot] = useState(false);
  const [trackSerial, setTrackSerial] = useState(false);
  const [catchWeight, setCatchWeight] = useState(false);
  const [trackExpiry, setTrackExpiry] = useState(false);

  useEffect(() => {
    if (open) setError(null);
  }, [open, setError]);

  async function create() {
    const created = await run(
      "Create item",
      () =>
        api<Item>("/api/items", {
          method: "POST",
          body: JSON.stringify({
            sku,
            name,
            type,
            barcode: barcode || sku,
            reorderPoint: Number(reorderPoint),
            baselineShipRate: baselineShipRate === "" ? null : Number(baselineShipRate),
            pickMin: Number(pickMin),
            trackLot,
            trackSerial,
            catchWeight,
            trackExpiry,
          }),
        }),
      (row) => `Item ${row.sku} created.`,
    );
    if (!created) return;
    setSku("");
    setName("");
    setBarcode("");
    setReorderPoint("0");
    setBaselineShipRate("");
    setPickMin("0");
    setTrackLot(false);
    setTrackSerial(false);
    setCatchWeight(false);
    onOpenChange(false);
    navigate(`/stock/items/${created.id}`);
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New item"
      description="One SKU per thing you stock, make, or ship. The barcode defaults to the SKU."
      submitLabel="Add item"
      onSubmit={create}
      busy={busy}
      error={error}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="SKU">
          <Input value={sku} onChange={(e) => setSku(e.target.value)} required autoFocus />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((value) => (
              <option key={value} value={value}>
                {typeLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Barcode">
        <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Defaults to SKU" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Reorder point">
          <Input type="number" min={0} value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} />
        </Field>
        <Field label="Baseline / day">
          <Input
            type="number"
            min={0}
            step="0.1"
            value={baselineShipRate}
            onChange={(e) => setBaselineShipRate(e.target.value)}
            placeholder="Auto"
          />
        </Field>
        <Field label="Pick min">
          <Input type="number" min={0} value={pickMin} onChange={(e) => setPickMin(e.target.value)} />
        </Field>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Track</p>
        <div className="grid grid-cols-2 gap-2">
          <FlagField label="Lots" checked={trackLot} onChange={setTrackLot} />
          <FlagField label="Serials" checked={trackSerial} onChange={setTrackSerial} />
          <FlagField label="Catch-weight" checked={catchWeight} onChange={setCatchWeight} />
          <FlagField label="Expiry" checked={trackExpiry} onChange={setTrackExpiry} />
        </div>
      </div>
    </FormSheet>
  );
}

type ItemForm = {
  name: string;
  barcode: string;
  reorderPoint: string;
  baselineShipRate: string;
  pickMin: string;
  trackLot: boolean;
  trackSerial: boolean;
  catchWeight: boolean;
  trackExpiry: boolean;
  imageUrl: string;
};

function formFromItem(item: Item): ItemForm {
  return {
    name: item.name,
    barcode: item.barcode,
    reorderPoint: String(item.reorderPoint ?? 0),
    baselineShipRate: item.baselineShipRate != null && item.baselineShipRate > 0 ? String(item.baselineShipRate) : "",
    pickMin: String(item.pickMin ?? 0),
    trackLot: Boolean(item.trackLot),
    trackSerial: Boolean(item.trackSerial),
    catchWeight: Boolean(item.catchWeight),
    trackExpiry: Boolean(item.trackExpiry),
    imageUrl: item.imageUrl ?? "",
  };
}

function ItemDetail({ me, id }: { me: Me; id: string }) {
  const navigate = useNavigate();
  const [item, setItem] = useState<Item | null>(null);
  const [form, setForm] = useState<ItemForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState("stock");
  const { error, run } = useWrite();

  useEffect(() => {
    api<Item>(`/api/items/${id}`)
      .then((next) => {
        setItem(next);
        setForm(formFromItem(next));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id]);

  if (!item || !form) {
    return loadError ? <ErrorBanner error={loadError} /> : <DetailSkeleton />;
  }

  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const saved = formFromItem(item);
  const dirty = (Object.keys(saved) as (keyof ItemForm)[]).some((key) => saved[key] !== form[key]);

  async function save() {
    if (!form) return;
    const next = await run(
      "Save item",
      () =>
        api<Item>(`/api/items/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name,
            barcode: form.barcode,
            reorderPoint: Number(form.reorderPoint),
            baselineShipRate: form.baselineShipRate === "" ? null : Number(form.baselineShipRate),
            pickMin: Number(form.pickMin),
            trackLot: form.trackLot,
            trackSerial: form.trackSerial,
            catchWeight: form.catchWeight,
            trackExpiry: form.trackExpiry,
            imageUrl: form.imageUrl || null,
          }),
        }),
      (row) => `Saved ${row.sku}.`,
    );
    if (next) {
      // The PATCH answer carries no stock, so keep what the page already shows.
      setItem((current) => ({ ...next, onHand: current?.onHand, lots: current?.lots, serials: current?.serials }));
      setForm(formFromItem(next));
    }
  }

  async function remove() {
    const done = await run("Delete item", () => api(`/api/items/${id}`, { method: "DELETE" }), `Deleted ${item?.sku ?? "item"}.`);
    if (done) navigate("/stock/items");
  }

  async function uploadPhoto(file: File) {
    const next = await run("Upload photo", () => uploadFile<Item>(`/api/items/${id}/image`, file), "Photo uploaded.");
    if (next) {
      setItem((current) => ({ ...next, onHand: current?.onHand, lots: current?.lots, serials: current?.serials }));
      set("imageUrl", next.imageUrl ?? "");
    }
  }

  async function clearPhoto() {
    const next = await run("Clear photo", () => api<Item>(`/api/items/${id}/image`, { method: "DELETE" }), "Photo cleared.");
    if (next) {
      setItem((current) => ({ ...next, onHand: current?.onHand, lots: current?.lots, serials: current?.serials }));
      set("imageUrl", "");
    }
  }

  const onHand = item.onHand ?? [];
  const lots = item.lots ?? [];
  const serials = item.serials ?? [];
  const totals = onHand.reduce(
    (sum, row) => ({
      qty: sum.qty + row.qty,
      allocated: sum.allocated + (row.allocated ?? 0),
      atp: sum.atp + (row.atp ?? row.qty),
    }),
    { qty: 0, allocated: 0, atp: 0 },
  );
  const belowReorder = isBelowReorder(totals.qty, item.reorderPoint);
  const flags = trackingFlags(item);

  const menu: DocumentAction[] = [
    { label: "Print label", icon: Printer, onSelect: () => window.print() },
    ...(me.role === "owner"
      ? [
          {
            label: "Delete item",
            icon: Trash2,
            tone: "danger" as const,
            onSelect: remove,
            confirm: {
              title: `Delete ${item.sku}?`,
              body: "The SKU leaves the catalog and its on-hand rows go with it. Items with ledger history cannot be deleted. This cannot be undone.",
              confirmLabel: "Delete item",
              cancelLabel: "Keep item",
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
        list={{ label: "Items", to: "/stock/items" }}
        title={item.sku}
        description={item.name}
        status={typeLabel(item.type)}
        steps={[]}
        meta={
          <>
            {flags.map((flag) => (
              <ToneBadge key={flag} tone="neutral" dot={false}>
                {flag}
              </ToneBadge>
            ))}
            {belowReorder ? <ToneBadge tone="warning">Below reorder</ToneBadge> : null}
          </>
        }
        primary={dirty ? { label: "Save changes", icon: Save, onSelect: save } : null}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Stock</p>
                <DocumentFact label="On hand">
                  <span className="font-mono tabular-nums">{totals.qty}</span>
                </DocumentFact>
                <DocumentFact label="Allocated">
                  <span className="font-mono tabular-nums">{totals.allocated}</span>
                </DocumentFact>
                <DocumentFact label="ATP">
                  <span className={cn("font-mono tabular-nums", totals.atp <= 0 && "text-tone-danger")}>{totals.atp}</span>
                </DocumentFact>
                <DocumentFact label="Reorder point">
                  {item.reorderPoint > 0 ? (
                    <span className="font-mono tabular-nums">{item.reorderPoint}</span>
                  ) : (
                    <Muted>None</Muted>
                  )}
                </DocumentFact>
              </div>
            </Card>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Photo</p>
                <div className="flex items-start gap-3">
                  <SkuThumb sku={item.sku} name={item.name} imageUrl={item.imageUrl} size="lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Field label="Photo URL">
                      <Input
                        value={form.imageUrl}
                        onChange={(e) => set("imageUrl", e.target.value)}
                        placeholder="https://… or /demo-sku/LAMP.svg"
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium shadow-xs hover:bg-muted/60">
                        <Upload className="size-4" />
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void uploadPhoto(file);
                          }}
                        />
                      </label>
                      {item.imageUrl ? (
                        <ActionButton
                          variant="ghost"
                          action={{
                            label: "Clear photo",
                            icon: ImageOff,
                            onSelect: clearPhoto,
                            confirm: {
                              title: "Clear this photo?",
                              body: "An uploaded photo is deleted. Pickers see the SKU initials until you add a new one.",
                              confirmLabel: "Clear photo",
                              tone: "danger",
                            },
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
            <Card>
              <div className="space-y-2">
                <p className="text-sm font-medium">Barcode</p>
                <BarcodeLabel value={item.barcode || item.sku} className="mx-auto h-16" />
              </div>
            </Card>
          </DocumentRail>
        }
      >
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="stock">Stock ({onHand.length})</TabsTrigger>
            {lots.length ? <TabsTrigger value="lots">Lots ({lots.length})</TabsTrigger> : null}
            {serials.length ? <TabsTrigger value="serials">Serials ({serials.length})</TabsTrigger> : null}
            <TabsTrigger value="settings">Settings{dirty ? " •" : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="stock" className="space-y-4">
            {onHand.length ? (
              <Table columns={["Location", "On hand", "Allocated", "ATP"]}>
                {onHand.map((row) => {
                  const atp = row.atp ?? row.qty;
                  return (
                    <tr key={row.locationId}>
                      <td>
                        <span className="flex flex-col">
                          <DocLink to={`/stock/locations/${row.locationId}`}>{row.locationCode}</DocLink>
                          {row.locationName && row.locationName !== row.locationCode ? (
                            <span className="text-xs text-muted-foreground">{row.locationName}</span>
                          ) : null}
                        </span>
                      </td>
                      <td className="font-mono tabular-nums">{row.qty}</td>
                      <td className="font-mono tabular-nums">{row.allocated ?? 0}</td>
                      <td className={cn("font-mono tabular-nums", atp <= 0 && "text-tone-danger")}>{atp}</td>
                    </tr>
                  );
                })}
              </Table>
            ) : (
              <EmptyState
                icon={Package}
                title="None on hand."
                body="Stock shows here once this SKU is received or produced into a bay."
              />
            )}
            <SkuHandlers itemId={item.id} linkStaff={me.role === "owner"} />
          </TabsContent>

          {lots.length ? (
            <TabsContent value="lots">
              <Table columns={["Location", "Lot", "Expiry", "Qty"]}>
                {lots.map((row) => (
                  <tr key={`${row.locationId}:${row.lotCode}`}>
                    <td>
                      <DocLink to={`/stock/locations/${row.locationId}`}>{row.locationCode}</DocLink>
                    </td>
                    <td className="font-mono">{row.lotCode}</td>
                    <td className="font-mono">{formatExpiresOn(row.expiresOn)}</td>
                    <td className="font-mono tabular-nums">{row.qty}</td>
                  </tr>
                ))}
              </Table>
            </TabsContent>
          ) : null}

          {serials.length ? (
            <TabsContent value="serials">
              <Table columns={["Serial", "Status", "Location", "Built from"]}>
                {serials.map((row) => (
                  <tr key={row.serialCode}>
                    <td className="font-mono">{row.serialCode}</td>
                    <td className="capitalize">{row.status.replaceAll("_", " ")}</td>
                    <td>
                      {row.locationId && row.locationCode ? (
                        <DocLink to={`/stock/locations/${row.locationId}`}>{row.locationCode}</DocLink>
                      ) : (
                        <Muted>—</Muted>
                      )}
                    </td>
                    <td className="font-mono">
                      {(row.builtFrom ?? []).length
                        ? (row.builtFrom ?? [])
                            .map((link) =>
                              formatAsBuiltPart({
                                sku: link.componentSku,
                                lotCode: link.componentLotCode,
                                serial: link.componentSerial,
                                qty: link.qty,
                              }),
                            )
                            .join(" · ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </Table>
            </TabsContent>
          ) : null}

          <TabsContent value="settings">
            <Card>
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Name">
                    <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
                  </Field>
                  <Field label="Barcode">
                    <Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Reorder point">
                    <Input
                      type="number"
                      min={0}
                      value={form.reorderPoint}
                      onChange={(e) => set("reorderPoint", e.target.value)}
                    />
                  </Field>
                  <Field label="Baseline / day">
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      value={form.baselineShipRate}
                      onChange={(e) => set("baselineShipRate", e.target.value)}
                      placeholder="Auto from ships"
                    />
                  </Field>
                  <Field label="Pick min">
                    <Input type="number" min={0} value={form.pickMin} onChange={(e) => set("pickMin", e.target.value)} />
                  </Field>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Track</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <FlagField label="Track lots" checked={form.trackLot} onChange={(value) => set("trackLot", value)} />
                    <FlagField label="Track serials" checked={form.trackSerial} onChange={(value) => set("trackSerial", value)} />
                    <FlagField label="Catch-weight" checked={form.catchWeight} onChange={(value) => set("catchWeight", value)} />
                    <FlagField label="Track expiry" checked={form.trackExpiry} onChange={(value) => set("trackExpiry", value)} />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t pt-3">
                  {dirty ? (
                    <Button size="sm" variant="ghost" onClick={() => setForm(formFromItem(item))}>
                      Discard
                    </Button>
                  ) : null}
                  <ActionButton action={{ label: "Save changes", icon: Save, onSelect: save, disabled: !dirty }} />
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </DocumentFrame>
    </div>
  );
}
