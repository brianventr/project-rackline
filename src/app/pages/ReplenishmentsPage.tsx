import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDownToLine, ArrowRight, Play, Plus, ScanLine, Zap } from "lucide-react";
import { api, type Item, type Location, type ReplenishSuggestion, type Replenishment } from "../api";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge } from "../components/ui";
import {
  ActionButton,
  DetailSkeleton,
  DocumentActivity,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink, ProgressCell, RelativeTime, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { STEP_RULES } from "@/domain/step-stamps";
import { REPLENISH_STEPS, canPostReplenishment, isOpenReplenishment } from "@/domain/status";
import { remainingToReplenish } from "@/domain/partial-replenish";
import { useWarehouse, inWarehouse } from "../warehouse";

export function ReplenishmentsPage() {
  const { id } = useParams();
  if (id) return <ReplenishmentDetail id={id} />;
  return <ReplenishmentList />;
}

function remainingOf(row: Replenishment): number {
  return row.remaining ?? remainingToReplenish(row.qty, row.qtyMoved ?? 0);
}

function slotLabel(location: Location): string {
  return `${location.code} ${location.slotRole && location.slotRole !== "none" ? `(${location.slotRole})` : ""}`;
}

const REPLENISH_TABS: TabDef<Replenishment>[] = [
  { id: "open", label: "Open", match: (row) => isOpenReplenishment(row.status) },
  { id: "posted", label: "Posted", match: (row) => row.status === "posted" },
  { id: "all", label: "All", match: () => true },
];

const REPLENISH_COLUMNS: DataColumn<Replenishment>[] = [
  {
    id: "number",
    header: "Replenishment",
    sortValue: (row) => row.number,
    cell: (row) => <DocLink to={`/stock/replenish/${row.id}`}>{row.number}</DocLink>,
  },
  {
    id: "item",
    header: "Item",
    sortValue: (row) => row.sku,
    csv: (row) => row.sku,
    cell: (row) => <SkuCell sku={row.sku} name={row.itemName} to={`/stock/items/${row.itemId}`} />,
  },
  {
    id: "move",
    header: "Move",
    sortValue: (row) => `${row.fromCode ?? ""} ${row.toCode ?? ""}`,
    csv: (row) => `${row.fromCode ?? ""} -> ${row.toCode ?? ""}`,
    cell: (row) => (
      <span className="inline-flex items-center gap-1.5 font-mono text-sm">
        {row.fromCode}
        <ArrowRight className="size-3.5 text-muted-foreground" />
        {row.toCode}
      </span>
    ),
  },
  {
    id: "moved",
    header: "Moved",
    sortValue: (row) => (row.qty ? (row.qtyMoved ?? 0) / row.qty : 0),
    csv: (row) => `${row.qtyMoved ?? 0}/${row.qty}`,
    cell: (row) => <ProgressCell done={row.qtyMoved ?? 0} total={row.qty} />,
  },
  {
    id: "created",
    header: "Created",
    sortValue: (row) => row.createdAt,
    csv: (row) => new Date(row.createdAt).toISOString(),
    cell: (row) => <RelativeTime at={row.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (row) => REPLENISH_STEPS.indexOf(row.status as (typeof REPLENISH_STEPS)[number]),
    csv: (row) => row.status,
    cell: (row) => <StatusBadge status={row.status} />,
  },
];

function ReplenishmentList() {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const replenishments = useApiQuery<Replenishment[]>("/api/replenishments");
  const suggestions = useApiQuery<ReplenishSuggestion[]>(
    `/api/replenishments/suggestions${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ""}`,
  );
  const [creating, setCreating] = useState(false);
  const { error, run } = useWrite();
  const rows = useMemo(() => inWarehouse(replenishments.data ?? [], warehouseId), [replenishments.data, warehouseId]);
  const suggested = suggestions.data ?? [];

  async function fromSuggestion(row: ReplenishSuggestion) {
    const created = await run(
      "Queue replenishment",
      () =>
        api<Replenishment>("/api/replenishments", {
          method: "POST",
          body: JSON.stringify({
            warehouseId: row.warehouseId,
            itemId: row.itemId,
            qty: row.qty,
            fromLocationId: row.fromLocationId,
            toLocationId: row.toLocationId,
          }),
        }),
      (doc) => `Queued ${doc.number}: ${row.qty} × ${row.sku} from ${row.fromCode} to ${row.toCode}.`,
    );
    if (created) navigate(`/stock/replenish/${created.id}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Stock"
        title="Replenish"
        description="Move remaining qty from bulk into a pick face when it drops below pick min. Distinct from dock putaway."
      />
      <ErrorBanner error={error ?? suggestions.error?.message ?? null} />
      {suggested.length ? (
        <Card>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-tone-warning" />
              <p className="text-sm font-medium">Suggested from pick min</p>
              <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {suggested.length}
              </span>
            </div>
            <ul className="divide-y">
              {suggested.map((row) => (
                <li
                  key={`${row.itemId}:${row.toLocationId}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span className="font-mono">{row.sku}</span> <span className="font-mono tabular-nums">×{row.qty}</span>{" "}
                      <span className="font-normal text-muted-foreground">from</span>{" "}
                      <span className="font-mono">{row.fromCode}</span>{" "}
                      <span className="font-normal text-muted-foreground">to</span>{" "}
                      <span className="font-mono">{row.toCode}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.itemName} · pick face {row.pickQty}/{row.pickMin}
                    </p>
                  </div>
                  <ActionButton
                    variant="outline"
                    action={{ label: "Queue", icon: ArrowDownToLine, onSelect: () => fromSuggestion(row) }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}
      <DataTable
        id="replenishments"
        data={rows}
        loading={replenishments.isLoading}
        error={replenishments.error?.message}
        columns={REPLENISH_COLUMNS}
        getRowId={(row) => row.id}
        rowHref={(row) => `/stock/replenish/${row.id}`}
        tabs={REPLENISH_TABS}
        defaultTab="open"
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search number, SKU, bay",
          text: (row) => [row.number, row.sku, row.itemName, row.fromCode, row.toCode].filter(Boolean).join(" "),
        }}
        exportName="replenishments"
        toolbar={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to="/floor/replenish">
                <ScanLine className="size-4" />
                Floor
              </Link>
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New replenishment
            </Button>
          </>
        }
        empty={
          <EmptyState
            icon={ArrowDownToLine}
            title="No replenishments yet."
            body="Queue one when a pick face runs low, or set pick min on an item and Rackline suggests them here."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New replenishment
              </Button>
            }
          />
        }
      />
      <NewReplenishmentSheet open={creating} onOpenChange={setCreating} suggestion={suggested[0]} />
    </div>
  );
}

