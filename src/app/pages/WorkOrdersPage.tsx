import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BookOpen, CheckCircle2, Hammer, ListTree, Play, Plus, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { api, errorText, type Item, type Location, type WorkOrder } from "../api";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, StatusBadge } from "../components/ui";
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
import { DocLink, ProgressCell, RelativeTime, SkuCell, ProgressRow } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { NumberField, SelectField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { Term } from "../components/term";
import { AsBuiltList } from "../components/as-built";
import { KitRecipeCard } from "../components/kit-recipe";
import { apiMutate, refreshApi, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STEP_RULES } from "@/domain/step-stamps";
import { workOrderFormSchema } from "@/domain/form-schemas";
import { WORK_ORDER_STEPS, canCompleteWorkOrder } from "@/domain/status";
import { useWarehouse, inWarehouse } from "../warehouse";

export function WorkOrdersPage() {
  const { id } = useParams();
  if (id) return <WorkOrderDetail id={id} />;
  return <WorkOrderList />;
}

const WORK_ORDER_TABS: TabDef<WorkOrder>[] = [
  { id: "open", label: "Open", match: (order) => canCompleteWorkOrder(order.status) },
  { id: "draft", label: "Draft", match: (order) => order.status === "draft" },
  { id: "in_progress", label: "In progress", match: (order) => order.status === "in_progress" },
  { id: "completed", label: "Completed", match: (order) => order.status === "completed" },
  { id: "all", label: "All", match: () => true },
];

const WORK_ORDER_FACETS: FacetDef<WorkOrder>[] = [{ id: "item", label: "Item", value: (order) => order.sku }];

const WORK_ORDER_COLUMNS: DataColumn<WorkOrder>[] = [
  {
    id: "number",
    header: "Work order",
    sortValue: (order) => order.number,
    cell: (order) => <DocLink to={`/make/work-orders/${order.id}`}>{order.number}</DocLink>,
  },
  {
    id: "item",
    header: "Item",
    sortValue: (order) => order.sku,
    csv: (order) => `${order.sku} — ${order.itemName}`,
    cell: (order) => <SkuCell sku={order.sku} name={order.itemName} imageUrl={order.imageUrl} />,
  },
  {
    id: "completed",
    header: "Completed",
    sortValue: (order) => (order.qty ? (order.qtyCompleted ?? 0) / order.qty : 0),
    csv: (order) => `${order.qtyCompleted ?? 0}/${order.qty}`,
    cell: (order) => <ProgressCell done={order.qtyCompleted ?? 0} total={order.qty} />,
  },
  {
    id: "qty",
    header: "Qty",
    align: "right",
    defaultHidden: true,
    sortValue: (order) => order.qty,
    cell: (order) => <span className="font-mono">{order.qty}</span>,
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
    sortValue: (order) => WORK_ORDER_STEPS.indexOf(order.status as (typeof WORK_ORDER_STEPS)[number]),
    csv: (order) => order.status,
    cell: (order) => <StatusBadge status={order.status} />,
  },
];

function WorkOrderList() {
  const { warehouseId } = useWarehouse();
  const orders = useApiQuery<WorkOrder[]>("/api/work-orders");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => inWarehouse(orders.data ?? [], warehouseId), [orders.data, warehouseId]);

  const bulkActions: BulkAction<WorkOrder>[] = [
    {
      label: "Start",
      icon: Play,
      when: (selected) => selected.every((order) => order.status === "draft"),
      run: async (selected) => {
        const results = await Promise.allSettled(
          selected.map((order) => api(`/api/work-orders/${order.id}/start`, { method: "POST" })),
        );
        void refreshApi();
        const failed = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
        if (failed.length) {
          // The count leads; the server's own sentence (and its fix) goes underneath, unwrapped.
          toast.error(`${failed.length} could not start.`, {
            description: errorText(failed[0]!.reason, "Something went wrong. Try again."),
          });
        }
        const started = selected.length - failed.length;
        if (started) toast.success(`Started ${started} ${started === 1 ? "work order" : "work orders"}.`);
      },
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Make"
        title="Work orders"
        description={
          <>
            Completing a <Term id="work-order">work order</Term> consumes the <Term id="recipe">recipe</Term> and puts
            finished goods in the output bay.
          </>
        }
      />
      <DataTable
        id="work-orders"
        data={rows}
        loading={orders.isLoading}
        error={orders.error?.message}
        columns={WORK_ORDER_COLUMNS}
        getRowId={(order) => order.id}
        rowHref={(order) => `/make/work-orders/${order.id}`}
        tabs={WORK_ORDER_TABS}
        defaultTab="open"
        facets={WORK_ORDER_FACETS}
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search work order, SKU",
          text: (order) => [order.number, order.sku, order.itemName].filter(Boolean).join(" "),
        }}
        bulkActions={bulkActions}
        exportName="work-orders"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New work order
          </Button>
        }
        empty={
          <EmptyState
            icon={Hammer}
            title="No work orders yet."
            body={
              <>
                Release a work order to build a finished or <Term id="wip">WIP</Term> SKU from its recipe.
              </>
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setCreating(true)}>
                  New work order
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/make/recipes">Recipes</Link>
                </Button>
              </div>
            }
          />
        }
      />
      <NewWorkOrderSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function isBuildable(item: Item) {
  return item.type === "finished" || item.type === "wip";
}

function NewWorkOrderSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const locations = useApiQuery<Location[]>(open ? "/api/locations" : null);
  const form = useZodForm(workOrderFormSchema, { itemId: "", qty: "1", sourceLocationId: "", outputLocationId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parents = useMemo(() => (items.data ?? []).filter(isBuildable), [items.data]);
  const bays = locations.data ?? [];
  const bayOptions = bays.map((location) => ({ value: location.id, label: `${location.code} — ${location.name}` }));

  // Keep what was typed between opens, but start each open without stale inline errors.
  const { reset, getValues, setValue, watch } = form;
  useEffect(() => {
    if (open) reset(getValues(), { keepDefaultValues: true });
  }, [open, reset, getValues]);

  // Same defaults as before: the first buildable SKU, then bays by type once they load.
  const [itemId, sourceLocationId, outputLocationId] = watch(["itemId", "sourceLocationId", "outputLocationId"]);
  useEffect(() => {
    if (!itemId && parents[0]) setValue("itemId", parents[0].id);
  }, [parents, itemId, setValue]);

  useEffect(() => {
    if (!bays.length) return;
    const storage = bays.find((location) => location.type === "storage") ?? bays[0];
    const production = bays.find((location) => location.type === "production") ?? bays[0];
    if (!getValues("sourceLocationId") && storage) setValue("sourceLocationId", storage.id);
    if (!getValues("outputLocationId") && production) setValue("outputLocationId", production.id);
  }, [bays, sourceLocationId, outputLocationId, getValues, setValue]);

  async function create(values: ZodFormOutput<typeof workOrderFormSchema>) {
    setError(null);
    setBusy(true);
    try {
      const created = await apiMutate<WorkOrder>("/api/work-orders", {
        // Same body as before: qty is already a number.
        body: JSON.stringify({
          warehouseId,
          itemId: values.itemId,
          qty: values.qty,
          sourceLocationId: values.sourceLocationId,
          outputLocationId: values.outputLocationId,
        }),
      });
      toast.success(`Work order ${created.number} released.`);
      onOpenChange(false);
      navigate(`/make/work-orders/${created.id}`);
    } catch (err) {
      setError(errorText(err, "Could not create the work order."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New work order"
      description="Pick a SKU with a recipe. Components come out of one bay and finished goods go into another."
      submitLabel="Release work order"
      onSubmit={form.handleSubmit(create)}
      busy={busy}
      error={error}
    >
      <SelectField
        form={form}
        name="itemId"
        label="Build item"
        placeholder="Select item"
        options={parents.map((item) => ({ value: item.id, label: `${item.sku} — ${item.name}` }))}
      />
      <NumberField form={form} name="qty" label="Quantity" min={1} />
      <SelectField form={form} name="sourceLocationId" label="Consume from" options={bayOptions} />
      <SelectField form={form} name="outputLocationId" label="Put away finished" options={bayOptions} />
    </FormSheet>
  );
}

function WorkOrderDetail({ id }: { id: string }) {
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [thisQty, setThisQty] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState("recipe");
  const locations = useApiQuery<Location[]>("/api/locations");
  const { error, run } = useWrite();

  useEffect(() => {
    api<WorkOrder>(`/api/work-orders/${id}`)
      .then((next) => {
        setOrder(next);
        setThisQty(String(next.remaining ?? next.qty));
      })
      .catch((err: unknown) => setLoadError(errorText(err, "Could not load this work order.")));
  }, [id]);

  if (!order) {
    return loadError ? <ErrorBanner error={loadError} /> : <DetailSkeleton />;
  }

  const current = order;
  const remaining = current.remaining ?? Math.max(0, current.qty - (current.qtyCompleted ?? 0));
  const completable = canCompleteWorkOrder(current.status) && remaining > 0;
  const bayCode = (locationId: string) => (locations.data ?? []).find((row) => row.id === locationId)?.code;
  const sourceBay = bayCode(current.sourceLocationId);
  const outputBay = bayCode(current.outputLocationId);
  const asBuilt = current.asBuilt ?? [];
  const hasRecipe = Boolean(current.components?.length || current.steps?.length || current.imageUrl);

  async function start() {
    const next = await run(
      "Start",
      () => api<WorkOrder>(`/api/work-orders/${id}/start`, { method: "POST" }),
      `${current.number} started.`,
    );
    if (next) setOrder(next);
  }

  async function complete() {
    const qty = Number(thisQty);
    const next = await run(
      "Complete",
      () =>
        api<WorkOrder>(`/api/work-orders/${id}/complete`, {
          method: "POST",
          body: JSON.stringify({ qty }),
        }),
      (done) => {
        const left = done.remaining ?? Math.max(0, done.qty - (done.qtyCompleted ?? 0));
        const built = `Built ${qty} ${current.sku}${outputBay ? ` into ${outputBay}` : ""}.`;
        return left > 0 ? `${built} ${left} left to build.` : `${built} ${current.number} is complete.`;
      },
    );
    if (next) {
      setOrder(next);
      setThisQty(String(next.remaining ?? 0));
    }
  }

  const primary: DocumentAction | null = completable
    ? { label: "Complete", icon: CheckCircle2, onSelect: complete, disabled: !(Number(thisQty) > 0) }
    : null;

  const menu: DocumentAction[] = [
    ...(current.status === "draft" ? [{ label: "Start", icon: Play, onSelect: start }] : []),
    { label: "Open on floor", icon: ScanLine, to: `/floor/assemble?id=${current.id}` },
    { label: "Recipe", icon: BookOpen, to: `/make/recipes?item=${current.itemId}` },
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Make"
        list={{ label: "Work orders", to: "/make/work-orders" }}
        title={current.number}
        description={`Build ${current.sku} · ${current.itemName}`}
        status={current.status}
        steps={WORK_ORDER_STEPS}
        refId={current.id}
        stampRules={STEP_RULES.workOrder}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Build</p>
                <ProgressRow label="Completed" done={current.qtyCompleted ?? 0} total={current.qty} />
                <DocumentFact label="Item">
                  <Link className="font-mono underline" to={`/stock/items/${current.itemId}`}>
                    {current.sku}
                  </Link>
                </DocumentFact>
                <DocumentFact label="Consume from">
                  <span className="font-mono">{sourceBay ?? "—"}</span>
                </DocumentFact>
                <DocumentFact label="Put away to">
                  <span className="font-mono">{outputBay ?? "—"}</span>
                </DocumentFact>
                <DocumentFact label="Created">
                  <RelativeTime at={current.createdAt} />
                </DocumentFact>
              </div>
            </Card>
          </DocumentRail>
        }
      >
        {completable ? (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 shadow-xs">
            <div className="w-36">
              <Field label="This complete">
                <Input type="number" min={1} max={remaining} value={thisQty} onChange={(e) => setThisQty(e.target.value)} />
              </Field>
            </div>
            <p className="max-w-md text-xs text-muted-foreground">
              {remaining} left to build. Complete consumes the recipe{sourceBay ? ` from ${sourceBay}` : ""} and puts finished{" "}
              {current.sku}
              {outputBay ? ` in ${outputBay}` : " in the output bay"}. A partial qty is fine.
            </p>
          </div>
        ) : null}
        <Tabs value={view} onValueChange={setView}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="recipe">Recipe</TabsTrigger>
            {asBuilt.length ? <TabsTrigger value="as-built">As-built ({asBuilt.length})</TabsTrigger> : null}
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="recipe">
            {hasRecipe ? (
              <Card>
                <KitRecipeCard
                  sku={current.sku}
                  itemName={current.itemName}
                  imageUrl={current.imageUrl}
                  components={current.components}
                  steps={current.steps}
                />
              </Card>
            ) : (
              <EmptyState
                icon={ListTree}
                title="No recipe for this SKU."
                body="Complete needs a recipe to know which components to consume."
                action={
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/make/recipes">Recipes</Link>
                  </Button>
                }
              />
            )}
          </TabsContent>
          {asBuilt.length ? (
            <TabsContent value="as-built">
              <AsBuiltList title={<Term id="as-built">As-built</Term>} empty="No component lots were recorded." rows={asBuilt} mode="from" />
            </TabsContent>
          ) : null}
          <TabsContent value="activity">
            <DocumentActivity refId={current.id} refreshKey={`${current.status}:${current.qtyCompleted ?? 0}`} />
          </TabsContent>
        </Tabs>
      </DocumentFrame>
    </div>
  );
}

