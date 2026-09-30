import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Circle, Package, PackageCheck, Printer, Scale, Store, Truck, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { errorText, type PackagePreset, type QuickShipBatch, type ShipQueue, type ShipQueueOrder } from "../api";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, ToneBadge } from "../components/ui";
import { DataTable, type BulkAction, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink, LineChips, Muted, RelativeTime } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { apiMutate, refreshApi, useApiQuery } from "../query";
import { useWarehouse } from "../warehouse";
import { useSession } from "../session";
import { markShippedReminder } from "@/domain/channels/adapter";

const TABS: TabDef<ShipQueueOrder>[] = [
  { id: "ready", label: "Ready to ship", match: (row) => row.status !== "shipped" && row.ready },
  { id: "attention", label: "Needs attention", match: (row) => row.status !== "shipped" && !row.ready },
  { id: "shipped", label: "Shipped", match: (row) => row.status === "shipped" },
];

function channelLabel(source: string): string {
  if (source === "shopify") return "Shopify";
  if (source === "etsy") return "Etsy";
  if (source === "faire") return "Faire";
  if (source === "woocommerce") return "WooCommerce";
  return "Manual";
}

function weightText(parcel: ShipQueueOrder["parcel"]): string | null {
  if (!parcel.weightOz) return null;
  const lb = Math.floor(parcel.weightOz / 16);
  const oz = parcel.weightOz % 16;
  return lb ? `${lb} lb ${oz} oz` : `${oz} oz`;
}

function labelsHref(ids: string[]): string {
  return `/ship/labels?ids=${ids.map(encodeURIComponent).join(",")}`;
}