function NewReplenishmentSheet({
  open,
  onOpenChange,
  suggestion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestion?: ReplenishSuggestion;
}) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const locations = useApiQuery<Location[]>(open ? "/api/locations" : null);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [seeded, setSeeded] = useState(false);
  const { error, setError, busy, run } = useWrite();

  useEffect(() => {
    if (open) setError(null);
  }, [open, setError]);

  // Prefill once, from the first suggestion when there is one, else bulk → pick.
  useEffect(() => {
    if (seeded || !open) return;
    if (suggestion) {
      setItemId(suggestion.itemId);
      setQty(String(suggestion.qty));
      setFromLocationId(suggestion.fromLocationId);
      setToLocationId(suggestion.toLocationId);
      setSeeded(true);
      return;
    }
    if (!items.data || !locations.data) return;
    if (items.data[0]) setItemId(items.data[0].id);
    const bulk = locations.data.find((row) => row.slotRole === "bulk") ?? locations.data[0];
    const pick = locations.data.find((row) => row.slotRole === "pick") ?? locations.data[1];
    if (bulk) setFromLocationId(bulk.id);
    if (pick) setToLocationId(pick.id);
    setSeeded(true);
  }, [open, seeded, suggestion, items.data, locations.data]);

  async function create() {
    const created = await run(
      "Create replenishment",
      () =>
        api<Replenishment>("/api/replenishments", {
          method: "POST",
          body: JSON.stringify({ warehouseId, itemId, qty: Number(qty), fromLocationId, toLocationId }),
        }),
      (doc) => `Replenishment ${doc.number} created.`,
    );
    if (!created) return;
    onOpenChange(false);
    navigate(`/stock/replenish/${created.id}`);
  }

  const locationOptions = (locations.data ?? []).map((location) => (
    <option key={location.id} value={location.id}>
      {slotLabel(location)}
    </option>
  ));

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New replenishment"
      description="Top up a pick face from bulk. The floor sees it in Replenish until it is posted."
      submitLabel="Create replenishment"
      onSubmit={create}
      busy={busy}
      error={error ?? items.error?.message ?? locations.error?.message ?? null}
    >
      <Field label="Item">
        <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          {(items.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.sku} — {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Qty">
        <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From bulk">
          <Select value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
            {locationOptions}
          </Select>
        </Field>
        <Field label="To pick face">
          <Select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
            {locationOptions}
          </Select>
        </Field>
      </div>
    </FormSheet>
  );
}

