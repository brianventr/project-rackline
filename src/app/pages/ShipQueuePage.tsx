import { useMemo, useState, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Link2,
  Package,
  PackageCheck,
  Printer,
  Scale,
  ScanLine,
  Split,
  Store,
  Truck,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import {
  errorText,
  type PackagePreset,
  type QuickShipBatch,
  type QuickShipOutcome,
  type ShippingLabel,
  type ShipQueue,
  type ShipQueueOrder,
} from "../api";
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, ToneBadge } from "../components/ui";
import { DataTable, type BulkAction, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink, LineChips, Muted, RelativeTime } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { useConfirm } from "../components/confirm";
import { apiMutate, refreshApi, useApiQuery } from "../query";
import { useWarehouse } from "../warehouse";
import { useSession } from "../session";
import { usePrint } from "../print/PrintProvider";
import { ShipStation } from "./ShipStation";
import { ShippingLabelCard, shippingLabelJob } from "./ShippingLabelPage";
import { copyTrackingLink } from "../tracking-link";
import { markShippedReminder } from "@/domain/channels/adapter";
import { shortDay } from "@/domain/rate-choice";
import { formatOz } from "@/domain/ship-defaults";
import { cn } from "@/lib/utils";
import { AddressSheet, applySuggestedAddress, extraSuggestion } from "./AddressCheck";

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
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const { warehouseId } = useWarehouse();
  const owner = me.role === "owner";
  const queue = useApiQuery<ShipQueue>(warehouseId ? `/api/ship/queue?warehouseId=${encodeURIComponent(warehouseId)}` : null);
  const [presetId, setPresetId] = useState<string>("");
  const [serviceId, setServiceId] = useState<string>("");
  const [shipping, setShipping] = useState<string | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [printing, setPrinting] = useState<ShippingLabel | null>(null);
  const [addressFor, setAddressFor] = useState<ShipQueueOrder | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);
  const printer = usePrint();
  const boxOpen = params.get("setup") === "box";
  const stationOpen = params.get("station") === "1";

  const data = queue.data;
  const pickedPreset = data?.presets.find((preset) => preset.id === presetId) ?? null;
  const pickedService = data?.services.find((service) => service.id === serviceId) ?? null;
  const setupLeft = (data?.setup ?? []).filter((step) => !step.done);
  const storeConnected = !!data?.setup.some((step) => step.id === "store" && step.done);
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

  async function post(ids: string[], release: Release): Promise<QuickShipBatch> {
    const picked = { presetId: presetId || undefined, carrierService: serviceId || undefined };
    if (!release.releaseHold && !release.acceptAddress) {
      return apiMutate<QuickShipBatch>("/api/ship/quick-ship", { body: JSON.stringify({ ids, ...picked }) });
    }
    const outcome = await apiMutate<QuickShipOutcome>(`/api/orders/${encodeURIComponent(ids[0]!)}/quick-ship`, {
      body: JSON.stringify({ ...picked, ...release }),
    });
    return { shipped: 1, failed: 0, total: 1, outcomes: [outcome] };
  }

  async function ship(rows: ShipQueueOrder[], release: Release = {}) {
    const ids = rows.map((row) => row.id);
    setShipping(ids.length === 1 ? ids[0]! : "bulk");
    try {
      const result = await post(ids, release);
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

  /** The station's label goes out alone: a thermal printer gets ZPL, and browser print sees only this card. */
  async function printStationLabel(label: ShippingLabel) {
    flushSync(() => setPrinting(label));
    try {
      return await printer.print(shippingLabelJob(label));
    } finally {
      setPrinting(null);
    }
  }

  async function shipAnyway(row: ShipQueueOrder) {
    const box = pickedPreset?.name ?? row.box?.name;
    const service = pickedService?.name ?? row.serviceName;
    const ok = await confirm({
      title: `Ship ${row.number} anyway?`,
      body: `Rule ${row.rule?.name ?? ""} holds orders like this for a look.${box || service ? ` It ships${box ? ` in ${box}` : ""}${service ? ` with ${service}` : ""}.` : ""}`,
      confirmLabel: "Ship anyway",
      cancelLabel: "Keep holding",
    });
    if (ok) await ship([row], { releaseHold: true });
  }

  async function shipToThisAddress(row: ShipQueueOrder) {
    const ok = await confirm({
      title: `Ship ${row.number} to this address?`,
      body: (
        <>
          <span className="block whitespace-pre-line font-medium text-foreground">{row.shipToAddress || "No address"}</span>
          <span className="mt-2 block">
            The label is bought to the address as it is. If the carrier cannot deliver it, the box comes back and the
            carrier may charge for the return.
          </span>
        </>
      ),
      confirmLabel: "Ship anyway",
      cancelLabel: "Keep holding",
    });
    if (ok) await ship([row], { acceptAddress: true });
  }

  function editAddress(row: ShipQueueOrder) {
    setAddressFor(row);
    setAddressOpen(true);
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
      id: "box",
      header: "Box",
      sortValue: (row) => row.box?.name ?? "",
      csv: (row) => (row.status === "shipped" ? "" : (pickedPreset?.name ?? row.box?.name ?? "")),
      cell: (row) => {
        if (row.status === "shipped") return <Muted>—</Muted>;
        if (pickedPreset) return <Reasoned text={pickedPreset.name} reason="Picked" />;
        const box = row.box;
        if (!box) return <Muted>—</Muted>;
        const auto = box.source === "auto";
        return (
          <Reasoned
            text={box.name}
            badge={auto ? "auto" : null}
            reason={auto ? null : box.reason}
            detail={box.note ? { text: box.note, warn: box.tooBig } : null}
          />
        );
      },
    },
    {
      id: "service",
      header: "Service",
      sortValue: (row) => row.serviceName ?? "",
      cell: (row) =>
        row.status === "shipped" ? (
          <span className="flex flex-col">
            {row.trackingUrl ? (
              <a href={row.trackingUrl} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline">
                {row.trackingNumber}
              </a>
            ) : (
              <span className="font-mono text-xs">{row.trackingNumber ?? "—"}</span>
            )}
            {row.postageCents || row.shipReason ? (
              <span className="text-[11px] text-muted-foreground">
                {[row.postageCents ? money(row.postageCents) : null, row.shipReason].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </span>
        ) : pickedService || serviceId ? (
          <Reasoned text={pickedService?.name ?? serviceId} reason="Picked" />
        ) : (
          <Reasoned
            text={row.serviceName ?? (row.quotePending ? "Quoted when shipped" : null)}
            reason={[row.serviceReason, row.serviceLive ? "Live postage" : null].filter(Boolean).join(" · ")}
            detail={
              row.quote
                ? {
                    text: `${money(row.quote.amountCents)} · ${row.quote.late ? "late, " : ""}arrives ${shortDay(Number(row.quote.arrivesOn.replaceAll("-", "")))}`,
                    warn: row.quote.late,
                  }
                : null
            }
          />
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
            <span className="inline-flex items-center justify-end gap-1">
              <Button size="sm" variant="ghost" title="Copy the customer's tracking page link" onClick={() => void copyTrackingLink(row.id)}>
                <Link2 className="size-4" />
                Tracking link
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link to={labelsHref([row.id])}>
                  <Printer className="size-4" />
                  Label
                </Link>
              </Button>
            </span>
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
            <span className="inline-flex max-w-64 flex-col items-end gap-1.5">
              <span className="inline-flex items-start gap-1.5 text-left text-xs text-tone-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {row.blocker.error}{" "}
                  <Link to={`/outbound/orders/${row.id}`} className="underline">
                    Open
                  </Link>
                </span>
              </span>
              {row.blocker.code === "SHIP_RULE_HOLD" ? (
                <Button size="xs" variant="outline" disabled={shipping !== null} onClick={() => void shipAnyway(row)}>
                  {shipping === row.id ? "Shipping…" : "Ship anyway"}
                </Button>
              ) : null}
              {row.blocker.code === "CUSTOMS_REQUIRED" && row.blocker.itemId ? (
                <Button size="xs" variant="outline" asChild>
                  <Link to={`/stock/items/${row.blocker.itemId}?tab=settings`}>Add customs</Link>
                </Button>
              ) : null}
              {row.blocker.code === "ADDRESS_INVALID" ? (
                <>
                  {extraSuggestion(row.blocker.error, row.blocker.suggestion) ? (
                    <span className="text-right text-xs text-muted-foreground">Suggested: {row.blocker.suggestion}</span>
                  ) : null}
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {row.blocker.suggestion ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={shipping !== null}
                        onClick={() => void applySuggestedAddress(row, row.blocker?.suggestion)}
                      >
                        Use suggested address
                      </Button>
                    ) : null}
                    <Button size="xs" variant="outline" onClick={() => editAddress(row)}>
                      Edit address
                    </Button>
                    <Button size="xs" variant="outline" disabled={shipping !== null} onClick={() => void shipToThisAddress(row)}>
                      {shipping === row.id ? "Shipping…" : "Ship anyway to this address"}
                    </Button>
                  </span>
                </>
              ) : null}
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
    <>
      <div className={cn("flex min-h-0 flex-1 flex-col gap-(--density-gap)", printing && "print:hidden")}>
        <PageHeader
          eyebrow="Garage"
          title="Ship"
          description="Store orders land here with a box and service chosen by your shipping rules and defaults. Ship, and Rackline picks from the suggested shelf, buys the label, and sends tracking back to the store."
          actions={
            <>
              {quickShip ? (
                <Button
                  size="sm"
                  variant={stationOpen ? "secondary" : "outline"}
                  onClick={() => setParams((prev) => withParam(prev, "station", stationOpen ? null : "1"))}
                >
                  <ScanLine className="size-4" />
                  Scan to ship
                </Button>
              ) : null}
              {owner ? (
                <>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/setup/shipping-rules">
                      <Split className="size-4" />
                      Rules
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setParams((prev) => withParam(prev, "setup", "box"))}>
                    <Package className="size-4" />
                    Boxes
                  </Button>
                </>
              ) : null}
            </>
          }
        />

        {quickShip && stationOpen ? (
          <ShipStation
            orders={data?.orders}
            picked={{ presetId: presetId || undefined, carrierService: serviceId || undefined }}
            owner={owner}
            onClose={() => setParams((prev) => withParam(prev, "station", null))}
            printLabel={printStationLabel}
          />
        ) : null}

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
          <SetupChecklist steps={data.setup} owner={owner} onBox={() => setParams((prev) => withParam(prev, "setup", "box"))} />
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
              <Select aria-label="Box" className="h-8 w-40" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
                <option value="">Each order's box</option>
                {(data?.presets ?? []).map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} ({preset.lengthIn}×{preset.widthIn}×{preset.heightIn})
                  </option>
                ))}
              </Select>
              <Select aria-label="Service" className="h-8 w-48" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                <option value="">Each order's service</option>
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
              body={
                storeConnected
                  ? "New store orders show up here, ready for a label. You can also add an order by hand."
                  : "Connect a store and new orders show up here, ready for a label. Or add an order by hand."
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {storeConnected ? null : (
                    <Button size="sm" asChild>
                      <Link to="/setup/integrations">Connect a store</Link>
                    </Button>
                  )}
                  <Button size="sm" variant={storeConnected ? "primary" : "outline"} asChild>
                    <Link to="/outbound/orders?new=1">New order</Link>
                  </Button>
                </div>
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
        {addressFor ? (
          <AddressSheet
            key={addressFor.id}
            order={addressFor}
            problem={addressFor.blocker?.code === "ADDRESS_INVALID" ? addressFor.blocker.error : null}
            open={addressOpen}
            onOpenChange={setAddressOpen}
          />
        ) : null}
      </div>
      {printing ? <ShippingLabelCard label={printing} className="hidden print:block print:rounded-none print:border-0" /> : null}
    </>
  );
}

/** What a one-order ship lets through: a rule's hold, or the ship-to address as it is. */
type Release = { releaseHold?: boolean; acceptAddress?: boolean };

function withParam(previous: URLSearchParams, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(previous);
  if (value === null) next.delete(key);
  else next.set(key, value);
  return next;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** A value with the small grey line that says why it was chosen. */
function Reasoned({
  text,
  badge,
  reason,
  detail,
}: {
  text: string | null | undefined;
  badge?: string | null;
  reason?: string | null;
  detail?: { text: string; warn?: boolean } | null;
}) {
  if (!text) return <Muted>—</Muted>;
  return (
    <span className="flex flex-col text-sm">
      <span className="flex items-center gap-1.5">
        {text}
        {badge ? (
          <ToneBadge tone="info" dot={false}>
            {badge}
          </ToneBadge>
        ) : null}
      </span>
      {reason ? <span className="text-[11px] text-muted-foreground">{reason}</span> : null}
      {detail ? (
        <span className={detail.warn ? "text-[11px] text-tone-warning" : "text-[11px] text-muted-foreground"}>{detail.text}</span>
      ) : null}
    </span>
  );
}

function SetupChecklist({ steps, owner, onBox }: { steps: ShipQueue["setup"]; owner: boolean; onBox: () => void }) {
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
        {owner ? (
          <li>
            <Link
              to="/setup/shipping-rules"
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted"
            >
              <Split className="size-4" />
              Shipping rules (optional)
            </Link>
          </li>
        ) : null}
      </ol>
    </Card>
  );
}

const EMPTY_BOX = {
  name: "",
  lengthIn: "",
  widthIn: "",
  heightIn: "",
  tareOz: "",
  innerLengthIn: "",
  innerWidthIn: "",
  innerHeightIn: "",
  maxWeightOz: "",
};

function boxForm(preset: PackagePreset): typeof EMPTY_BOX {
  const text = (value: number | null) => (value == null ? "" : String(value));
  return {
    name: preset.name,
    lengthIn: String(preset.lengthIn),
    widthIn: String(preset.widthIn),
    heightIn: String(preset.heightIn),
    tareOz: String(preset.tareOz),
    innerLengthIn: text(preset.innerLengthIn),
    innerWidthIn: text(preset.innerWidthIn),
    innerHeightIn: text(preset.innerHeightIn),
    maxWeightOz: text(preset.maxWeightOz),
  };
}

function boxSummary(preset: PackagePreset): string {
  const parts = [`${preset.lengthIn}×${preset.widthIn}×${preset.heightIn} in`, `${preset.tareOz} oz`];
  if (preset.innerLengthIn && preset.innerWidthIn && preset.innerHeightIn) {
    parts.push(`inside ${preset.innerLengthIn}×${preset.innerWidthIn}×${preset.innerHeightIn}`);
  }
  if (preset.maxWeightOz) parts.push(`holds ${formatOz(preset.maxWeightOz)}`);
  return parts.join(" · ");
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
  const [form, setForm] = useState(EMPTY_BOX);
  const [editing, setEditing] = useState<PackagePreset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(() => [...presets].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)), [presets]);
  const field = (name: keyof typeof EMPTY_BOX) => ({
    value: form[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [name]: event.target.value }),
  });

  function edit(preset: PackagePreset | null) {
    setError(null);
    setEditing(preset);
    setForm(preset ? boxForm(preset) : EMPTY_BOX);
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await apiMutate(editing ? `/api/ship/presets/${editing.id}` : "/api/ship/presets", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          name: form.name,
          lengthIn: Number(form.lengthIn),
          widthIn: Number(form.widthIn),
          heightIn: Number(form.heightIn),
          tareOz: form.tareOz ? Number(form.tareOz) : 0,
          innerLengthIn: form.innerLengthIn.trim(),
          innerWidthIn: form.innerWidthIn.trim(),
          innerHeightIn: form.innerHeightIn.trim(),
          maxWeightOz: form.maxWeightOz.trim(),
        }),
        refresh: "/api/ship",
      });
      toast.success(`Saved ${form.name}.`);
      edit(null);
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
      onOpenChange={(next) => {
        if (!next) edit(null);
        onOpenChange(next);
      }}
      title="Boxes"
      description="Your usual boxes. Quick-ship packs each order in the smallest box its items fit, from their ship sizes; orders without sizes get the default box. A shipping rule or a box you pick comes first."
      submitLabel={editing ? "Save box" : "Add box"}
      onSubmit={save}
      busy={busy}
      error={error}
    >
      {sorted.length ? (
        <ul className="divide-y rounded-md border">
          {sorted.map((preset) => (
            <li key={preset.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{preset.name}</span>{" "}
                <span className="text-muted-foreground">{boxSummary(preset)}</span>
              </span>
              <span className="flex items-center gap-1">
                {preset.isDefault ? (
                  <ToneBadge tone="success">Default</ToneBadge>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void update(preset, "PATCH")}>
                    Make default
                  </Button>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => edit(preset)}>
                  Edit
                </Button>
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
      {editing ? (
        <p className="flex items-center justify-between text-sm">
          <span>
            Editing <span className="font-medium">{editing.name}</span>
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => edit(null)}>
            Add a new box instead
          </Button>
        </p>
      ) : null}
      <Field label="Name">
        <Input {...field("name")} placeholder="10×8 mailer" required />
      </Field>
      <p className="text-xs text-muted-foreground">Outside size, for the label.</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Length (in)">
          <Input inputMode="numeric" {...field("lengthIn")} required />
        </Field>
        <Field label="Width (in)">
          <Input inputMode="numeric" {...field("widthIn")} required />
        </Field>
        <Field label="Height (in)">
          <Input inputMode="numeric" {...field("heightIn")} required />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Inside size, optional. Used to check what fits; blank uses the outside size.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Inside length">
          <Input inputMode="decimal" {...field("innerLengthIn")} placeholder="—" />
        </Field>
        <Field label="Inside width">
          <Input inputMode="decimal" {...field("innerWidthIn")} placeholder="—" />
        </Field>
        <Field label="Inside height">
          <Input inputMode="decimal" {...field("innerHeightIn")} placeholder="—" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Empty box weight (oz)">
          <Input inputMode="numeric" {...field("tareOz")} placeholder="0" />
        </Field>
        <Field label="Max weight (oz)">
          <Input inputMode="numeric" {...field("maxWeightOz")} placeholder="No limit" />
        </Field>
      </div>
    </FormSheet>
  );
}
