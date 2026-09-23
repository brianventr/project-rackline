import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BookOpen, CheckCircle2, PackagePlus, Plus, ScanLine, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, type Item, type KitBuild, type Location } from "../api";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge } from "../components/ui";
import {
  DetailSkeleton,
  DocumentActivity,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, ProgressCell, RelativeTime, SkuCell, ProgressRow } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { AsBuiltList } from "../components/as-built";
import { KitRecipeCard } from "../components/kit-recipe";
import { apiMutate, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STEP_RULES } from "@/domain/step-stamps";
import { KIT_STEPS, canCompleteKit, canDekit } from "@/domain/status";
import { useWarehouse, inWarehouse } from "../warehouse";

export function KitsPage() {
  const { id } = useParams();
  if (id) return <KitDetail id={id} />;
  return <KitList />;
}

const KIT_TABS: TabDef<KitBuild>[] = [
  { id: "open", label: "Open", match: (kit) => canCompleteKit(kit.status) },
  { id: "draft", label: "Draft", match: (kit) => kit.status === "draft" },
  { id: "in_progress", label: "In progress", match: (kit) => kit.status === "in_progress" },
  { id: "completed", label: "Completed", match: (kit) => kit.status === "completed" },
  { id: "dekitted", label: "Dekitted", match: (kit) => kit.status === "dekitted" },
  { id: "all", label: "All", match: () => true },
];

const KIT_FACETS: FacetDef<KitBuild>[] = [{ id: "item", label: "Item", value: (kit) => kit.sku }];

const KIT_COLUMNS: DataColumn<KitBuild>[] = [
  {
    id: "number",
    header: "Kit",
    sortValue: (kit) => kit.number,
    cell: (kit) => <DocLink to={`/make/kits/${kit.id}`}>{kit.number}</DocLink>,
  },
  {
    id: "item",
    header: "Item",
    sortValue: (kit) => kit.sku,
    csv: (kit) => `${kit.sku} — ${kit.itemName}`,
    cell: (kit) => <SkuCell sku={kit.sku} name={kit.itemName} imageUrl={kit.imageUrl} />,
  },
  {
    id: "completed",
    header: "Completed",
    sortValue: (kit) => (kit.qty ? (kit.qtyCompleted ?? 0) / kit.qty : 0),
    csv: (kit) => `${kit.qtyCompleted ?? 0}/${kit.qty}`,
    cell: (kit) => <ProgressCell done={kit.qtyCompleted ?? 0} total={kit.qty} />,
  },
  {
    id: "qty",
    header: "Qty",
    align: "right",
    defaultHidden: true,
    sortValue: (kit) => kit.qty,
    cell: (kit) => <span className="font-mono">{kit.qty}</span>,
  },
  {
    id: "created",
    header: "Created",
    sortValue: (kit) => kit.createdAt,
    csv: (kit) => new Date(kit.createdAt).toISOString(),
    cell: (kit) => <RelativeTime at={kit.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (kit) => (kit.status === "dekitted" ? KIT_STEPS.length : KIT_STEPS.indexOf(kit.status as (typeof KIT_STEPS)[number])),
    csv: (kit) => kit.status,
    cell: (kit) => <StatusBadge status={kit.status} />,
  },
];

function KitList() {
  const { warehouseId } = useWarehouse();
  const kits = useApiQuery<KitBuild[]>("/api/kits");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => inWarehouse(kits.data ?? [], warehouseId), [kits.data, warehouseId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Make"
        title="Kits"
        description="Assemble a finished SKU from its recipe. Complete a partial qty; dekit a finished build."
      />
      <DataTable
        id="kits"
        data={rows}
        loading={kits.isLoading}
        error={kits.error?.message}
        columns={KIT_COLUMNS}
        getRowId={(kit) => kit.id}
        rowHref={(kit) => `/make/kits/${kit.id}`}
        tabs={KIT_TABS}
        defaultTab="open"
        facets={KIT_FACETS}
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search kit, SKU",
          text: (kit) => [kit.number, kit.sku, kit.itemName].filter(Boolean).join(" "),
        }}
        exportName="kits"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New kit
          </Button>
        }
        empty={
          <EmptyState
            icon={PackagePlus}
            title="No kits yet."
            body="Release a kit to assemble a finished SKU from its recipe at the bench."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setCreating(true)}>
                  New kit
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/make/recipes">Recipes</Link>
                </Button>
              </div>
            }
          />
        }
      />
      <NewKitSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function isBuildable(item: Item) {
  return item.type === "finished" || item.type === "wip";
}

function NewKitSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const locations = useApiQuery<Location[]>(open ? "/api/locations" : null);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [outputLocationId, setOutputLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parents = useMemo(() => (items.data ?? []).filter(isBuildable), [items.data]);
  const bays = locations.data ?? [];

  useEffect(() => {
    if (!itemId && parents[0]) setItemId(parents[0].id);
  }, [parents, itemId]);

  useEffect(() => {
    if (!bays.length) return;
    const storage = bays.find((location) => location.type === "storage") ?? bays[0];
    const pick = bays.find((location) => location.slotRole === "pick") ?? storage;
    if (!sourceLocationId && storage) setSourceLocationId(storage.id);
    if (!outputLocationId && pick) setOutputLocationId(pick.id);
  }, [bays, sourceLocationId, outputLocationId]);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const created = await apiMutate<KitBuild>("/api/kits", {
        body: JSON.stringify({ warehouseId, itemId, qty: Number(qty), sourceLocationId, outputLocationId }),
      });
      toast.success(`Kit ${created.number} released.`);
      onOpenChange(false);
      navigate(`/make/kits/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create kit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New kit"
      description="Pick a SKU with a recipe. Components come out of one bay and finished kits go into another."
      submitLabel="Release kit"
      onSubmit={create}
      busy={busy}
      error={error}
    >
      <Field label="Build item">
        <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select item</option>
          {parents.map((item) => (
            <option key={item.id} value={item.id}>
              {item.sku} — {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Quantity">
        <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label="Consume from">
        <Select value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)}>
          {bays.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code} — {location.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Put finished">
        <Select value={outputLocationId} onChange={(e) => setOutputLocationId(e.target.value)}>
          {bays.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code} — {location.name}
            </option>
          ))}
        </Select>
      </Field>
    </FormSheet>
  );
}

function KitDetail({ id }: { id: string }) {
  const [kit, setKit] = useState<KitBuild | null>(null);
  const [serials, setSerials] = useState("");
  const [thisQty, setThisQty] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState("recipe");
  const locations = useApiQuery<Location[]>("/api/locations");
  const { error, run } = useWrite();

  useEffect(() => {
    api<KitBuild>(`/api/kits/${id}`)
      .then((next) => {
        setKit(next);
        setThisQty(String(next.remaining ?? next.qty));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id]);

  if (!kit) {
    return loadError ? <ErrorBanner error={loadError} /> : <DetailSkeleton />;
  }

  const current = kit;
  const remaining = current.remaining ?? Math.max(0, current.qty - (current.qtyCompleted ?? 0));
  const completable = canCompleteKit(current.status) && remaining > 0;
  const bayCode = (locationId: string) => (locations.data ?? []).find((row) => row.id === locationId)?.code;
  const sourceBay = bayCode(current.sourceLocationId);
  const outputBay = bayCode(current.outputLocationId);
  const asBuilt = current.asBuilt ?? [];
  const hasRecipe = Boolean(current.components?.length || current.steps?.length || current.imageUrl);

  async function complete() {
    const qty = Number(thisQty);
    const next = await run(
      "Complete",
      () =>
        api<KitBuild>(`/api/kits/${id}/complete`, {
          method: "POST",
          body: JSON.stringify({ qty, serials: serials || undefined }),
        }),
      (done) => {
        const left = done.remaining ?? Math.max(0, done.qty - (done.qtyCompleted ?? 0));
        const built = `Built ${qty} ${current.sku}${outputBay ? ` into ${outputBay}` : ""}.`;
        return left > 0 ? `${built} ${left} left to build.` : `${built} ${current.number} is complete.`;
      },
    );
    if (next) {
      setKit(next);
      setThisQty(String(next.remaining ?? 0));
    }
  }

  async function dekit() {
    const next = await run(
      "Dekit",
      () => api<KitBuild>(`/api/kits/${id}/dekit`, { method: "POST" }),
      `${current.number} dekitted. Components are back${sourceBay ? ` in ${sourceBay}` : " in the source bay"}.`,
    );
    if (next) setKit(next);
  }

  const finished = current.qtyCompleted || current.qty;
  const primary: DocumentAction | null = completable
    ? { label: "Complete", icon: CheckCircle2, onSelect: complete, disabled: !(Number(thisQty) > 0) }
    : null;

  const menu: DocumentAction[] = [
    { label: "Open on floor", icon: ScanLine, to: `/floor/kit?id=${current.id}` },
    { label: "Recipe", icon: BookOpen, to: `/make/recipes?item=${current.itemId}` },
    ...(canDekit(current.status)
      ? [
          {
            label: "Dekit",
            icon: Undo2,
            tone: "danger" as const,
            onSelect: dekit,
            confirm: {
              title: `Dekit ${current.number}?`,
              body: `${finished} finished ${current.sku} leave${finished === 1 ? "s" : ""} ${outputBay ?? "the output bay"} and the components go back to ${sourceBay ?? "the source bay"}. A dekitted build cannot be completed again.`,
              confirmLabel: "Dekit",
              cancelLabel: "Keep build",
              tone: "danger" as const,
            },
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Make"
        list={{ label: "Kits", to: "/make/kits" }}
        title={current.number}
        description={`Kit ${current.sku} · ${current.itemName}`}
        status={current.status}
        steps={KIT_STEPS}
        refId={current.id}
        stampRules={STEP_RULES.kit}
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
                <DocumentFact label="Put finished">
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
            {current.trackSerial ? (
              <div className="min-w-48 flex-1">
                <Field label="Finished serials (optional — generated if blank)">
                  <Input value={serials} onChange={(e) => setSerials(e.target.value)} placeholder="LAMP-2001" />
                </Field>
              </div>
            ) : null}
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
                icon={BookOpen}
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
              <AsBuiltList title="As-built" empty="No component lots were recorded." rows={asBuilt} mode="from" />
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

