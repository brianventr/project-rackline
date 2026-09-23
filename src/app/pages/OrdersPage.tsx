import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Box,
  ClipboardList,
  FileText,
  Layers,
  PackageCheck,
  PackageMinus,
  Play,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  Send,
  Store,
  Tag,
  Trash2,
  Truck,
  Undo2,
  Warehouse,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  errorText,
  type CarrierHub,
  type CarrierRate,
  type CarrierServiceOption,
  type Item,
  type Location,
  type Order,
  type OrderPackage,
  type ShippingLabel,
} from "../api";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, ToneBadge, summarizeLines } from "../components/ui";
import {
  ActionButton,
  ActionMenu,
  DetailSkeleton,
  DocumentActivity,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type BulkAction, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, LineChips, Muted, ProgressCell, RelativeTime, SkuCell, ProgressRow } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { LinesField, TextField, TextareaField, useZodForm } from "../components/form-kit";
import { Term } from "../components/term";
import { blankLine, orderFormSchema, type OrderFormValues } from "@/domain/form-schemas";
import { apiMutate, refreshApi, useApiQuery } from "../query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { STEP_RULES } from "@/domain/step-stamps";
import {
  ORDER_STEPS,
  canPackOrder,
  canPickOrder,
  canShipOrder,
  canShipCartonOrder,
  canStartPick,
  canCancelOrder,
  canUnpickOrder,
  isOpenOrder,
  statusLabel,
} from "@/domain/status";
import { canRelabelException } from "@/domain/tracker";
import { hasUnpicked } from "@/domain/partial-pick";
import { hasUnpacked } from "@/domain/partial-pack";
import { canShipLabeledCarton, canUncartonOrderPackage } from "@/domain/cartons";
import { planShortShip } from "@/domain/short-ship";
import { useWarehouse, inWarehouse } from "../warehouse";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";
import { PickMap } from "../components/PickMap";

export function OrdersPage() {
  const { id } = useParams();
  if (id) return <OrderDetail id={id} />;
  return <OrderList />;
}

const ORDER_TABS: TabDef<Order>[] = [
  { id: "active", label: "Active", match: (order) => isOpenOrder(order.status) },
  { id: "pick", label: "To pick", match: (order) => ["open", "draft", "picking"].includes(order.status) },
  { id: "pack", label: "To pack", match: (order) => order.status === "picked" || order.status === "packing" },
  { id: "ship", label: "To ship", match: (order) => order.status === "packed" },
  { id: "shipped", label: "Shipped", match: (order) => order.status === "shipped" },
  { id: "cancelled", label: "Cancelled", match: (order) => order.status === "cancelled" },
  { id: "all", label: "All", match: () => true },
];

const ORDER_FACETS: FacetDef<Order>[] = [
  { id: "channel", label: "Channel", value: (order) => (order.source === "shopify" ? "shopify" : "floor"), format: channelLabel },
  { id: "status", label: "Status", value: (order) => order.status, format: statusLabel },
];

function channelLabel(source: string | null | undefined): string {
  return source === "shopify" ? "Shopify" : "Floor";
}

function orderUnits(order: Order) {
  const lines = order.lines ?? [];
  return {
    ordered: lines.reduce((sum, line) => sum + line.qty, 0),
    picked: lines.reduce((sum, line) => sum + (line.qtyPicked ?? 0), 0),
    packed: lines.reduce((sum, line) => sum + (line.qtyPacked ?? 0), 0),
    shipped: lines.reduce((sum, line) => sum + (line.qtyShipped ?? 0), 0),
  };
}

function orderProgress(order: Order): { done: number; total: number } {
  const units = orderUnits(order);
  if (order.status === "shipped") return { done: units.ordered, total: units.ordered };
  if (["picked", "packing", "packed"].includes(order.status)) return { done: units.packed, total: units.picked || units.ordered };
  return { done: units.picked, total: units.ordered };
}

