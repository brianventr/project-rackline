import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { Calculator, ClipboardCheck, Play, Plus, ScanLine } from "lucide-react";
import { api, errorText, type CycleCount, type Item, type Location } from "../api";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table } from "../components/ui";
import { SelectField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { Term } from "../components/term";
import {
  DetailSkeleton,
  DocumentActivity,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink, Muted, ProgressCell, RelativeTime, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { cn } from "@/lib/utils";
import { COUNT_STEPS, canPostCount, isOpenCount } from "@/domain/status";
import { requiredChoice } from "@/domain/form-schemas";
import { allLinesEntered, countVariance, formatCountVariance, isBlindCount, isCountEntered } from "@/domain/blind-count";
import { useWarehouse, inWarehouse } from "../warehouse";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";

/** The list endpoint also sends when the count was made; the shared type does not list it yet. */
type CountRow = CycleCount & { createdAt?: number | null };

export function CycleCountsPage() {
  const { id } = useParams();
  if (id) return <CountDetail id={id} />;
  return <CountList />;
}

const COUNT_TABS: TabDef<CountRow>[] = [
  { id: "open", label: "Open", match: (count) => isOpenCount(count.status) },
  { id: "posted", label: "Posted", match: (count) => count.status === "posted" },
  { id: "all", label: "All", match: () => true },
];

const COUNT_COLUMNS: DataColumn<CountRow>[] = [
  {
    id: "number",
    header: "Count",
    sortValue: (count) => count.number,
    cell: (count) => <DocLink to={`/stock/counts/${count.id}`}>{count.number}</DocLink>,
  },
  {
    id: "location",
    header: "Location",
    sortValue: (count) => count.locationCode ?? null,
    cell: (count) =>
      count.locationCode ? (
        <DocLink to={`/stock/locations/${count.locationId}`} className="font-normal">
          {count.locationCode}
        </DocLink>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "notes",
    header: "Notes",
    defaultHidden: true,
    sortValue: (count) => count.notes ?? null,
    cell: (count) => (count.notes ? <span className="text-muted-foreground">{count.notes}</span> : <Muted>—</Muted>),
  },
  {
    id: "created",
    header: "Created",
    sortValue: (count) => count.createdAt ?? null,
    csv: (count) => (count.createdAt ? new Date(count.createdAt).toISOString() : ""),
    cell: (count) => <RelativeTime at={count.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (count) => COUNT_STEPS.indexOf(count.status as (typeof COUNT_STEPS)[number]),
    csv: (count) => count.status,
    cell: (count) => <StatusBadge status={count.status} />,
  },
];

function CountList() {
  const { warehouseId } = useWarehouse();
  const counts = useApiQuery<CountRow[]>("/api/cycle-counts");
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => inWarehouse(counts.data ?? [], warehouseId), [counts.data, warehouseId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Stock"
        title="Cycle counts"
        description={
          <>
            <Term id="blind-count">Blind-count</Term> a bay, then post. Scan or add a SKU that was not on the snapshot. System
            qty and <Term id="variance">variance</Term> stay hidden until the count is posted.
          </>
        }
      />
      <DataTable
        id="cycle-counts"
        data={rows}
        loading={counts.isLoading}
        error={counts.error?.message}
        columns={COUNT_COLUMNS}
        getRowId={(count) => count.id}
        rowHref={(count) => `/stock/counts/${count.id}`}
        tabs={COUNT_TABS}
        defaultTab="open"
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search count, bay",
          text: (count) => [count.number, count.locationCode, count.notes].filter(Boolean).join(" "),
        }}
        exportName="cycle-counts"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Start count
          </Button>
        }
        empty={
          <EmptyState
            icon={Calculator}
            title="No counts yet."
            body={
              <>
                Count a bay to check the system against the shelf. Variances post to the ledger as{" "}
                <Term id="adjustment">adjustments</Term>.
              </>
            }
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                Start count
              </Button>
            }
          />
        }
      />
      <NewCountSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** POST /api/cycle-counts (`src/routes/floor.ts`): the bay to count. The warehouse comes from the top bar. */
const newCountSchema = z.object({
  locationId: requiredChoice("Pick a bay to count."),
});

function NewCountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const locations = useApiQuery<Location[]>(open ? "/api/locations" : null);
  const form = useZodForm(newCountSchema, { locationId: "" });
  const { error, setError, busy, run } = useWrite();

  // Keep the last choice between opens, but start each open without stale inline errors.
  const { reset, getValues, setValue } = form;
  useEffect(() => {
    if (!open) return;
    setError(null);
    reset(getValues(), { keepDefaultValues: true });
  }, [open, setError, reset, getValues]);

  // Preselect the first storage bay (else the first bay) once the list loads, as before.
  useEffect(() => {
    const list = locations.data ?? [];
    const locationId = getValues("locationId");
    if (locationId && list.some((location) => location.id === locationId)) return;
    const storage = list.find((location) => location.type === "storage") ?? list[0];
    if (storage) setValue("locationId", storage.id);
  }, [locations.data, getValues, setValue]);

  async function start(values: ZodFormOutput<typeof newCountSchema>) {
    const created = await run(
      "Start count",
      () =>
        api<CycleCount>("/api/cycle-counts", {
          method: "POST",
          body: JSON.stringify({ warehouseId, locationId: values.locationId }),
        }),
      (count) => `Count ${count.number} started. The bay is snapshotted blind.`,
    );
    if (!created) return;
    onOpenChange(false);
    navigate(`/stock/counts/${created.id}`);
  }

  const options = (locations.data ?? []).map((location) => ({
    value: location.id,
    label: `${location.code} — ${location.name}`,
  }));

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Start count"
      description="Snapshots what the system thinks is in the bay. Counters see SKUs, not quantities."
      submitLabel="Start count"
      onSubmit={form.handleSubmit(start)}
      busy={busy}
      error={error ?? locations.error?.message ?? null}
    >
      <SelectField
        form={form}
        name="locationId"
        label="Location"
        options={options}
        placeholder={options.length ? undefined : locations.isLoading ? "Loading bays…" : "No bays yet"}
      />
    </FormSheet>
  );
}

