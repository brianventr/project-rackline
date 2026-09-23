import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, ArrowRightLeft, Play, Plus, ScanLine, Send } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { api, errorText, type Item, type Location, type Transfer } from "../api";
import { Button, EmptyState, ErrorBanner, Input, PageHeader, StatusBadge, Table, ToneBadge, summarizeLines } from "../components/ui";
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
import { DocLink, LineChips, Muted, ProgressCell, ProgressRow, RelativeTime, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { LinesField, SelectField, TextField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { Term } from "../components/term";
import { apiMutate, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { STEP_RULES } from "@/domain/step-stamps";
import { blankLine, linesSchema, optionalText, requiredChoice } from "@/domain/form-schemas";
import { TRANSFER_STEPS, canPostTransfer, isOpenTransfer } from "@/domain/status";
import { hasUnmoved } from "@/domain/partial-transfer";
import { useWarehouse, inWarehouse } from "../warehouse";
import { RailCard, countOf, runEach, unitCount } from "./ReceiptsPage";

/**
 * POST /api/transfers (`src/routes/floor.ts`): both bays are required and must differ; lines may
 * repeat a SKU (unlike receipts), so this uses `linesSchema`.
 */
const putawayFormSchema = z
  .object({
    fromLocationId: requiredChoice("Pick the bay to move from."),
    toLocationId: requiredChoice("Pick the bay to move to."),
    notes: optionalText,
    lines: linesSchema,
  })
  .superRefine((value, ctx) => {
    if (value.fromLocationId && value.fromLocationId === value.toLocationId) {
      ctx.addIssue({
        code: "custom",
        message: "Pick a different bay to move to.",
        path: ["toLocationId"],
        input: value.toLocationId,
      });
    }
  });

/** The list endpoint also returns createdAt; `toWarehouseName` is resolved on the client. */
type TransferRow = Transfer & { createdAt?: number; toWarehouseName: string | null };

export function TransfersPage() {
  const { id } = useParams();
  if (id) return <TransferDetail id={id} />;
  return <TransferList />;
}

function transferUnits(transfer: Transfer) {
  const lines = transfer.lines ?? [];
  return {
    expected: lines.reduce((sum, line) => sum + line.qty, 0),
    moved: lines.reduce((sum, line) => sum + (line.qtyMoved ?? 0), 0),
  };
}

const TRANSFER_TABS: TabDef<TransferRow>[] = [
  { id: "open", label: "Open", match: (transfer) => isOpenTransfer(transfer.status) },
  { id: "draft", label: "Draft", match: (transfer) => transfer.status === "draft" },
  { id: "in_progress", label: "In progress", match: (transfer) => transfer.status === "in_progress" },
  { id: "posted", label: "Posted", match: (transfer) => transfer.status === "posted" },
  { id: "all", label: "All", match: () => true },
];

const TRANSFER_FACETS: FacetDef<TransferRow>[] = [
  { id: "from", label: "From", value: (transfer) => transfer.fromCode ?? null },
  { id: "to", label: "To", value: (transfer) => transfer.toCode ?? null },
  { id: "destination", label: "Destination", value: (transfer) => transfer.toWarehouseName ?? "This warehouse" },
];

const TRANSFER_COLUMNS: DataColumn<TransferRow>[] = [
  {
    id: "number",
    header: "Putaway",
    sortValue: (transfer) => transfer.number,
    cell: (transfer) => (
      <span className="flex flex-col">
        <DocLink to={`/inbound/putaway/${transfer.id}`}>{transfer.number}</DocLink>
        {transfer.notes ? <span className="line-clamp-1 text-[11px] text-muted-foreground">{transfer.notes}</span> : null}
      </span>
    ),
  },
  {
    id: "route",
    header: "From → To",
    sortValue: (transfer) => `${transfer.fromCode ?? ""} ${transfer.toCode ?? ""}`,
    csv: (transfer) => `${transfer.fromCode ?? ""} -> ${transfer.toCode ?? ""}`,
    cell: (transfer) => (
      <span className="inline-flex items-center gap-1.5 font-mono text-[13px]">
        {transfer.fromCode ?? "—"}
        <ArrowRight className="size-3.5 text-muted-foreground" />
        {transfer.toCode ?? "—"}
      </span>
    ),
  },
  {
    id: "toWarehouse",
    header: "To warehouse",
    sortValue: (transfer) => transfer.toWarehouseName,
    cell: (transfer) =>
      transfer.toWarehouseName ? <ToneBadge tone="info">{transfer.toWarehouseName}</ToneBadge> : <Muted>—</Muted>,
  },
  {
    id: "lines",
    header: "Lines",
    csv: (transfer) => summarizeLines(transfer.lines),
    cell: (transfer) => <LineChips lines={transfer.lines} />,
  },
  {
    id: "moved",
    header: "Moved",
    sortValue: (transfer) => {
      const units = transferUnits(transfer);
      return units.expected ? units.moved / units.expected : 0;
    },
    csv: (transfer) => {
      const units = transferUnits(transfer);
      return `${units.moved}/${units.expected}`;
    },
    cell: (transfer) => {
      const units = transferUnits(transfer);
      return <ProgressCell done={units.moved} total={units.expected} />;
    },
  },
  {
    id: "created",
    header: "Created",
    sortValue: (transfer) => transfer.createdAt ?? null,
    csv: (transfer) => (transfer.createdAt ? new Date(transfer.createdAt).toISOString() : ""),
    cell: (transfer) => <RelativeTime at={transfer.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (transfer) => TRANSFER_STEPS.indexOf(transfer.status as (typeof TRANSFER_STEPS)[number]),
    csv: (transfer) => transfer.status,
    cell: (transfer) => <StatusBadge status={transfer.status} />,
  },
];

const TRANSFER_BULK: BulkAction<TransferRow>[] = [
  {
    label: "Start",
    icon: Play,
    when: (selected) => selected.every((transfer) => transfer.status === "draft"),
    run: (selected) =>
      runEach(selected, (transfer) => api(`/api/transfers/${transfer.id}/start`, { method: "POST" }), {
        done: (count) => `Started ${countOf(count, "putaway")}.`,
        failed: "could not start",
      }),
  },
];

/** Name of the destination warehouse when a move leaves this one; null when it stays. */
function destinationWarehouse(
  transfer: Transfer,
  locations: Location[],
  warehouseName: (id: string) => string,
): string | null {
  if (transfer.toWarehouseId) return warehouseName(transfer.toWarehouseId);
  const toLoc = locations.find((row) => row.id === transfer.toLocationId);
  if (toLoc && toLoc.warehouseId !== transfer.warehouseId) return toLoc.warehouseName || warehouseName(toLoc.warehouseId);
  return null;
}

function TransferList() {
  const { warehouseId, warehouses } = useWarehouse();
  const transfers = useApiQuery<Transfer[]>("/api/transfers");
  const locations = useApiQuery<Location[]>("/api/locations");
  const [creating, setCreating] = useState(false);

  const rows = useMemo<TransferRow[]>(() => {
    const warehouseName = (id: string) => warehouses.find((row) => row.id === id)?.name ?? id;
    return inWarehouse(transfers.data ?? [], warehouseId).map((transfer) => ({
      ...transfer,
      toWarehouseName: destinationWarehouse(transfer, locations.data ?? [], warehouseName),
    }));
  }, [transfers.data, locations.data, warehouseId, warehouses]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Inbound"
        title="Putaway"
        description="Documented bin-to-bin moves. Destination can be any warehouse. Scan-to-move lives on the floor."
      />
      <DataTable
        id="putaway"
        data={rows}
        loading={transfers.isLoading}
        error={transfers.error?.message}
        columns={TRANSFER_COLUMNS}
        getRowId={(transfer) => transfer.id}
        rowHref={(transfer) => `/inbound/putaway/${transfer.id}`}
        tabs={TRANSFER_TABS}
        defaultTab="open"
        facets={TRANSFER_FACETS}
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search putaway, bay, SKU",
          text: (transfer) =>
            [
              transfer.number,
              transfer.fromCode,
              transfer.toCode,
              transfer.toWarehouseName,
              transfer.notes,
              ...(transfer.lines ?? []).map((line) => line.sku),
            ]
              .filter(Boolean)
              .join(" "),
        }}
        bulkActions={TRANSFER_BULK}
        exportName="putaway"
        toolbar={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to="/floor/putaway">
                <ScanLine className="size-4" />
                Scan move
              </Link>
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New putaway
            </Button>
          </>
        }
        empty={
          <EmptyState
            icon={ArrowRightLeft}
            title="No putaway yet."
            body={
              <>
                A <Term id="putaway">putaway</Term> moves stock from one bay to another, in this warehouse or another one.
              </>
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setCreating(true)}>
                  New putaway
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/floor/putaway">Scan move</Link>
                </Button>
              </div>
            }
          />
        }
      />
      <NewPutawaySheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewPutawaySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId, warehouses } = useWarehouse();
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const locations = useApiQuery<Location[]>("/api/locations");
  const form = useZodForm(putawayFormSchema, { fromLocationId: "", toLocationId: "", notes: "", lines: [blankLine()] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allLocations = locations.data ?? [];
  const fromLocations = inWarehouse(allLocations, warehouseId);
  const warehouseName = (id: string) => warehouses.find((row) => row.id === id)?.name ?? id;

  // Same defaults as before: from the receiving dock of this warehouse, to the first bulk (or storage) bay.
  const { reset, getValues, setValue } = form;
  useEffect(() => {
    const all = locations.data;
    if (!all) return;
    const fromPool = inWarehouse(all, warehouseId);
    const recv = fromPool.find((location) => location.type === "receiving") ?? fromPool[0] ?? all[0];
    const bulk =
      all.find((location) => location.slotRole === "bulk") ?? all.find((location) => location.type === "storage") ?? all[1];
    if (recv) setValue("fromLocationId", recv.id);
    if (bulk) setValue("toLocationId", bulk.id);
  }, [locations.data, warehouseId, setValue]);

  // Keep what was typed between opens, but start each open without stale inline errors.
  useEffect(() => {
    if (open) reset(getValues(), { keepDefaultValues: true });
  }, [open, reset, getValues]);

  // The "different bay" message sits on To, so re-check To when From changes (once it has been
  // checked), or the message stays after From is fixed.
  const fromLocationId = form.watch("fromLocationId");
  const submitted = form.formState.isSubmitted;
  const submittedRef = useRef(submitted);
  submittedRef.current = submitted;
  const { trigger, getFieldState } = form;
  useEffect(() => {
    if (submittedRef.current || getFieldState("toLocationId").invalid) void trigger("toLocationId");
  }, [fromLocationId, trigger, getFieldState]);

  async function create(values: ZodFormOutput<typeof putawayFormSchema>) {
    setError(null);
    setBusy(true);
    try {
      // Same body as before: notes as typed, blank rows already dropped, qty already a number.
      const created = await apiMutate<Transfer>("/api/transfers", {
        body: JSON.stringify({
          warehouseId,
          fromLocationId: values.fromLocationId,
          toLocationId: values.toLocationId,
          notes: values.notes,
          lines: values.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
        }),
      });
      toast.success(`Putaway ${created.number} created.`);
      onOpenChange(false);
      navigate(`/inbound/putaway/${created.id}`);
    } catch (err) {
      setError(errorText(err, "Could not create the putaway."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New putaway"
      description="Move stock between bays. The destination can be in another warehouse."
      submitLabel="Create putaway"
      onSubmit={form.handleSubmit(create)}
      busy={busy}
      error={error}
      wide
    >
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <SelectField
          form={form}
          name="fromLocationId"
          label="From"
          options={fromLocations.map((location) => ({ value: location.id, label: `${location.code} — ${location.name}` }))}
        />
        <SelectField
          form={form}
          name="toLocationId"
          label="To (any warehouse)"
          options={allLocations.map((location) => ({
            value: location.id,
            label: `${location.warehouseName || warehouseName(location.warehouseId)} · ${location.code} — ${location.name}`,
          }))}
        />
      </div>
      <TextField form={form} name="notes" label="Notes" />
      <LinesField form={form} name="lines" items={items.data ?? []} />
    </FormSheet>
  );
}

function TransferDetail({ id }: { id: string }) {
  const { warehouses } = useWarehouse();
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [moveQtys, setMoveQtys] = useState<Record<string, string>>({});
  const { error, setError, run } = useWrite();

  function applyTransfer(next: Transfer) {
    setTransfer(next);
    setMoveQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.id, String(line.remaining ?? 0)])));
  }

  useEffect(() => {
    Promise.all([api<Transfer>(`/api/transfers/${id}`), api<Location[]>("/api/locations")])
      .then(([next, nextLocations]) => {
        applyTransfer(next);
        setLocations(nextLocations);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    const next = await run("Start", () => api<Transfer>(`/api/transfers/${id}/start`, { method: "POST" }), "Putaway started.");
    if (next) applyTransfer(next);
  }

  async function post() {
    const lines = (transfer?.lines ?? [])
      .map((line) => ({
        lineId: line.id,
        qty: Number(moveQtys[line.id] || 0),
      }))
      .filter((line) => line.qty > 0);
    const total = lines.reduce((sum, line) => sum + line.qty, 0);
    const to = transfer?.toCode;
    const next = await run(
      "Post",
      () => api<Transfer>(`/api/transfers/${id}/post`, { method: "POST", body: JSON.stringify({ lines }) }),
      `Moved ${unitCount(total)}${to ? ` to ${to}` : ""}.`,
    );
    if (next) applyTransfer(next);
  }

  if (!transfer) return error ? <ErrorBanner error={error} /> : <DetailSkeleton />;

  const lines = transfer.lines ?? [];
  const remaining = hasUnmoved(
    lines.map((line) => ({
      lineId: line.id,
      sku: line.sku,
      qtyExpected: line.qty,
      qtyMoved: line.qtyMoved ?? 0,
    })),
  );
  // Drafts take quantities too: Post move works in one click, Start is optional (in the menu).
  const capturing = canPostTransfer(transfer.status) && remaining;
  const thisMove = Object.values(moveQtys).some((value) => Number(value) > 0);
  const toLoc = locations.find((row) => row.id === transfer.toLocationId);
  const fromLoc = locations.find((row) => row.id === transfer.fromLocationId);
  const toWhId = transfer.toWarehouseId || (toLoc && toLoc.warehouseId !== transfer.warehouseId ? toLoc.warehouseId : null);
  const toWh = toWhId ? (warehouses.find((row) => row.id === toWhId)?.name ?? toLoc?.warehouseName ?? toWhId) : null;
  const units = transferUnits(transfer);

  const primary: DocumentAction | null = capturing
    ? { label: "Post move", icon: Send, onSelect: post, disabled: !thisMove }
    : null;

  const menu: DocumentAction[] = [
    ...(transfer.status === "draft" ? [{ label: "Start", icon: Play, onSelect: start }] : []),
    { label: "Open on floor", icon: ScanLine, to: `/floor/putaway?id=${transfer.id}` },
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Inbound"
        list={{ label: "Putaway", to: "/inbound/putaway" }}
        title={transfer.number}
        description={`${transfer.fromCode ?? transfer.fromLocationId} → ${transfer.toCode ?? transfer.toLocationId}${transfer.notes ? ` · ${transfer.notes}` : ""}`}
        status={transfer.status}
        steps={TRANSFER_STEPS}
        refId={transfer.id}
        stampRules={STEP_RULES.transfer}
        meta={toWh ? <ToneBadge tone="info">To {toWh}</ToneBadge> : null}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <RailCard>
              <ProgressRow label="Moved" done={units.moved} total={units.expected} />
              <DocumentFact label="From">
                <span className="font-mono">{transfer.fromCode ?? fromLoc?.code ?? "—"}</span>
              </DocumentFact>
              <DocumentFact label="To">
                <span className="font-mono">{transfer.toCode ?? toLoc?.code ?? "—"}</span>
              </DocumentFact>
              {toWh ? <DocumentFact label="To warehouse">{toWh}</DocumentFact> : null}
            </RailCard>
            <DocumentActivity
              refId={transfer.id}
              refreshKey={`${transfer.status}:${lines.map((line) => line.qtyMoved).join(",")}`}
            />
          </DocumentRail>
        }
      >
        <Table columns={["Item", "Expected", "Moved", ...(capturing ? ["This move"] : [])]}>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>
                <SkuCell sku={line.sku} name={line.itemName} to={`/stock/items/${line.itemId}`} />
              </td>
              <td className="font-mono tabular-nums">{line.qty}</td>
              <td>
                <ProgressCell done={line.qtyMoved ?? 0} total={line.qty} />
              </td>
              {capturing ? (
                <td>
                  {(line.remaining ?? 0) > 0 ? (
                    <Input
                      type="number"
                      min={0}
                      max={line.remaining}
                      className="w-20"
                      aria-label={`Move qty for ${line.sku}`}
                      value={moveQtys[line.id] ?? "0"}
                      onChange={(e) => setMoveQtys((current) => ({ ...current, [line.id]: e.target.value }))}
                    />
                  ) : (
                    <Muted>Done</Muted>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      </DocumentFrame>
    </div>
  );
}