const ORDER_COLUMNS: DataColumn<Order>[] = [
  {
    id: "number",
    header: "Order",
    sortValue: (order) => order.number,
    cell: (order) => (
      <span className="flex flex-col">
        <DocLink to={`/outbound/orders/${order.id}`}>{order.number}</DocLink>
        {order.parent ? <span className="text-[11px] text-muted-foreground">Backorder of {order.parent.number}</span> : null}
      </span>
    ),
  },
  {
    id: "customer",
    header: "Customer",
    sortValue: (order) => order.customerName,
    cell: (order) => (
      <span className="flex flex-col">
        <span className="font-medium">{order.customerName}</span>
        {order.shipToCity || order.shipToRegion ? (
          <span className="text-xs text-muted-foreground">{[order.shipToCity, order.shipToRegion].filter(Boolean).join(", ")}</span>
        ) : null}
      </span>
    ),
  },
  {
    id: "channel",
    header: "Channel",
    sortValue: (order) => channelLabel(order.source),
    cell: (order) =>
      order.source === "shopify" ? (
        <span className="inline-flex items-center gap-1.5 text-sm">
          <Store className="size-3.5 text-tone-success" />
          Shopify
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Warehouse className="size-3.5" />
          Floor
        </span>
      ),
  },
  {
    id: "lines",
    header: "Lines",
    csv: (order) => summarizeLines(order.lines),
    cell: (order) => <LineChips lines={order.lines} />,
  },
  {
    id: "progress",
    header: "Progress",
    sortValue: (order) => {
      const progress = orderProgress(order);
      return progress.total ? progress.done / progress.total : 0;
    },
    csv: (order) => {
      const progress = orderProgress(order);
      return `${progress.done}/${progress.total}`;
    },
    cell: (order) => {
      if (order.status === "cancelled") return <Muted>—</Muted>;
      const progress = orderProgress(order);
      return <ProgressCell done={progress.done} total={progress.total} />;
    },
  },
  {
    id: "allocated",
    header: "Allocated",
    align: "right",
    defaultHidden: true,
    sortValue: (order) => order.allocatedUnits ?? 0,
    cell: (order) => <span className="font-mono">{order.allocatedUnits ?? 0}</span>,
  },
  {
    id: "created",
    header: "Created",
    sortValue: (order) => order.createdAt,
    csv: (order) => new Date(order.createdAt).toISOString(),
    cell: (order) => <RelativeTime at={order.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (order) => ORDER_STEPS.indexOf(order.status as (typeof ORDER_STEPS)[number]),
    csv: (order) => order.status,
    cell: (order) => <StatusBadge status={order.status} />,
  },
];

function OrderList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const orders = useApiQuery<Order[]>("/api/orders");
  const [params, setParams] = useSearchParams();
  const [creating, setCreatingState] = useState(() => params.get("new") === "1");

  function setCreating(open: boolean) {
    setCreatingState(open);
    if (!open && params.has("new")) {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete("new");
          return next;
        },
        { replace: true },
      );
    }
  }

  useEffect(() => {
    if (params.get("new") === "1") setCreatingState(true);
  }, [params]);

  const rows = useMemo(() => inWarehouse(orders.data ?? [], warehouseId), [orders.data, warehouseId]);

  const bulkActions: BulkAction<Order>[] = [
    {
      label: "Start pick",
      icon: Play,
      when: (selected) => selected.every((order) => canStartPick(order.status)),
      run: async (selected) => {
        const results = await Promise.allSettled(
          selected.map((order) => api(`/api/orders/${order.id}/start`, { method: "POST" })),
        );
        const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
        void refreshApi();
        if (failed.length) {
          // The count leads; the server's own sentence (and its fix) goes underneath, unwrapped.
          toast.error(`${failed.length} could not start.`, {
            description: errorText(failed[0]!.reason, "Something went wrong. Try again."),
          });
        }
        const started = selected.length - failed.length;
        if (started) toast.success(`Started pick on ${started} ${started === 1 ? "order" : "orders"}. Stock is reserved.`);
      },
    },
    {
      label: "Create wave",
      icon: Layers,
      when: (selected) => selected.every((order) => canStartPick(order.status) && !order.waveId),
      run: async (selected) => {
        const wave = await apiMutate<{ id: string; number: string }>("/api/waves", {
          body: JSON.stringify({ warehouseId, mode: "wave", orderIds: selected.map((order) => order.id) }),
        });
        toast.success(`Wave ${wave.number} created with ${selected.length} orders.`);
        navigate(`/outbound/waves/${wave.id}`);
      },
    },
    {
      label: "Cancel",
      icon: XCircle,
      tone: "danger",
      when: (selected) => selected.every((order) => canCancelOrder(order.status)),
      confirm: (selected) => ({
        title: `Cancel ${selected.length} ${selected.length === 1 ? "order" : "orders"}?`,
        body: "Picked stock goes back to its bay and reservations are released. Cancelled orders cannot be reopened.",
        confirmLabel: "Cancel orders",
        cancelLabel: "Keep orders",
        tone: "danger",
      }),
      run: async (selected) => {
        const results = await Promise.allSettled(
          selected.map((order) => api(`/api/orders/${order.id}/cancel`, { method: "POST" })),
        );
        void refreshApi();
        const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
        if (failed.length) {
          toast.error(`${failed.length} could not be cancelled.`, {
            description: errorText(failed[0]!.reason, "Something went wrong. Try again."),
          });
        }
        if (selected.length - failed.length) toast.success(`Cancelled ${selected.length - failed.length} orders.`);
      },
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Outbound"
        title="Orders"
        description={
          <>
            Shopify checkouts and floor orders. Start pick to <Term id="allocation">reserve stock</Term>, then pick from
            the suggested bay.
          </>
        }
      />
      <DataTable
        id="orders"
        data={rows}
        loading={orders.isLoading}
        error={orders.error?.message}
        columns={ORDER_COLUMNS}
        getRowId={(order) => order.id}
        rowHref={(order) => `/outbound/orders/${order.id}`}
        tabs={ORDER_TABS}
        defaultTab="active"
        facets={ORDER_FACETS}
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search order, customer, SKU",
          text: (order) =>
            [order.number, order.customerName, order.shopifyOrderName, order.shipToCity, ...(order.lines ?? []).map((line) => line.sku)]
              .filter(Boolean)
              .join(" "),
        }}
        bulkActions={bulkActions}
        exportName="orders"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New order
          </Button>
        }
        empty={
          <EmptyState
            icon={ClipboardList}
            title="No orders yet."
            body="Connect Shopify so checkouts land here as pick tickets, or create a floor order by hand."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setCreating(true)}>
                  New order
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/setup/shopify">Connect Shopify</Link>
                </Button>
              </div>
            }
          />
        }
      />
      <NewOrderSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewOrderSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const form = useZodForm(orderFormSchema, { customerName: "", shipToAddress: "", lines: [blankLine()] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep what was typed between opens, but start each open without stale inline errors
  // (closing the sheet blurs the focused field, which would otherwise flag it).
  const { reset, getValues } = form;
  useEffect(() => {
    if (open) reset(getValues(), { keepDefaultValues: true });
  }, [open, reset, getValues]);

  async function create(values: OrderFormValues) {
    setError(null);
    setBusy(true);
    try {
      // Same body as before inline validation: blank rows are already dropped and qty is a number.
      const created = await apiMutate<Order>("/api/orders", {
        body: JSON.stringify({
          warehouseId,
          customerName: values.customerName,
          shipToAddress: values.shipToAddress || undefined,
          lines: values.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
        }),
      });
      toast.success(`Order ${created.number} created.`);
      onOpenChange(false);
      navigate(`/outbound/orders/${created.id}`);
    } catch (err) {
      setError(errorText(err, "Could not create the order."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New floor order"
      description="For phone, email, or will-call orders. Shopify checkouts arrive on their own."
      submitLabel="Create order"
      onSubmit={form.handleSubmit(create)}
      busy={busy}
      error={error}
    >
      <TextField form={form} name="customerName" label="Customer" autoFocus />
      <TextareaField
        form={form}
        name="shipToAddress"
        label="Ship to"
        placeholder={"14 Dock Street\nPortland, OR 97201"}
        rows={3}
      />
      <LinesField form={form} name="lines" items={items.data ?? []} />
    </FormSheet>
  );
}

function OrderDetail({ id }: { id: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [pickLocation, setPickLocation] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [packQtys, setPackQtys] = useState<Record<string, string>>({});
  const [unpickQtys, setUnpickQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCompany, setTrackingCompany] = useState("");
  const [carrierService, setCarrierService] = useState("rackline_ground");
  const [services, setServices] = useState<CarrierServiceOption[]>([]);
  const [rates, setRates] = useState<CarrierRate[]>([]);
  const [weightOz, setWeightOz] = useState("16");
  const [lengthIn, setLengthIn] = useState("12");
  const [widthIn, setWidthIn] = useState("9");
  const [heightIn, setHeightIn] = useState("6");
  const [liveRateId, setLiveRateId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [unpickMode, setUnpickMode] = useState(false);
  const [showShipping, setShowShipping] = useState(false);

  async function load() {
    const [next, nextLocations, hub] = await Promise.all([
      api<Order>(`/api/orders/${id}`),
      api<Location[]>("/api/locations"),
      api<CarrierHub>("/api/carriers"),
    ]);
    setOrder(next);
    setLocations(nextLocations);
    setServices(hub.enabledServices);
    resetQtys(next, nextLocations);
    setTrackingNumber(next.trackingNumber || "");
    setTrackingCompany(next.trackingCompany || "");
    setCarrierService(next.carrierService || hub.enabledServices.find((row) => row.isDefault)?.id || "rackline_ground");
    setWeightOz(String(next.packageWeightOz || 16));
    setLengthIn(String(next.packageLengthIn || 12));
    setWidthIn(String(next.packageWidthIn || 9));
    setHeightIn(String(next.packageHeightIn || 6));
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(errorText(err, "Could not load this order.")));
  }, [id]);

  function resetQtys(next: Order, bays: Location[] = locations) {
    setPickLocation(defaultPickLocation(next, bays));
    setQtys(qtyDefaults(next));
    setPackQtys(packQtyDefaults(next));
    setUnpickQtys(unpickQtyDefaults(next));
  }

  /** Every write goes through here: clear the error, run it, show the result, refresh counts elsewhere. */
  async function run(label: string, write: () => Promise<Order | void>, success?: (next: Order | null) => string) {
    setError(null);
    try {
      const next = await write();
      if (next) {
        setOrder(next);
        resetQtys(next);
      }
      void refreshApi();
      if (success) toast.success(success(next ?? null));
    } catch (err) {
      setError(errorText(err, `${label} failed. Try again.`));
    }
  }

  const sumQty = (values: Record<string, string>) => Object.values(values).reduce((sum, value) => sum + (Number(value) || 0), 0);

  const startPick = () =>
    run("Start pick", () => api<Order>(`/api/orders/${id}/start`, { method: "POST" }), () => "Pick started. Stock is reserved for this order.");

  const pick = () =>
    run(
      "Pick",
      () => {
        const lines = (order?.lines ?? [])
          .map((line) => ({
            lineId: line.id,
            qty: Number(qtys[line.id] || 0),
            lotCode: lots[line.id] || undefined,
            serials: serials[line.id] || undefined,
            weightGrams: parseWeightGrams(weights[line.id]),
          }))
          .filter((line) => line.qty > 0);
        return api<Order>(`/api/orders/${id}/pick`, {
          method: "POST",
          body: JSON.stringify({ locationId: pickLocation, lines }),
        });
      },
      () => {
        const bay = locations.find((row) => row.id === pickLocation)?.code;
        return `Picked ${sumQty(qtys)} ${sumQty(qtys) === 1 ? "unit" : "units"}${bay ? ` from ${bay}` : ""}.`;
      },
    );

  const packLines = () =>
    (order?.lines ?? [])
      .map((line) => ({ lineId: line.id, qty: Number(packQtys[line.id] || 0) }))
      .filter((line) => line.qty > 0);

  const pack = () =>
    run(
      "Pack",
      () => api<Order>(`/api/orders/${id}/pack`, { method: "POST", body: JSON.stringify({ lines: packLines() }) }),
      () => `Packed ${sumQty(packQtys)} ${sumQty(packQtys) === 1 ? "unit" : "units"}.`,
    );

  const packIntoCarton = () =>
    run(
      "Carton",
      () =>
        api<Order>(`/api/orders/${id}/packages`, {
          method: "POST",
          body: JSON.stringify({
            pack: true,
            lines: packLines(),
            weightOz: Number(weightOz),
            lengthIn: Number(lengthIn),
            widthIn: Number(widthIn),
            heightIn: Number(heightIn),
          }),
        }),
      (next) => {
        const box = next?.packages?.at(-1)?.number;
        return box ? `Packed into ${box}.` : "Packed into a new carton.";
      },
    );

  const unpick = () =>
    run(
      "Unpick",
      async () => {
        const lines = (order?.lines ?? [])
          .map((line) => ({ lineId: line.id, qty: Number(unpickQtys[line.id] || 0) }))
          .filter((line) => line.qty > 0);
        const next = await api<Order>(`/api/orders/${id}/unpick`, {
          method: "POST",
          body: JSON.stringify({ locationId: pickLocation || undefined, lines }),
        });
        setUnpickMode(false);
        return next;
      },
      () => `Returned ${sumQty(unpickQtys)} ${sumQty(unpickQtys) === 1 ? "unit" : "units"} to the bay.`,
    );

  const shortShip = () =>
    run("Short ship", () => api<Order>(`/api/orders/${id}/short-ship`, { method: "POST" }), (next) => {
      const backorder = next?.backorders?.at(-1)?.number;
      return backorder ? `Shipped what left. The rest is on backorder ${backorder}.` : "Shipped what left.";
    });

  const cancel = () =>
    run("Cancel", () => api<Order>(`/api/orders/${id}/cancel`, { method: "POST" }), () => "Order cancelled. Picked stock is back on its bay.");

  const ship = () =>
    run(
      "Ship",
      () =>
        api<Order>(`/api/orders/${id}/ship`, {
          method: "POST",
          body: JSON.stringify({
            trackingNumber: trackingNumber || undefined,
            trackingCompany: trackingCompany || undefined,
            carrierService,
            liveRateId,
            weightOz: Number(weightOz),
            lengthIn: Number(lengthIn),
            widthIn: Number(widthIn),
            heightIn: Number(heightIn),
          }),
        }),
      (next) => `Shipped ${next?.number ?? "order"}${next?.source === "shopify" ? " and fulfilled on Shopify" : ""}.`,
    );

  const shipCarton = (pkgId: string, number: string) =>
    run("Ship carton", () => api<Order>(`/api/orders/${id}/packages/${pkgId}/ship`, { method: "POST" }), () => `Shipped ${number}.`);

  const uncarton = (pkgId: string, number: string) =>
    run("Drop carton", () => api<Order>(`/api/orders/${id}/packages/${pkgId}/uncarton`, { method: "POST" }), () => `Dropped ${number}. Its units can be boxed again.`);

  const retryShopify = () =>
    run("Shopify fulfill", () => api<Order>(`/api/orders/${id}/shopify/fulfill`, { method: "POST" }), () => "Sent fulfillment to Shopify.");

  const buyLabel = () =>
    run(
      "Buy label",
      async () => {
        const label = await api<ShippingLabel>(`/api/orders/${id}/label`, {
          method: "POST",
          body: JSON.stringify({
            carrierService,
            trackingNumber: trackingNumber || undefined,
            liveRateId,
            weightOz: Number(weightOz),
            lengthIn: Number(lengthIn),
            widthIn: Number(widthIn),
            heightIn: Number(heightIn),
          }),
        });
        setTrackingNumber(label.trackingNumber);
        setTrackingCompany(label.carrierCompany);
        await load();
      },
      () => "Label bought.",
    );

  const buyCartonLabel = (pkg: OrderPackage) =>
    run(
      "Buy label",
      async () => {
        await api<ShippingLabel>(`/api/orders/${id}/packages/${pkg.id}/label`, {
          method: "POST",
          body: JSON.stringify({
            carrierService,
            weightOz: pkg.weightOz || Number(weightOz),
            lengthIn: pkg.lengthIn || Number(lengthIn),
            widthIn: pkg.widthIn || Number(widthIn),
            heightIn: pkg.heightIn || Number(heightIn),
          }),
        });
        await load();
      },
      () => `Label bought for ${pkg.number}.`,
    );

  const voidLabel = () =>
    run(
      "Void label",
      async () => {
        await api(`/api/orders/${id}/label/void`, { method: "POST" });
        await load();
      },
      () => "Label voided.",
    );

  const relabel = (pkgId?: string) =>
    run(
      "Relabel",
      async () => {
        const path = pkgId ? `/api/orders/${id}/packages/${pkgId}/relabel` : `/api/orders/${id}/relabel`;
        const label = await api<ShippingLabel>(path, { method: "POST" });
        setTrackingNumber(label.trackingNumber);
        setTrackingCompany(label.carrierCompany);
        await load();
      },
      () => "Replacement label bought.",
    );

  async function shopRates() {
    setError(null);
    try {
      const result = await api<{ rates: CarrierRate[] }>(`/api/orders/${id}/rates`, {
        method: "POST",
        body: JSON.stringify({
          carrierService,
          weightOz: Number(weightOz),
          lengthIn: Number(lengthIn),
          widthIn: Number(widthIn),
          heightIn: Number(heightIn),
        }),
      });
      setRates(result.rates);
    } catch (err) {
      setError(errorText(err, "Could not get rates. Try again."));
    }
  }

  if (!order) {
    return error ? <ErrorBanner error={error} /> : <DetailSkeleton />;
  }

  const lines = order.lines ?? [];
  const remaining = hasUnpicked(
    lines.map((line) => ({ lineId: line.id, sku: line.sku, qtyOrdered: line.qty, qtyPicked: line.qtyPicked ?? 0 })),
  );
  const unpacked = hasUnpacked(
    lines.map((line) => ({ lineId: line.id, sku: line.sku, qtyPicked: line.qtyPicked ?? 0, qtyPacked: line.qtyPacked ?? 0 })),
  );
  const thisPick = sumQty(qtys) > 0;
  const thisPack = sumQty(packQtys) > 0;
  const thisUnpick = sumQty(unpickQtys) > 0;
  const unpickable = canUnpickOrder(order.status) && lines.some((line) => (line.unpickRemaining ?? 0) > 0);
  const packages = order.packages ?? [];
  const hasPackages = packages.length > 0;
  const shippedCarton = packages.some((pkg) => pkg.shippedAt);
  const shortShipOk = planShortShip({
    status: order.status,
    lines: lines.map((line) => ({
      lineId: line.id,
      itemId: line.itemId,
      sku: line.sku,
      qty: line.qty,
      qtyPicked: line.qtyPicked ?? 0,
      qtyPacked: line.qtyPacked ?? 0,
    })),
    packages: packages.map((pkg) => ({
      id: pkg.id,
      shippedAt: pkg.shippedAt,
      lines: (pkg.lines ?? []).map((line) => ({ orderLineId: line.orderLineId, qty: line.qty })),
    })),
  }).ok;

  // Open orders can be picked in one step (the server reserves stock first); Start pick only reserves.
  const picking = canPickOrder(order.status) && remaining;
  const packing = canPackOrder(order.status) && unpacked;
  const shipLabel = order.source === "shopify" ? "Ship & fulfill" : "Ship";
  const shippingOpen =
    showShipping ||
    ["picked", "packing", "packed", "shipped"].includes(order.status) ||
    (order.labelStatus != null && order.labelStatus !== "none");
  const shopifyRetry =
    order.source === "shopify" &&
    (order.shopifySyncStatus === "failed" || packages.some((pkg) => pkg.shippedAt && !pkg.shopifyFulfillmentId));

  let primary: DocumentAction | null = null;
  if (picking) primary = { label: "Pick", icon: PackageMinus, onSelect: pick, disabled: !thisPick };
  else if (packing) primary = { label: "Pack", icon: PackageCheck, onSelect: pack, disabled: !thisPack };
  else if (canShipOrder(order.status)) primary = { label: shipLabel, icon: Truck, onSelect: ship };

  const menu: DocumentAction[] = [
    ...(canStartPick(order.status) && remaining
      ? [{ label: "Start pick (reserve stock)", icon: Play, onSelect: startPick }]
      : []),
    { label: "Open on floor", icon: ScanLine, to: floorActionForOrder(order.status, order.id) },
    ...(canPickOrder(order.status) ? [{ label: "Pick list", icon: ClipboardList, to: `/outbound/orders/${order.id}/pick-list` }] : []),
    { label: "Pack slip", icon: FileText, to: `/outbound/orders/${order.id}/pack-slip` },
    ...(!hasPackages ? [{ label: "Shipping label", icon: Printer, to: `/outbound/orders/${order.id}/shipping-label` }] : []),
    ...(packing ? [{ label: "Pack into carton", icon: Box, onSelect: packIntoCarton, disabled: !thisPack }] : []),
    ...(unpickable && !unpickMode
      ? [{ label: "Unpick…", icon: Undo2, onSelect: () => { setUnpickMode(true); setView("lines"); } }]
      : []),
    ...(shopifyRetry ? [{ label: "Retry Shopify", icon: RefreshCw, onSelect: retryShopify }] : []),
    ...(shortShipOk
      ? [
          {
            label: "Short ship",
            icon: Send,
            onSelect: shortShip,
            confirm: {
              title: `Short ship ${order.number}?`,
              body: "Cartons that already left stay shipped. Unshipped units go back to their bay and the rest moves to a new backorder.",
              confirmLabel: "Short ship",
            },
          },
        ]
      : []),
    ...(canCancelOrder(order.status) && !shippedCarton
      ? [
          {
            label: "Cancel order",
            icon: XCircle,
            tone: "danger" as const,
            onSelect: cancel,
            confirm: {
              title: `Cancel ${order.number}?`,
              body: "Picked units go back to their bay and reserved stock is released. A cancelled order cannot be reopened.",
              confirmLabel: "Cancel order",
              cancelLabel: "Keep order",
              tone: "danger" as const,
            },
          },
        ]
      : []),
  ];

  const units = orderUnits(order);
  const tracksAnything = lines.some((line) => line.trackLot || line.trackSerial || line.catchWeight);
  const hasAllocations = lines.some((line) => (line.allocations ?? []).length || (line.allocatedQty ?? 0) > 0);
  const defaultView = canShipOrder(order.status) || (order.status === "packing" && !unpacked) ? "shipping" : "lines";
  const activeView = view ?? defaultView;

  const lineColumns = [
    "Item",
    "Ordered",
    "Picked",
    "Packed",
    "Shipped",
    ...(hasAllocations ? ["Allocated"] : []),
    ...(remaining ? ["Pick from"] : []),
    ...(picking ? ["This pick"] : []),
    ...(picking && tracksAnything ? ["Lot / serial"] : []),
    ...(packing ? ["This pack"] : []),
    ...(unpickMode ? ["This unpick"] : []),
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Outbound"
        list={{ label: "Orders", to: "/outbound/orders" }}
        title={order.number}
        description={[order.customerName, [order.shipToCity, order.shipToRegion].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
        status={order.status}
        steps={ORDER_STEPS}
        refId={order.id}
        stampRules={STEP_RULES.order}
        meta={
          order.source === "shopify" ? (
            <ToneBadge tone="success" dot={false}>
              <Store className="size-3" />
              Shopify {order.shopifyOrderName ?? ""}
            </ToneBadge>
          ) : null
        }
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card className="space-y-3">
              <p className="text-sm font-medium">Units</p>
              <div className="space-y-2 text-sm">
                <ProgressRow label="Picked" done={units.picked} total={units.ordered} />
                <ProgressRow label="Packed" done={units.packed} total={units.ordered} />
                <ProgressRow label="Shipped" done={order.status === "shipped" ? units.ordered : units.shipped} total={units.ordered} />
              </div>
            </Card>
            <Card className="space-y-3">
              <p className="text-sm font-medium">Customer</p>
              <div className="text-sm">
                <p className="font-medium">{order.customerName}</p>
                {order.shipToAddress ? (
                  <p className="mt-1 whitespace-pre-line text-muted-foreground">{order.shipToAddress}</p>
                ) : (
                  <p className="mt-1 text-muted-foreground">No ship-to address.</p>
                )}
              </div>
              <DocumentFact label="Channel">
                {order.source === "shopify" ? (
                  <Link className="underline" to="/setup/shopify">
                    Shopify
                  </Link>
                ) : (
                  "Floor"
                )}
              </DocumentFact>
              {order.source === "shopify" ? (
                <DocumentFact label="Shopify sync">
                  <StatusBadge status={order.shopifySyncStatus || "inbound"} />
                </DocumentFact>
              ) : null}
              {order.parent ? (
                <DocumentFact label="Backorder of">
                  <Link className="underline" to={`/outbound/orders/${order.parent.id}`}>
                    {order.parent.number}
                  </Link>
                </DocumentFact>
              ) : null}
              {(order.backorders ?? []).length > 0 ? (
                <DocumentFact label="Backorder">
                  <span className="flex flex-col items-end gap-1">
                    {(order.backorders ?? []).map((row) => (
                      <Link key={row.id} className="underline" to={`/outbound/orders/${row.id}`}>
                        {row.number}
                      </Link>
                    ))}
                  </span>
                </DocumentFact>
              ) : null}
              <DocumentFact label="Created">
                <RelativeTime at={order.createdAt} />
              </DocumentFact>
              {order.shopifySyncError ? <p className="text-sm text-destructive">{order.shopifySyncError}</p> : null}
            </Card>
          </DocumentRail>
        }
      >
        <Tabs value={activeView} onValueChange={setView}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="lines">Lines</TabsTrigger>
            {hasPackages ? <TabsTrigger value="cartons">Cartons ({packages.length})</TabsTrigger> : null}
            <TabsTrigger value="shipping">Shipping</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="space-y-3">
            {remaining ? (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 shadow-xs">
                <div className="min-w-48 flex-1">
                  <Field label="Pick from">
                    <Select value={pickLocation} onChange={(e) => setPickLocation(e.target.value)}>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.code}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <p className="max-w-sm text-xs text-muted-foreground">
                  The suggested bay per line covers what is left. Tap it in the table, or pick a stop on the map.
                </p>
              </div>
            ) : null}
            {unpickMode ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-tone-warning/30 bg-tone-warning-bg px-3 py-2 text-sm text-tone-warning">
                <Undo2 className="size-4" />
                <span className="flex-1">
                  Enter how many units go <Term id="unpick">back to the bay</Term>, then confirm.
                </span>
                <Button size="sm" variant="outline" onClick={() => setUnpickMode(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={!thisUnpick} onClick={() => void unpick()}>
                  Unpick {sumQty(unpickQtys) || ""}
                </Button>
              </div>
            ) : null}
            {remaining ? (
              <PickMap lines={lines} locations={locations} selectedLocationId={pickLocation} onSelectLocation={setPickLocation} />
            ) : null}
            <Table columns={lineColumns}>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <SkuCell sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} to={`/stock/items/${line.itemId}`} />
                  </td>
                  <td className="font-mono tabular-nums">{line.qty}</td>
                  <td>
                    <ProgressCell done={line.qtyPicked ?? 0} total={line.qty} />
                  </td>
                  <td>
                    <ProgressCell done={line.qtyPacked ?? 0} total={line.qty} />
                  </td>
                  <td className="font-mono tabular-nums">{line.qtyShipped ?? 0}</td>
                  {hasAllocations ? (
                    <td className="font-mono text-xs">
                      {(line.allocations ?? []).length
                        ? (line.allocations ?? []).map((row) => `${row.locationCode} ×${row.qty}`).join(", ")
                        : (line.allocatedQty ?? 0) > 0
                          ? line.allocatedQty
                          : "—"}
                    </td>
                  ) : null}
                  {remaining ? (
                    <td className="font-mono text-xs">
                      {line.suggestedLocation ? (
                        <button
                          type="button"
                          className={cn(
                            "rounded-md border px-1.5 py-0.5 hover:border-primary hover:text-primary",
                            pickLocation === line.suggestedLocation.locationId && "border-primary bg-primary/5 text-primary",
                          )}
                          onClick={() => setPickLocation(line.suggestedLocation!.locationId)}
                        >
                          {line.suggestedLocation.locationCode}
                          <span className="text-muted-foreground"> ×{line.suggestedLocation.qty}</span>
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{line.remaining > 0 ? "—" : "Done"}</span>
                      )}
                    </td>
                  ) : null}
                  {picking ? (
                    <td>
                      {line.remaining > 0 ? (
                        <Input
                          type="number"
                          min={0}
                          max={line.remaining}
                          className="w-20"
                          aria-label={`Pick qty for ${line.sku}`}
                          value={qtys[line.id] ?? "0"}
                          onChange={(e) => setQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                        />
                      ) : (
                        <span className="text-muted-foreground">Done</span>
                      )}
                    </td>
                  ) : null}
                  {picking && tracksAnything ? (
                    <td className="space-y-1">
                      {line.trackLot ? (
                        <Input
                          placeholder="Lot"
                          value={lots[line.id] ?? ""}
                          onChange={(e) => setLots((current) => ({ ...current, [line.id]: e.target.value }))}
                        />
                      ) : null}
                      {line.trackSerial ? (
                        <Input
                          placeholder="Serials"
                          value={serials[line.id] ?? ""}
                          onChange={(e) => setSerials((current) => ({ ...current, [line.id]: e.target.value }))}
                        />
                      ) : null}
                      <CatchWeightInput
                        show={line.catchWeight}
                        value={weights[line.id] ?? ""}
                        onChange={(value) => setWeights((current) => ({ ...current, [line.id]: value }))}
                      />
                    </td>
                  ) : null}
                  {packing ? (
                    <td>
                      {(line.packRemaining ?? 0) > 0 ? (
                        <Input
                          type="number"
                          min={0}
                          max={line.packRemaining}
                          className="w-20"
                          aria-label={`Pack qty for ${line.sku}`}
                          value={packQtys[line.id] ?? "0"}
                          onChange={(e) => setPackQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                        />
                      ) : (
                        <span className="text-muted-foreground">{(line.qtyPicked ?? 0) > 0 ? "Done" : "—"}</span>
                      )}
                    </td>
                  ) : null}
                  {unpickMode ? (
                    <td>
                      {(line.unpickRemaining ?? 0) > 0 ? (
                        <Input
                          type="number"
                          min={0}
                          max={line.unpickRemaining}
                          className="w-20"
                          aria-label={`Unpick qty for ${line.sku}`}
                          value={unpickQtys[line.id] ?? "0"}
                          onChange={(e) => setUnpickQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </Table>
          </TabsContent>

          {hasPackages ? (
            <TabsContent value="cartons">
              <ul className="grid gap-3 md:grid-cols-2">
                {packages.map((pkg) => {
                  const canBuy = !pkg.shippedAt;
                  const canRelabel =
                    canRelabelException({
                      status: order.status,
                      trackerStatus: pkg.trackerStatus,
                      labelStatus: pkg.labelStatus,
                      trackingNumber: pkg.trackingNumber,
                    }).ok && !pkg.shippedAt;
                  const canPrint = Boolean(pkg.trackingNumber);
                  const canShip = canShipCartonOrder(order.status) && canShipLabeledCarton(pkg).ok;
                  const canDrop = canUncartonOrderPackage({ status: order.status, shippedAt: pkg.shippedAt }).ok;
                  const cartonMenu: DocumentAction[] = [
                    ...(canBuy ? [{ label: pkg.trackingNumber ? "Buy new label" : "Buy label", icon: Tag, onSelect: () => buyCartonLabel(pkg) }] : []),
                    ...(canPrint ? [{ label: "Print label", icon: Printer, to: `/outbound/orders/${id}/packages/${pkg.id}/shipping-label` }] : []),
                    ...(canRelabel ? [{ label: "Relabel", icon: RefreshCw, onSelect: () => relabel(pkg.id) }] : []),
                    ...(canDrop
                      ? [
                          {
                            label: "Drop carton",
                            icon: Trash2,
                            tone: "danger" as const,
                            onSelect: () => uncarton(pkg.id, pkg.number),
                            confirm: {
                              title: `Drop ${pkg.number}?`,
                              body: "A live label is voided when it still can be. The units stay packed and can go into another box.",
                              confirmLabel: "Drop carton",
                              tone: "danger" as const,
                            },
                          },
                        ]
                      : []),
                  ];
                  return (
                    <li key={pkg.id} className="space-y-3 rounded-lg border bg-card p-4 shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono font-medium">{pkg.number}</p>
                          <p className="text-xs text-muted-foreground">
                            {pkg.units ?? 0} {(pkg.units ?? 0) === 1 ? "unit" : "units"}
                            {pkg.trackingNumber ? ` · ${pkg.trackingNumber}` : " · no label"}
                          </p>
                        </div>
                        <span className="flex flex-wrap justify-end gap-1">
                          {pkg.shippedAt ? <StatusBadge status="shipped" /> : null}
                          {pkg.trackerStatus ? <StatusBadge status={pkg.trackerStatus} /> : null}
                          {!pkg.shippedAt && pkg.labelStatus ? <StatusBadge status={pkg.labelStatus} /> : null}
                        </span>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <ActionMenu actions={cartonMenu} label={`${pkg.number} actions`} />
                        {canShip ? (
                          <ActionButton action={{ label: "Ship carton", icon: Truck, onSelect: () => shipCarton(pkg.id, pkg.number) }} />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>
          ) : null}

          <TabsContent value="shipping">
            {!shippingOpen ? (
              <EmptyState
                icon={Truck}
                title="Shipping opens once the order is picked."
                body="Carrier, parcel size, rates, and the label live here. You can set them early if you already know the box."
                action={
                  <Button size="sm" variant="outline" onClick={() => setShowShipping(true)}>
                    Set shipping now
                  </Button>
                }
              />
            ) : (
              <Card className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Carrier service">
                    <Select value={carrierService} onChange={(e) => setCarrierService(e.target.value)}>
                      {(services.length ? services : [{ id: "rackline_ground", company: "Rackline", service: "Ground" }]).map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.company} {row.service}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Tracking (paste to skip buying)">
                    <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
                  </Field>
                  <Field label="Carrier">
                    <Input value={trackingCompany} onChange={(e) => setTrackingCompany(e.target.value)} />
                  </Field>
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium">Parcel</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field label="Weight oz">
                      <Input type="number" min={1} value={weightOz} onChange={(e) => setWeightOz(e.target.value)} />
                    </Field>
                    <Field label="Length in">
                      <Input type="number" min={1} value={lengthIn} onChange={(e) => setLengthIn(e.target.value)} />
                    </Field>
                    <Field label="Width in">
                      <Input type="number" min={1} value={widthIn} onChange={(e) => setWidthIn(e.target.value)} />
                    </Field>
                    <Field label="Height in">
                      <Input type="number" min={1} value={heightIn} onChange={(e) => setHeightIn(e.target.value)} />
                    </Field>
                  </div>
                </div>
                {!hasPackages && (order.labelStatus && order.labelStatus !== "none") ? (
                  <DocumentFact label="Label">
                    <StatusBadge status={order.labelStatus} />
                  </DocumentFact>
                ) : null}
                {!hasPackages && order.trackerStatus ? (
                  <DocumentFact label="Tracker">
                    <StatusBadge status={order.trackerStatus} />
                  </DocumentFact>
                ) : null}
                {order.postageCents ? (
                  <DocumentFact label="Postage">${(order.postageCents / 100).toFixed(2)}</DocumentFact>
                ) : null}
                {rates.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Rates</p>
                    <ul className="divide-y rounded-lg border">
                      {rates.map((rate) => {
                        const chosen = carrierService === rate.id && (rate.liveRateId ?? undefined) === liveRateId;
                        return (
                          <li key={`${rate.id}:${rate.liveRateId ?? ""}`}>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60",
                                chosen && "bg-primary/5",
                              )}
                              onClick={() => {
                                setCarrierService(rate.id);
                                setTrackingCompany(rate.company);
                                setLiveRateId(rate.liveRateId || undefined);
                              }}
                            >
                              <span>
                                <span className="font-medium">{rate.company}</span> {rate.service}
                                <span className="text-muted-foreground"> · {rate.transitDays}d</span>
                              </span>
                              <span className="font-mono tabular-nums">${(rate.amountCents / 100).toFixed(2)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <ActionButton variant="outline" action={{ label: "Shop rates", icon: Search, onSelect: shopRates }} />
                  {!hasPackages && order.labelStatus === "purchased" && order.status !== "shipped" ? (
                    <ActionButton
                      variant="outline"
                      action={{
                        label: "Void label",
                        icon: XCircle,
                        onSelect: voidLabel,
                        confirm: {
                          title: "Void this label?",
                          body: "A live label is refunded by the carrier when it can be. You will need a new label to ship.",
                          confirmLabel: "Void label",
                          tone: "danger",
                        },
                      }}
                    />
                  ) : null}
                  {!hasPackages &&
                  canRelabelException({
                    status: order.status,
                    trackerStatus: order.trackerStatus,
                    labelStatus: order.labelStatus,
                    trackingNumber: order.trackingNumber,
                  }).ok ? (
                    <ActionButton variant="outline" action={{ label: "Relabel", icon: RefreshCw, onSelect: () => relabel() }} />
                  ) : null}
                  {!hasPackages && order.trackingNumber ? (
                    <ActionButton variant="outline" action={{ label: "Print label", icon: Printer, to: `/outbound/orders/${id}/shipping-label` }} />
                  ) : null}
                  {!hasPackages && order.status !== "shipped" ? (
                    <ActionButton action={{ label: "Buy label", icon: Tag, onSelect: buyLabel }} />
                  ) : null}
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="activity">
            <DocumentActivity
              refId={order.id}
              refreshKey={`${order.status}:${lines.map((line) => `${line.qtyPicked}:${line.qtyPacked}`).join(",")}`}
            />
          </TabsContent>
        </Tabs>
      </DocumentFrame>
    </div>
  );
}


function floorActionForOrder(status: string, id: string): string {
  if (status === "picked" || status === "packing") return `/floor/pack?id=${id}`;
  if (status === "packed") return `/floor/ship?id=${id}`;
  return `/floor/pick?id=${id}`;
}

function qtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.remaining ?? 0)]));
}

function packQtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.packRemaining ?? 0)]));
}

function unpickQtyDefaults(order: Order): Record<string, string> {
  return Object.fromEntries((order.lines ?? []).map((line) => [line.id, String(line.unpickRemaining ?? 0)]));
}

function defaultPickLocation(order: Order, locations: Location[]): string {
  const remaining = (order.lines ?? []).find((line) => (line.remaining ?? 0) > 0);
  return (
    remaining?.suggestedLocation?.locationId ||
    order.pickLocationId ||
    locations.find((row) => row.slotRole === "pick")?.id ||
    locations.find((row) => row.type === "storage")?.id ||
    locations[0]?.id ||
    ""
  );
}