function CountDetail({ id }: { id: string }) {
  const [active, setActive] = useState<CycleCount | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [foundItemId, setFoundItemId] = useState("");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const { error, run } = useWrite();

  useEffect(() => {
    Promise.all([api<CycleCount>(`/api/cycle-counts/${id}`), api<Item[]>("/api/items")])
      .then(([count, nextItems]) => {
        setActive(count);
        setItems(nextItems);
      })
      .catch((err: unknown) => setLoadError(errorText(err, "Could not load this count. Try again.")));
  }, [id]);

  async function start() {
    const next = await run(
      "Start counting",
      () => api<CycleCount>(`/api/cycle-counts/${id}/start`, { method: "POST" }),
      "Counting started.",
    );
    if (next) setActive(next);
  }

  async function post() {
    if (!active) return;
    const next = await run(
      "Post count",
      () =>
        api<CycleCount>(`/api/cycle-counts/${id}/post`, {
          method: "POST",
          body: JSON.stringify({
            lines: (active.lines ?? [])
              .filter((line) => line.entered)
              .map((line) => ({
                id: line.id,
                countedQty: line.countedQty,
                weightGrams: parseWeightGrams(weights[line.id]),
              })),
          }),
        }),
      (count) => {
        const changed = (count.lines ?? []).filter(
          (line) => line.systemQty !== null && countVariance(line.countedQty, line.systemQty) !== 0,
        ).length;
        return changed
          ? `Posted ${count.number}. ${changed} ${changed === 1 ? "SKU was" : "SKUs were"} adjusted to the count.`
          : `Posted ${count.number}. No variances.`;
      },
    );
    if (next) setActive(next);
  }

  async function addFound() {
    if (!foundItemId) return;
    const sku = items.find((item) => item.id === foundItemId)?.sku;
    const next = await run(
      "Add SKU",
      () =>
        api<CycleCount>(`/api/cycle-counts/${id}/lines`, {
          method: "POST",
          body: JSON.stringify({ itemId: foundItemId }),
        }),
      `Added ${sku ?? "SKU"} to the count.`,
    );
    if (next) {
      setActive(next);
      setFoundItemId("");
    }
  }

  if (!active) {
    return loadError ? <ErrorBanner error={loadError} /> : <DetailSkeleton />;
  }

  const lines = active.lines ?? [];
  const blind = isBlindCount(active.status);
  const editable = canPostCount(active.status);
  const ready = editable && allLinesEntered(lines);
  const entered = lines.filter((line) => isCountEntered(line.entered)).length;
  const hasWeights = lines.some((line) => line.catchWeight);
  const bay = active.locationCode || "this bay";
  const available = items.filter((item) => !lines.some((line) => line.itemId === item.id));

  const postAction: DocumentAction = {
    label: lines.length === 0 ? "Confirm empty" : "Post variances",
    icon: ClipboardCheck,
    onSelect: post,
    disabled: !ready,
    confirm: {
      title: `Post ${active.number}?`,
      body:
        lines.length === 0
          ? `This records ${bay} as counted empty. A posted count cannot be reopened.`
          : `On hand in ${bay} is set to what you counted. Any difference posts to the ledger as an adjustment. A posted count cannot be reopened.`,
      confirmLabel: lines.length === 0 ? "Confirm empty" : "Post count",
      cancelLabel: "Keep counting",
    },
  };
  const startAction: DocumentAction = { label: "Start counting", icon: Play, onSelect: start };

  let primary: DocumentAction | null = null;
  if (ready) primary = postAction;
  else if (active.status === "draft") primary = startAction;
  else if (editable) primary = postAction;

  const menu: DocumentAction[] = [
    { label: "Open on floor", icon: ScanLine, to: `/floor/count?id=${active.id}` },
    ...(active.status === "draft" && primary !== startAction ? [startAction] : []),
    ...(editable && primary !== postAction ? [postAction] : []),
  ];

  const lineColumns = [
    "SKU",
    ...(blind ? [] : ["System"]),
    "Counted",
    ...(hasWeights ? ["Weight"] : []),
    ...(blind ? [] : ["Variance"]),
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Stock"
        list={{ label: "Cycle counts", to: "/stock/counts" }}
        title={active.number}
        description={
          blind ? `${active.locationCode || "Bay count"} · Blind — enter every SKU` : active.locationCode || "Bay count"
        }
        status={active.status}
        steps={COUNT_STEPS}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Count</p>
                <DocumentFact label="Location">
                  {active.locationCode ? (
                    <Link className="font-mono underline underline-offset-2" to={`/stock/locations/${active.locationId}`}>
                      {active.locationCode}
                    </Link>
                  ) : (
                    <Muted>—</Muted>
                  )}
                </DocumentFact>
                <DocumentFact label="Entered">
                  <ProgressCell done={entered} total={lines.length} className="justify-end" />
                </DocumentFact>
                {!blind ? (
                  <DocumentFact label="Variances">
                    <span className="font-mono tabular-nums">
                      {
                        lines.filter((line) => line.systemQty !== null && countVariance(line.countedQty, line.systemQty) !== 0)
                          .length
                      }
                    </span>
                  </DocumentFact>
                ) : null}
                {active.notes ? <p className="text-sm text-muted-foreground">{active.notes}</p> : null}
              </div>
            </Card>
          </DocumentRail>
        }
      >
        {editable ? (
          <form
            className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 shadow-xs"
            onSubmit={(event) => {
              event.preventDefault();
              void addFound();
            }}
          >
            <div className="min-w-56 flex-1">
              <Field label="Found SKU">
                <Select value={foundItemId} onChange={(e) => setFoundItemId(e.target.value)}>
                  <option value="">Choose a SKU not on the snapshot</option>
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={!foundItemId}>
              <Plus className="size-4" />
              Add found SKU
            </Button>
          </form>
        ) : null}
        {editable && !ready && lines.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Enter every SKU (0 is a real count) before posting. {entered} of {lines.length} entered.
          </p>
        ) : null}
        {lines.length === 0 ? (
          <EmptyState
            icon={Calculator}
            title="Nothing on the snapshot."
            body={editable ? "Confirm the bay is empty, or add a SKU you found." : "The bay was counted empty."}
          />
        ) : (
          <Table columns={lineColumns}>
            {lines.map((line) => {
              const variance = line.systemQty === null ? null : countVariance(line.countedQty, line.systemQty);
              return (
                <tr key={line.id}>
                  <td>
                    <SkuCell sku={line.sku} name={line.itemName} to={`/stock/items/${line.itemId}`} />
                  </td>
                  {blind ? null : <td className="font-mono tabular-nums">{line.systemQty === null ? "—" : line.systemQty}</td>}
                  <td>
                    {editable ? (
                      <Input
                        type="number"
                        min={0}
                        placeholder="Count"
                        className="w-24"
                        aria-label={`Counted qty for ${line.sku}`}
                        value={line.entered ? String(line.countedQty) : ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const countedQty = raw === "" ? 0 : Number(e.target.value);
                          setActive((current) =>
                            current
                              ? {
                                  ...current,
                                  lines: (current.lines ?? []).map((row) =>
                                    row.id === line.id
                                      ? { ...row, countedQty: Number.isFinite(countedQty) ? countedQty : 0, entered: raw !== "" }
                                      : row,
                                  ),
                                }
                              : current,
                          );
                        }}
                      />
                    ) : (
                      <span className="font-mono tabular-nums">{line.countedQty}</span>
                    )}
                  </td>
                  {hasWeights ? (
                    <td>
                      <CatchWeightInput
                        show={line.catchWeight}
                        value={weights[line.id] ?? (line.weightGrams != null ? String(line.weightGrams) : "")}
                        onChange={(value) => setWeights((current) => ({ ...current, [line.id]: value }))}
                      />
                    </td>
                  ) : null}
                  {blind ? null : (
                    <td
                      className={cn(
                        "font-mono tabular-nums",
                        variance != null && variance > 0 && "text-tone-success",
                        variance != null && variance < 0 && "text-tone-danger",
                      )}
                    >
                      {variance === null ? "—" : formatCountVariance(variance)}
                    </td>
                  )}
                </tr>
              );
            })}
          </Table>
        )}
        <DocumentActivity refId={active.id} refreshKey={active.status} />
      </DocumentFrame>
    </div>
  );
}