function ReplenishmentDetail({ id }: { id: string }) {
  const [doc, setDoc] = useState<Replenishment | null>(null);
  const [thisQty, setThisQty] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const { error, run } = useWrite();

  useEffect(() => {
    api<Replenishment>(`/api/replenishments/${id}`)
      .then((next) => {
        setDoc(next);
        setThisQty(String(remainingOf(next)));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id]);

  async function start() {
    const next = await run(
      "Start",
      () => api<Replenishment>(`/api/replenishments/${id}/start`, { method: "POST" }),
      "Replenishment started.",
    );
    if (next) setDoc(next);
  }

  async function post() {
    const qty = Number(thisQty);
    const next = await run(
      "Post",
      () =>
        api<Replenishment>(`/api/replenishments/${id}/post`, {
          method: "POST",
          body: JSON.stringify({ qty }),
        }),
      (row) => {
        const left = remainingOf(row);
        return `Moved ${qty} × ${row.sku} from ${row.fromCode} to ${row.toCode}.${left > 0 ? ` ${left} left to move.` : ""}`;
      },
    );
    if (next) {
      setDoc(next);
      setThisQty(String(remainingOf(next)));
    }
  }

  if (!doc) {
    return loadError ? <ErrorBanner error={loadError} /> : <DetailSkeleton />;
  }

  const remaining = remainingOf(doc);
  const postable = canPostReplenishment(doc.status) && remaining > 0;

  const postAction: DocumentAction = {
    label: "Post move",
    icon: ArrowDownToLine,
    onSelect: post,
  };
  const startAction: DocumentAction = { label: "Start", icon: Play, onSelect: start };

  let primary: DocumentAction | null = null;
  if (postable) primary = postAction;
  else if (doc.status === "draft") primary = startAction;

  const menu: DocumentAction[] = [
    { label: "Open on floor", icon: ScanLine, to: `/floor/replenish?id=${doc.id}` },
    ...(doc.status === "draft" && primary !== startAction ? [startAction] : []),
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Stock"
        list={{ label: "Replenish", to: "/stock/replenish" }}
        title={doc.number}
        description={`${doc.sku} · moved ${doc.qtyMoved ?? 0}/${doc.qty} from ${doc.fromCode} to ${doc.toCode}`}
        status={doc.status}
        steps={REPLENISH_STEPS}
        refId={doc.id}
        stampRules={STEP_RULES.replenishment}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Move</p>
                <DocumentFact label="Item">
                  <Link className="font-mono underline underline-offset-2" to={`/stock/items/${doc.itemId}`}>
                    {doc.sku}
                  </Link>
                </DocumentFact>
                <DocumentFact label="From">
                  <Link className="font-mono underline underline-offset-2" to={`/stock/locations/${doc.fromLocationId}`}>
                    {doc.fromCode}
                  </Link>
                </DocumentFact>
                <DocumentFact label="To">
                  <Link className="font-mono underline underline-offset-2" to={`/stock/locations/${doc.toLocationId}`}>
                    {doc.toCode}
                  </Link>
                </DocumentFact>
                <DocumentFact label="Moved">
                  <ProgressCell done={doc.qtyMoved ?? 0} total={doc.qty} className="justify-end" />
                </DocumentFact>
                <DocumentFact label="Created">
                  <RelativeTime at={doc.createdAt} />
                </DocumentFact>
                {doc.notes ? <p className="text-sm text-muted-foreground">{doc.notes}</p> : null}
              </div>
            </Card>
          </DocumentRail>
        }
      >
        {postable ? (
          <Card>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <SkuCell sku={doc.sku} name={doc.itemName} to={`/stock/items/${doc.itemId}`} />
                <span className="ml-auto inline-flex items-center gap-1.5 font-mono">
                  {doc.fromCode}
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  {doc.toCode}
                </span>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <Field label={`This move (remaining ${remaining})`}>
                    <Input type="number" min={1} max={remaining} value={thisQty} onChange={(e) => setThisQty(e.target.value)} />
                  </Field>
                </div>
                <p className="max-w-sm pb-1.5 text-xs text-muted-foreground">
                  Post less than the remaining qty to leave the rest open for another trip.
                </p>
              </div>
            </div>
          </Card>
        ) : null}
        <DocumentActivity refId={doc.id} refreshKey={`${doc.status}:${doc.qtyMoved ?? 0}`} />
      </DocumentFrame>
    </div>
  );
}