export function ShipQueuePage() {
  const me = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const owner = me.role === "owner";
  const queue = useApiQuery<ShipQueue>(warehouseId ? `/api/ship/queue?warehouseId=${encodeURIComponent(warehouseId)}` : null);
  const [presetId, setPresetId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [shipping, setShipping] = useState<string | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const boxOpen = params.get("setup") === "box";

  const data = queue.data;
  const effectivePreset = presetId || data?.defaults.presetId || "";
  const setupLeft = (data?.setup ?? []).filter((step) => !step.done);
  const defaultServiceId = data?.defaults.carrierService ?? null;
  // The route gate sends Manufacturer to Waves; this covers a session opened before the mode switched.
  const quickShip = data?.policy.quickShip !== false;

  async function saveDefaultService() {
    const service = data?.services.find((row) => row.id === serviceId);
    if (!service || !warehouseId) return;
    setSavingDefault(true);
    try {
      await apiMutate(`/api/warehouses/${encodeURIComponent(warehouseId)}`, {
        method: "PATCH",
        body: JSON.stringify({ defaultCarrierService: service.id, defaultCarrierConnectionId: service.connectionId }),
        refresh: "/api/ship",
      });
      toast.success(`${service.name} is now this building's default service.`);
    } catch (err) {
      toast.error(errorText(err, "Could not save the default service. Try again."));
    } finally {
      setSavingDefault(false);
    }
  }

  async function ship(rows: ShipQueueOrder[]) {
    const ids = rows.map((row) => row.id);
    setShipping(ids.length === 1 ? ids[0]! : "bulk");
    try {
      const result = await apiMutate<QuickShipBatch>("/api/ship/quick-ship", {
        body: JSON.stringify({
          ids,
          presetId: effectivePreset || undefined,
          carrierService: serviceId || undefined,
        }),
      });
      const shippedIds = result.outcomes.filter((row) => row.ok).map((row) => row.orderId);
      const failed = result.outcomes.filter((row) => !row.ok);
      if (failed.length) {
        const first = failed[0]!;
        toast.error(`${failed.length} could not ship.`, {
          description: `${first.number ?? "Order"}: ${first.ok ? "" : first.error}`,
        });
      }
      if (shippedIds.length) {
        const manual = result.outcomes.flatMap((row) =>
          row.ok && row.manualPostBack
            ? [{ number: row.number, source: rows.find((order) => order.id === row.orderId)?.source ?? "" }]
            : [],
        );
        toast.success(`Shipped ${shippedIds.length} ${shippedIds.length === 1 ? "order" : "orders"}.`, {
          description: markShippedReminder(manual) ?? undefined,
          action: { label: "Print labels", onClick: () => navigate(labelsHref(shippedIds)) },
        });
      }
      return result;
    } catch (err) {
      toast.error(errorText(err, "Ship did not go through. Try again."));
      return null;
    } finally {
      setShipping(null);
      void refreshApi("/api/ship");
    }
  }

  const columns: DataColumn<ShipQueueOrder>[] = [
    {
      id: "number",
      header: "Order",
      sortValue: (row) => row.number,
      cell: (row) => <DocLink to={`/outbound/orders/${row.id}`}>{row.number}</DocLink>,
    },
    {
      id: "channel",
      header: "Channel",
      sortValue: (row) => channelLabel(row.source),
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {row.source === "manual" ? <Warehouse className="size-3.5 text-muted-foreground" /> : <Store className="size-3.5 text-tone-success" />}
          {channelLabel(row.source)}
        </span>
      ),
    },
    {
      id: "customer",
      header: "Ship to",
      sortValue: (row) => row.customerName,
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.customerName}</span>
          <span className="text-xs text-muted-foreground">
            {[row.shipToCity, row.shipToRegion, row.shipToCountry].filter(Boolean).join(", ") || "No address"}
          </span>
        </span>
      ),
    },
    {
      id: "items",
      header: "Items",
      csv: (row) => row.lines.map((line) => `${line.sku} x${line.qty}`).join("; "),
      cell: (row) => <LineChips lines={row.lines} />,
    },
    {
      id: "weight",
      header: "Weight",
      sortValue: (row) => row.parcel.weightOz ?? 0,
      cell: (row) =>
        row.missingWeight.length ? (
          <Link
            to="/stock/items"
            className="inline-flex items-center gap-1 text-xs text-tone-warning hover:underline"
            title={`No ship weight on ${row.missingWeight.join(", ")}`}
          >
            <Scale className="size-3.5" />
            Add weight
          </Link>
        ) : (
          <span className="font-mono text-sm">{weightText(row.parcel) ?? "—"}</span>
        ),
    },
    {
      id: "service",
      header: "Service",
      sortValue: (row) => row.serviceName ?? "",
      cell: (row) =>
        row.status === "shipped" ? (
          row.trackingUrl ? (
            <a href={row.trackingUrl} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline">
              {row.trackingNumber}
            </a>
          ) : (
            <span className="font-mono text-xs">{row.trackingNumber ?? "—"}</span>
          )
        ) : (
          <span className="flex flex-col text-sm">
            {serviceId ? (data?.services.find((service) => service.id === serviceId)?.name ?? serviceId) : (row.serviceName ?? <Muted>—</Muted>)}
            {row.serviceLive ? <span className="text-[11px] text-muted-foreground">Live postage</span> : null}
          </span>
        ),
    },
    {
      id: "age",
      header: "Ordered",
      sortValue: (row) => row.createdAt,
      cell: (row) => <RelativeTime at={row.status === "shipped" ? row.shippedAt : row.createdAt} />,
    },
    {
      id: "action",
      header: "",
      hideable: false,
      align: "right",
      cell: (row) => {
        if (row.status === "shipped") {
          return (
            <Button size="sm" variant="ghost" asChild>
              <Link to={labelsHref([row.id])}>
                <Printer className="size-4" />
                Label
              </Link>
            </Button>
          );
        }
        if (!quickShip) {
          return (
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/outbound/orders/${row.id}`}>Open</Link>
            </Button>
          );
        }
        if (!row.ready && row.blocker) {
          return (
            <span className="inline-flex max-w-64 items-start gap-1.5 text-left text-xs text-tone-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {row.blocker.error}{" "}
                <Link to={`/outbound/orders/${row.id}`} className="underline">
                  Open
                </Link>
              </span>
            </span>
          );
        }
        return (
          <Button size="sm" disabled={shipping !== null} onClick={() => void ship([row])}>
            <Truck className="size-4" />
            {shipping === row.id ? "Shipping…" : "Ship"}
          </Button>
        );
      },
    },
  ];

  const bulkActions: BulkAction<ShipQueueOrder>[] = [
    {
      label: "Create labels & ship",
      icon: Truck,
      when: (rows) => quickShip && rows.every((row) => row.ready && row.status !== "shipped"),
      confirm: (rows) => ({
        title: `Ship ${rows.length} ${rows.length === 1 ? "order" : "orders"}?`,
        body: "Each order is picked from its suggested shelf, packed, labeled, and marked shipped. Tracking posts back to the store.",
        confirmLabel: "Ship",
        cancelLabel: "Not yet",
      }),
      run: async (rows) => {
        const result = await ship(rows);
        const shippedIds = result?.outcomes.filter((row) => row.ok).map((row) => row.orderId) ?? [];
        if (shippedIds.length) navigate(labelsHref(shippedIds));
      },
    },
    {
      label: "Print labels",
      icon: Printer,
      when: (rows) => rows.every((row) => row.status === "shipped"),
      run: (rows) => navigate(labelsHref(rows.map((row) => row.id))),
    },
  ];

  const readyCount = (data?.orders ?? []).filter((row) => row.status !== "shipped" && row.ready).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Garage"
        title="Ship"
        description="Store orders land here. Pick a box and service, then ship: Rackline picks from the suggested shelf, buys the label, and sends tracking back to the store."
        actions={
          owner ? (
            <Button size="sm" variant="outline" onClick={() => setParams((prev) => withParam(prev, "setup", "box"))}>
              <Package className="size-4" />
              Boxes
            </Button>
          ) : null
        }
      />

      {!quickShip ? (
        <Card className="flex flex-col gap-3 p-(--density-gap) md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium">Manufacturer ships through the floor</p>
            <p className="text-sm text-muted-foreground">
              One-click ship is off. Plan waves by carrier cutoff, then pick, pack, and ship by scan on the floor.
            </p>
          </div>
          <Button size="sm" asChild>
            <Link to="/outbound/waves">Open Waves</Link>
          </Button>
        </Card>
      ) : setupLeft.length && data ? (
        <SetupChecklist steps={data.setup} onBox={() => setParams((prev) => withParam(prev, "setup", "box"))} />
      ) : null}

      <DataTable
        id="ship-queue"
        data={data?.orders}
        loading={queue.isLoading}
        error={queue.error?.message}
        columns={columns}
        getRowId={(row) => row.id}
        tabs={TABS}
        defaultTab="ready"
        defaultSort={{ id: "age", desc: false }}
        search={{
          placeholder: "Search order, customer, SKU",
          text: (row) => [row.number, row.customerName, row.shipToCity, ...row.lines.map((line) => line.sku)].filter(Boolean).join(" "),
        }}
        bulkActions={bulkActions}
        exportName="ship-queue"
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Box"
              className="h-8 w-40"
              value={effectivePreset}
              onChange={(event) => setPresetId(event.target.value)}
            >
              <option value="">No box preset</option>
              {(data?.presets ?? []).map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} ({preset.lengthIn}×{preset.widthIn}×{preset.heightIn})
                </option>
              ))}
            </Select>
            <Select aria-label="Service" className="h-8 w-48" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
              <option value="">Each order's default service</option>
              {(data?.services ?? []).map((service) => (
                <option key={`${service.connectionId ?? "rl"}-${service.id}`} value={service.id}>
                  {service.id === defaultServiceId ? `${service.name} (default)` : service.name}
                </option>
              ))}
            </Select>
            {owner && serviceId && serviceId !== defaultServiceId ? (
              <Button size="sm" variant="outline" disabled={savingDefault} onClick={() => void saveDefaultService()}>
                {savingDefault ? "Saving…" : "Save as default"}
              </Button>
            ) : null}
            <ToneBadge tone={readyCount ? "success" : "neutral"}>{readyCount} ready</ToneBadge>
          </div>
        }
        empty={
          <EmptyState
            icon={PackageCheck}
            title="Nothing to ship."
            body="Connect a store and new orders show up here, ready for a label."
            action={
              <Button size="sm" asChild>
                <Link to="/setup/integrations">Connect a store</Link>
              </Button>
            }
          />
        }
      />

      {owner ? (
        <BoxesSheet
          open={boxOpen}
          presets={data?.presets ?? []}
          onOpenChange={(open) => {
            if (!open) setParams((prev) => withParam(prev, "setup", null), { replace: true });
          }}
        />
      ) : null}
    </div>
  );
}

function withParam(previous: URLSearchParams, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(previous);
  if (value === null) next.delete(key);
  else next.set(key, value);
  return next;
}

function SetupChecklist({ steps, onBox }: { steps: ShipQueue["setup"]; onBox: () => void }) {
  const done = steps.filter((step) => step.done).length;
  return (
    <Card className="flex flex-col gap-3 p-(--density-gap) md:flex-row md:items-center md:justify-between">
      <div>
        <p className="font-medium">Get to one-click shipping</p>
        <p className="text-sm text-muted-foreground">
          {done} of {steps.length} done. Each step makes labels come out right without typing.
        </p>
      </div>
      <ol className="flex flex-wrap gap-2">
        {steps.map((step) => {
          const icon = step.done ? <CheckCircle2 className="size-4 text-tone-success" /> : <Circle className="size-4 text-muted-foreground" />;
          const body = (
            <>
              {icon}
              <span className={step.done ? "text-muted-foreground line-through" : ""}>{step.label}</span>
            </>
          );
          return (
            <li key={step.id}>
              {step.done ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm">{body}</span>
              ) : step.id === "box" ? (
                <button type="button" onClick={onBox} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-muted">
                  {body}
                </button>
              ) : (
                <Link to={step.to} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-muted">
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function BoxesSheet({
  open,
  onOpenChange,
  presets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: PackagePreset[];
}) {
  const [form, setForm] = useState({ name: "", lengthIn: "", widthIn: "", heightIn: "", tareOz: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(() => [...presets].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)), [presets]);

  async function add() {
    setError(null);
    setBusy(true);
    try {
      await apiMutate("/api/ship/presets", {
        body: JSON.stringify({
          name: form.name,
          lengthIn: Number(form.lengthIn),
          widthIn: Number(form.widthIn),
          heightIn: Number(form.heightIn),
          tareOz: form.tareOz ? Number(form.tareOz) : 0,
        }),
        refresh: "/api/ship",
      });
      toast.success(`Saved ${form.name}.`);
      setForm({ name: "", lengthIn: "", widthIn: "", heightIn: "", tareOz: "" });
    } catch (err) {
      setError(errorText(err, "Could not save the box."));
    } finally {
      setBusy(false);
    }
  }

  async function update(preset: PackagePreset, method: "PATCH" | "DELETE") {
    try {
      await apiMutate(`/api/ship/presets/${preset.id}`, {
        method,
        body: method === "PATCH" ? JSON.stringify({ isDefault: true }) : undefined,
        refresh: "/api/ship",
      });
    } catch (err) {
      toast.error(errorText(err, "Could not update the box."));
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Boxes"
      description="Your usual boxes. The default box's size and weight go on every label unless you pick another."
      submitLabel="Add box"
      onSubmit={add}
      busy={busy}
      error={error}
    >
      {sorted.length ? (
        <ul className="divide-y rounded-md border">
          {sorted.map((preset) => (
            <li key={preset.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{preset.name}</span>{" "}
                <span className="text-muted-foreground">
                  {preset.lengthIn}×{preset.widthIn}×{preset.heightIn} in · {preset.tareOz} oz
                </span>
              </span>
              <span className="flex items-center gap-1">
                {preset.isDefault ? (
                  <ToneBadge tone="success">Default</ToneBadge>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void update(preset, "PATCH")}>
                    Make default
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => void update(preset, "DELETE")}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No boxes yet. Add the one you use most; it becomes the default.</p>
      )}
      <Field label="Name">
        <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="10×8 mailer" required />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Length (in)">
          <Input inputMode="numeric" value={form.lengthIn} onChange={(event) => setForm({ ...form, lengthIn: event.target.value })} required />
        </Field>
        <Field label="Width (in)">
          <Input inputMode="numeric" value={form.widthIn} onChange={(event) => setForm({ ...form, widthIn: event.target.value })} required />
        </Field>
        <Field label="Height (in)">
          <Input inputMode="numeric" value={form.heightIn} onChange={(event) => setForm({ ...form, heightIn: event.target.value })} required />
        </Field>
      </div>
      <Field label="Empty box weight (oz)">
        <Input inputMode="numeric" value={form.tareOz} onChange={(event) => setForm({ ...form, tareOz: event.target.value })} placeholder="0" />
      </Field>
    </FormSheet>
  );
}
