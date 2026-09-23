import { useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, ClipboardList, Layers, Plus, ScanLine, Send, Waves } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api, errorText, type Wave, type WaveOpenOrder, type WaveOrderLine } from "../api";
import { Button, Card, EmptyState, ErrorBanner, PageHeader, StatusBadge, Table, ToneBadge } from "../components/ui";
import {
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
import { SelectField, TextField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { Term } from "../components/term";
import { apiMutate, refreshApi, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { choiceOf, optionalText } from "@/domain/form-schemas";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { WAVE_STEPS, canCompleteWave, canReleaseWave, isOpenWave } from "@/domain/status";
import { isBatchFullyPicked, waveOrdersComplete } from "@/domain/waves";
import { useWarehouse, inWarehouse } from "../warehouse";

export function WavesPage() {
  const { id } = useParams();
  if (id) return <WaveDetail id={id} />;
  return <WaveList />;
}

function modeLabel(mode: string): string {
  return mode === "batch" ? "Batch" : "Wave";
}

const WAVE_TABS: TabDef<Wave>[] = [
  { id: "open", label: "Open", match: (wave) => isOpenWave(wave.status) },
  { id: "draft", label: "To release", match: (wave) => wave.status === "draft" },
  { id: "picking", label: "Picking", match: (wave) => wave.status === "released" || wave.status === "picking" },
  { id: "completed", label: "Completed", match: (wave) => wave.status === "completed" },
  { id: "all", label: "All", match: () => true },
];

const WAVE_FACETS: FacetDef<Wave>[] = [{ id: "mode", label: "Mode", value: (wave) => wave.mode, format: modeLabel }];

const WAVE_COLUMNS: DataColumn<Wave>[] = [
  {
    id: "number",
    header: "Wave",
    sortValue: (wave) => wave.number,
    cell: (wave) => <DocLink to={`/outbound/waves/${wave.id}`}>{wave.number}</DocLink>,
  },
  {
    id: "mode",
    header: "Mode",
    sortValue: (wave) => modeLabel(wave.mode),
    cell: (wave) => (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <Layers className={cn("size-3.5", wave.mode === "batch" ? "text-tone-progress" : "text-muted-foreground")} />
        {modeLabel(wave.mode)}
      </span>
    ),
  },
  {
    id: "orders",
    header: "Orders",
    align: "right",
    sortValue: (wave) => wave.orderCount ?? wave.orders?.length ?? 0,
    cell: (wave) => <span className="font-mono">{wave.orderCount ?? wave.orders?.length ?? 0}</span>,
  },
  {
    id: "notes",
    header: "Notes",
    sortValue: (wave) => wave.notes ?? "",
    cell: (wave) => (wave.notes ? <span className="line-clamp-1 text-sm">{wave.notes}</span> : <Muted>—</Muted>),
  },
  {
    id: "created",
    header: "Created",
    sortValue: (wave) => wave.createdAt,
    csv: (wave) => new Date(wave.createdAt).toISOString(),
    cell: (wave) => <RelativeTime at={wave.createdAt} />,
  },
  {
    id: "released",
    header: "Released",
    defaultHidden: true,
    sortValue: (wave) => wave.releasedAt ?? null,
    csv: (wave) => (wave.releasedAt ? new Date(wave.releasedAt).toISOString() : ""),
    cell: (wave) => <RelativeTime at={wave.releasedAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (wave) => WAVE_STEPS.indexOf(wave.status as (typeof WAVE_STEPS)[number]),
    csv: (wave) => wave.status,
    cell: (wave) => <StatusBadge status={wave.status} />,
  },
];

function WaveList() {
  const { warehouseId } = useWarehouse();
  const waves = useApiQuery<Wave[]>("/api/waves");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => inWarehouse(waves.data ?? [], warehouseId), [waves.data, warehouseId]);

  const bulkActions: BulkAction<Wave>[] = [
    {
      label: "Release",
      icon: Send,
      when: (selected) => selected.every((wave) => canReleaseWave(wave.status)),
      run: async (selected) => {
        const results = await Promise.allSettled(
          selected.map((wave) => api(`/api/waves/${wave.id}/release`, { method: "POST" })),
        );
        void refreshApi();
        const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
        if (failed.length) {
          // The count leads; the server's own sentence (and its fix) goes underneath, unwrapped.
          toast.error(`${failed.length} could not release.`, {
            description: errorText(failed[0]!.reason, "Something went wrong. Try again."),
          });
        }
        const released = selected.length - failed.length;
        if (released) toast.success(`Released ${released} ${released === 1 ? "wave" : "waves"} to the floor.`);
      },
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Outbound"
        title="Waves"
        description={
          <>
            Group open orders into a <Term id="wave">wave</Term> or <Term id="batch-pick">batch pick</Term>, release to
            the floor, then complete.
          </>
        }
      />
      <DataTable
        id="waves"
        data={rows}
        loading={waves.isLoading}
        error={waves.error?.message}
        columns={WAVE_COLUMNS}
        getRowId={(wave) => wave.id}
        rowHref={(wave) => `/outbound/waves/${wave.id}`}
        tabs={WAVE_TABS}
        defaultTab="open"
        facets={WAVE_FACETS}
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search wave, notes",
          text: (wave) => [wave.number, wave.notes].filter(Boolean).join(" "),
        }}
        bulkActions={bulkActions}
        exportName="waves"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New wave
          </Button>
        }
        empty={
          <EmptyState
            icon={Waves}
            title="No waves yet."
            body="Group open orders so one picker walks the floor once. Batch mode adds up SKUs across orders."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New wave
              </Button>
            }
          />
        }
      />
      <NewWaveSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** POST /api/waves (`src/routes/waves.ts`): at least one order. The server reads any mode but batch as wave. */
const waveFormSchema = z.object({
  mode: choiceOf(["wave", "batch"], "Pick wave or batch."),
  notes: optionalText,
  orderIds: z.array(z.string()).min(1, "Pick at least one order for the wave."),
});

const WAVE_MODE_OPTIONS = [
  { value: "wave", label: "Wave (pick per order)" },
  { value: "batch", label: "Batch (aggregate SKUs)" },
];

function NewWaveSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
  const openOrders = useApiQuery<WaveOpenOrder[]>(open ? `/api/waves-open-orders${query}` : null);
  const form = useZodForm(waveFormSchema, { mode: "wave", notes: "", orderIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listLabelId = useId();

  // Keep what was picked between opens, but start each open without stale inline errors.
  const { reset, getValues, watch } = form;
  useEffect(() => {
    if (open) reset(getValues(), { keepDefaultValues: true });
  }, [open, reset, getValues]);

  const selected = watch("orderIds");
  const available = openOrders.data ?? [];
  const allSelected = available.length > 0 && available.every((order) => selected.includes(order.id));

  async function create(values: ZodFormOutput<typeof waveFormSchema>) {
    setError(null);
    setBusy(true);
    try {
      // Same body as before: notes trimmed and left out when blank.
      const created = await apiMutate<Wave>("/api/waves", {
        body: JSON.stringify({
          warehouseId,
          mode: values.mode,
          notes: values.notes.trim() || undefined,
          orderIds: values.orderIds,
        }),
      });
      const count = values.orderIds.length;
      toast.success(`Wave ${created.number} created with ${count} ${count === 1 ? "order" : "orders"}.`);
      reset({ mode: values.mode, notes: "", orderIds: [] }, { keepDefaultValues: true });
      onOpenChange(false);
      navigate(`/outbound/waves/${created.id}`);
    } catch (err) {
      setError(errorText(err, "Could not create the wave."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New wave"
      description="Pick open orders that are not on a wave yet. Release sends them to the floor."
      submitLabel={selected.length ? `Create wave (${selected.length})` : "Create wave"}
      onSubmit={form.handleSubmit(create)}
      busy={busy}
      error={error}
      wide
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField form={form} name="mode" label="Mode" options={WAVE_MODE_OPTIONS} />
        <TextField form={form} name="notes" label="Notes" placeholder="Optional" />
      </div>
      <Form {...form}>
        <FormField
          control={form.control}
          name="orderIds"
          render={({ field }) => {
            const ids = field.value;
            const toggle = (orderId: string) =>
              field.onChange(ids.includes(orderId) ? ids.filter((id) => id !== orderId) : [...ids, orderId]);
            return (
              <FormItem className="gap-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p id={listLabelId} className="text-sm font-medium">
                    Open orders
                  </p>
                  {available.length > 1 ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => field.onChange(allSelected ? [] : available.map((order) => order.id))}
                    >
                      {allSelected ? "Clear" : "Select all"}
                    </Button>
                  ) : null}
                </div>
                {openOrders.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : available.length === 0 ? (
                  <EmptyState
                    icon={ClipboardList}
                    className="py-6"
                    title="No open orders to wave."
                    body="An order can join a wave while it is open and not on another wave."
                    action={
                      <Button size="sm" asChild>
                        <Link to="/outbound/orders?new=1">New order</Link>
                      </Button>
                    }
                  />
                ) : (
                  <FormControl>
                    <ul
                      role="group"
                      aria-labelledby={listLabelId}
                      className="divide-y rounded-lg border aria-invalid:border-destructive"
                    >
                      {available.map((order, index) => (
                        <li key={order.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60">
                            <Checkbox
                              ref={index === 0 ? field.ref : undefined}
                              checked={ids.includes(order.id)}
                              onCheckedChange={() => toggle(order.id)}
                            />
                            <span className="font-mono font-medium">{order.number}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{order.customerName}</span>
                            <RelativeTime at={order.createdAt} className="text-xs" />
                          </label>
                        </li>
                      ))}
                    </ul>
                  </FormControl>
                )}
                <FormMessage />
              </FormItem>
            );
          }}
        />
      </Form>
    </FormSheet>
  );
}

function orderPickUnits(lines: WaveOrderLine[]) {
  return {
    qty: lines.reduce((sum, line) => sum + line.qty, 0),
    picked: lines.reduce((sum, line) => sum + (line.qtyPicked ?? 0), 0),
  };
}

function WaveDetail({ id }: { id: string }) {
  const [wave, setWave] = useState<Wave | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  const { error, run } = useWrite();

  useEffect(() => {
    api<Wave>(`/api/waves/${id}`)
      .then(setWave)
      .catch((err: unknown) => setLoadError(errorText(err, "Could not load this wave.")));
  }, [id]);

  if (!wave) {
    return loadError ? <ErrorBanner error={loadError} /> : <DetailSkeleton />;
  }

  const current = wave;
  const orders = current.orders ?? [];
  const orderLines = current.orderLines ?? [];
  const batchLines = current.batchLines ?? [];
  const isBatch = current.mode === "batch";
  const linesByOrder = new Map<string, WaveOrderLine[]>();
  for (const line of orderLines) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push(line);
    linesByOrder.set(line.orderId, list);
  }
  const units = orderPickUnits(orderLines);
  const ordersDone = waveOrdersComplete(orders);
  const allPicked = ordersDone || (isBatch && batchLines.length > 0 && isBatchFullyPicked(batchLines));
  const floorLink = `/floor/wave?id=${current.id}`;

  async function release() {
    const next = await run(
      "Release",
      () => api<Wave>(`/api/waves/${id}/release`, { method: "POST" }),
      `${current.number} released to the floor.`,
    );
    if (next) setWave(next);
  }

  async function complete() {
    const next = await run(
      "Complete",
      () => api<Wave>(`/api/waves/${id}/complete`, { method: "POST" }),
      `${current.number} completed.`,
    );
    if (next) setWave(next);
  }

  const completeAction: DocumentAction = { label: "Complete", icon: CheckCircle2, onSelect: complete };
  let primary: DocumentAction | null = null;
  if (canReleaseWave(current.status)) primary = { label: "Release", icon: Send, onSelect: release };
  else if (canCompleteWave(current.status) && !allPicked)
    primary = { label: isBatch ? "Batch pick" : "Pick on floor", icon: ScanLine, to: floorLink };
  else if (canCompleteWave(current.status)) primary = completeAction;

  const menu: DocumentAction[] = [
    { label: "Pick list", icon: ClipboardList, to: `/outbound/waves/${current.id}/pick-list` },
    ...(primary?.to === floorLink ? [] : [{ label: "Open on floor", icon: ScanLine, to: floorLink }]),
    ...(canCompleteWave(current.status) && primary !== completeAction ? [completeAction] : []),
  ];

  const activeView = view ?? (isBatch && batchLines.length ? "batch" : "orders");

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Outbound"
        list={{ label: "Waves", to: "/outbound/waves" }}
        title={current.number}
        description={[`${orders.length} ${orders.length === 1 ? "order" : "orders"}`, current.notes].filter(Boolean).join(" · ")}
        status={current.status}
        steps={WAVE_STEPS}
        meta={
          <ToneBadge tone={isBatch ? "progress" : "neutral"} dot={false}>
            <Layers className="size-3" />
            {isBatch ? "Batch pick" : "Wave pick"}
          </ToneBadge>
        }
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Picking</p>
                <ProgressRow label="Units picked" done={units.picked} total={units.qty} />
                <ProgressRow
                  label="Orders picked"
                  done={orders.filter((order) => waveOrdersComplete([order])).length}
                  total={orders.length}
                />
                <DocumentFact label="Mode">{isBatch ? "Batch (aggregate SKUs)" : "Wave (pick per order)"}</DocumentFact>
                <DocumentFact label="Created">
                  <RelativeTime at={current.createdAt} />
                </DocumentFact>
                {current.releasedAt ? (
                  <DocumentFact label="Released">
                    <RelativeTime at={current.releasedAt} />
                  </DocumentFact>
                ) : null}
                {current.completedAt ? (
                  <DocumentFact label="Completed">
                    <RelativeTime at={current.completedAt} />
                  </DocumentFact>
                ) : null}
              </div>
            </Card>
          </DocumentRail>
        }
      >
        <Tabs value={activeView} onValueChange={setView}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="orders">Orders ({orders.length})</TabsTrigger>
            {isBatch ? <TabsTrigger value="batch">Batch lines ({batchLines.length})</TabsTrigger> : null}
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            {orders.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No orders on this wave." />
            ) : (
              <Table columns={["Order", "Customer", "Lines", "Picked", "Status"]}>
                {orders.map((order) => {
                  const lines = linesByOrder.get(order.id) ?? [];
                  const picked = orderPickUnits(lines);
                  return (
                    <tr key={order.id}>
                      <td>
                        <DocLink to={`/outbound/orders/${order.id}`} className="whitespace-nowrap">{order.number}</DocLink>
                      </td>
                      <td>{order.customerName}</td>
                      <td>
                        <LineChips lines={lines} />
                      </td>
                      <td>
                        {order.status === "cancelled" ? <Muted>—</Muted> : <ProgressCell done={picked.picked} total={picked.qty} />}
                      </td>
                      <td>
                        <StatusBadge status={order.status} />
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </TabsContent>

          {isBatch ? (
            <TabsContent value="batch">
              {batchLines.length === 0 ? (
                <EmptyState
                  icon={Waves}
                  title="Batch lines appear on release."
                  body="Release adds up each SKU across the orders so the picker grabs it once."
                />
              ) : (
                <Table columns={["Item", "Qty", "Picked", "Remaining"]}>
                  {batchLines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <SkuCell sku={line.sku} name={line.itemName} to={`/stock/items/${line.itemId}`} />
                      </td>
                      <td className="font-mono tabular-nums">{line.qty}</td>
                      <td>
                        <ProgressCell done={line.qtyPicked} total={line.qty} />
                      </td>
                      <td className="font-mono tabular-nums">
                        {line.remaining > 0 ? line.remaining : <span className="text-muted-foreground">Done</span>}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </TabsContent>
          ) : null}

          <TabsContent value="activity">
            <DocumentActivity refId={current.id} refreshKey={`${current.status}:${units.picked}`} />
          </TabsContent>
        </Tabs>
      </DocumentFrame>
    </div>
  );
}

