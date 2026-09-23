import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDownToLine, Inbox, Play, Plus, ScanLine, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorText, type Item, type Location, type Receipt } from "../api";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, Select, StatusBadge, Table, summarizeLines } from "../components/ui";
import { Button as IconButton } from "@/components/ui/button";
import { BayCombobox } from "../components/BayCombobox";
import {
  DetailSkeleton,
  DocumentActivity,
  DocumentFact,
  DocumentFrame,
  DocumentHeader,
  DocumentRail,
  type DocumentAction,
} from "../components/document";
import { DataTable, type BulkAction, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink, LineChips, Muted, ProgressCell, ProgressRow, RelativeTime, SkuCell } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { LinesField, TextField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { Term } from "../components/term";
import { apiMutate, refreshApi, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { STEP_RULES } from "@/domain/step-stamps";
import { blankLine, receiptFormSchema } from "@/domain/form-schemas";
import { RECEIPT_STEPS, canReceive, isOpenReceipt } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useWarehouse, inWarehouse } from "../warehouse";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../components/expiry-field";

type Line = { itemId: string; qty: string };

export function ReceiptsPage() {
  const { id } = useParams();
  if (id) return <ReceiptDetail id={id} />;
  return <ReceiptList />;
}

/* ------------------------------------------------------------------------------------------------
 * Small helpers shared by the inbound pages (Receipts, ASNs, Purchases, Putaway, Vendor returns, Yard).
 * ---------------------------------------------------------------------------------------------- */

/** `1 unit`, `4 units`. */
export function unitCount(count: number): string {
  return `${count} ${count === 1 ? "unit" : "units"}`;
}

/** `1 receipt`, `3 receipts`. */
export function countOf(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

/**
 * Bulk action body: run one write per selected row, refresh, then toast how many went through
 * and the first failure reason.
 */
export async function runEach<T>(
  rows: T[],
  write: (row: T) => Promise<unknown>,
  messages: { done: (count: number) => string; failed: string },
) {
  const results = await Promise.allSettled(rows.map((row) => write(row)));
  void refreshApi();
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (errors.length) {
    // The count leads; the server's own sentence (and its fix) goes underneath, unwrapped.
    toast.error(`${errors.length} ${messages.failed}.`, {
      description: errorText(errors[0]!.reason, "Something went wrong. Try again."),
    });
  }
  const ok = rows.length - errors.length;
  if (ok) toast.success(messages.done(ok));
}

/** Rail card: optional title, then spaced rows (units, facts, fields). */
export function RailCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      {children}
    </Card>
  );
}

/** The bar above a lines table that holds the one bay choice for the write (Receive into, Ship from). */
export function LinesBar({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 shadow-xs">
      <div className="min-w-48 flex-1">{children}</div>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * List
 * ---------------------------------------------------------------------------------------------- */

function receiptUnits(receipt: Receipt) {
  const lines = receipt.lines ?? [];
  return {
    expected: lines.reduce((sum, line) => sum + line.qty, 0),
    received: lines.reduce((sum, line) => sum + (line.qtyReceived ?? 0), 0),
  };
}

const RECEIPT_TABS: TabDef<Receipt>[] = [
  { id: "open", label: "Open", match: (receipt) => isOpenReceipt(receipt.status) },
  { id: "draft", label: "Draft", match: (receipt) => receipt.status === "draft" },
  { id: "receiving", label: "Receiving", match: (receipt) => receipt.status === "receiving" },
  { id: "received", label: "Received", match: (receipt) => receipt.status === "received" },
  { id: "all", label: "All", match: () => true },
];

const RECEIPT_COLUMNS: DataColumn<Receipt>[] = [
  {
    id: "number",
    header: "Receipt",
    sortValue: (receipt) => receipt.number,
    cell: (receipt) => <DocLink to={`/inbound/receipts/${receipt.id}`}>{receipt.number}</DocLink>,
  },
  {
    id: "notes",
    header: "Reference",
    sortValue: (receipt) => receipt.notes,
    cell: (receipt) => (receipt.notes ? <span className="line-clamp-1">{receipt.notes}</span> : <Muted>—</Muted>),
  },
  {
    id: "lines",
    header: "Lines",
    csv: (receipt) => summarizeLines(receipt.lines),
    cell: (receipt) => <LineChips lines={receipt.lines} />,
  },
  {
    id: "received",
    header: "Received",
    sortValue: (receipt) => {
      const units = receiptUnits(receipt);
      return units.expected ? units.received / units.expected : 0;
    },
    csv: (receipt) => {
      const units = receiptUnits(receipt);
      return `${units.received}/${units.expected}`;
    },
    cell: (receipt) => {
      const units = receiptUnits(receipt);
      return <ProgressCell done={units.received} total={units.expected} />;
    },
  },
  {
    id: "created",
    header: "Created",
    sortValue: (receipt) => receipt.createdAt,
    csv: (receipt) => new Date(receipt.createdAt).toISOString(),
    cell: (receipt) => <RelativeTime at={receipt.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (receipt) => RECEIPT_STEPS.indexOf(receipt.status as (typeof RECEIPT_STEPS)[number]),
    csv: (receipt) => receipt.status,
    cell: (receipt) => <StatusBadge status={receipt.status} />,
  },
];

const RECEIPT_BULK: BulkAction<Receipt>[] = [
  {
    label: "Start receiving",
    icon: Play,
    when: (selected) => selected.every((receipt) => receipt.status === "draft"),
    run: (selected) =>
      runEach(selected, (receipt) => api(`/api/receipts/${receipt.id}/start`, { method: "POST" }), {
        done: (count) => `Started receiving on ${countOf(count, "receipt")}.`,
        failed: "could not start",
      }),
  },
];

function ReceiptList() {
  const { warehouseId } = useWarehouse();
  const receipts = useApiQuery<Receipt[]>("/api/receipts");
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => inWarehouse(receipts.data ?? [], warehouseId), [receipts.data, warehouseId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Inbound"
        title="Receipts"
        description={
          <>
            Create the inbound document here. Receive it on the <Term id="dock">dock</Term>, including partials.
          </>
        }
      />
      <DataTable
        id="receipts"
        data={rows}
        loading={receipts.isLoading}
        error={receipts.error?.message}
        columns={RECEIPT_COLUMNS}
        getRowId={(receipt) => receipt.id}
        rowHref={(receipt) => `/inbound/receipts/${receipt.id}`}
        tabs={RECEIPT_TABS}
        defaultTab="open"
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search receipt, reference, SKU",
          text: (receipt) => [receipt.number, receipt.notes, ...(receipt.lines ?? []).map((line) => line.sku)].filter(Boolean).join(" "),
        }}
        bulkActions={RECEIPT_BULK}
        exportName="receipts"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New receipt
          </Button>
        }
        empty={
          <EmptyState
            icon={Inbox}
            title="No receipts yet."
            body={
              <>
                A <Term id="receipt">receipt</Term> lists the stock you expect at the dock, ready to receive here or on the floor.
              </>
            }
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New receipt
              </Button>
            }
          />
        }
      />
      <NewReceiptSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewReceiptSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const form = useZodForm(receiptFormSchema, { notes: "", lines: [blankLine()] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep what was typed between opens, but start each open without stale inline errors.
  const { reset, getValues } = form;
  useEffect(() => {
    if (open) reset(getValues(), { keepDefaultValues: true });
  }, [open, reset, getValues]);

  async function create(values: ZodFormOutput<typeof receiptFormSchema>) {
    setError(null);
    setBusy(true);
    try {
      // Same body as before: notes as typed, blank rows already dropped, qty already a number.
      const created = await apiMutate<Receipt>("/api/receipts", {
        body: JSON.stringify({
          warehouseId,
          notes: values.notes,
          lines: values.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
        }),
      });
      toast.success(`Receipt ${created.number} created.`);
      onOpenChange(false);
      navigate(`/inbound/receipts/${created.id}`);
    } catch (err) {
      setError(errorText(err, "Could not create the receipt."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New receipt"
      description="List what is coming in. Receive it once it is on the dock."
      submitLabel="Create receipt"
      onSubmit={form.handleSubmit(create)}
      busy={busy}
      error={error}
    >
      <TextField form={form} name="notes" label="Reference" placeholder="PO or vendor reference" autoFocus />
      <LinesField form={form} name="lines" items={items.data ?? []} />
    </FormSheet>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Record
 * ---------------------------------------------------------------------------------------------- */

function ReceiptDetail({ id }: { id: string }) {
  const { warehouseId } = useWarehouse();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const { error, setError, run } = useWrite();

  async function load() {
    const [next, nextLocations] = await Promise.all([
      api<Receipt>(`/api/receipts/${id}`),
      api<Location[]>("/api/locations"),
    ]);
    setReceipt(next);
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(next.locationId || dock.id);
    setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  async function start() {
    const next = await run("Start receiving", () => api<Receipt>(`/api/receipts/${id}/start`, { method: "POST" }), "Receiving started.");
    if (next) setReceipt(next);
  }

  async function receive() {
    if (!receipt) return;
    const lines = (receipt.lines ?? [])
      .map((line) => ({
        itemId: line.itemId,
        qty: Number(qtys[line.itemId] || 0),
        lotCode: lots[line.itemId] || undefined,
        serials: serials[line.itemId] || undefined,
        weightGrams: parseWeightGrams(weights[line.itemId]),
        expiresOn: parseExpiryInput(expiries[line.itemId]),
      }))
      .filter((line) => line.qty > 0);
    const total = lines.reduce((sum, line) => sum + line.qty, 0);
    const bay = locations.find((row) => row.id === locationId)?.code;
    const next = await run(
      "Receive",
      () =>
        api<Receipt>(`/api/receipts/${id}/receive`, {
          method: "POST",
          body: JSON.stringify({ locationId, lines }),
        }),
      `Received ${unitCount(total)}${bay ? ` into ${bay}` : ""}.`,
    );
    if (next) {
      setReceipt(next);
      setQtys(Object.fromEntries((next.lines ?? []).map((line) => [line.itemId, String(line.remaining)])));
    }
  }

  if (!receipt) return error ? <ErrorBanner error={error} /> : <DetailSkeleton />;

  const lines = receipt.lines ?? [];
  const remaining = hasRemaining(
    lines.map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qty,
      qtyReceived: line.qtyReceived,
    })),
  );
  // Drafts take quantities too: Receive works in one click, Start receiving is optional (in the menu).
  const capturing = canReceive(receipt.status) && remaining;
  const thisReceive = Object.values(qtys).some((value) => Number(value) > 0);
  const tracksAnything = lines.some((line) => line.trackLot || line.trackSerial || line.catchWeight || line.trackExpiry);
  const units = receiptUnits(receipt);
  const dock = locations.find((row) => row.id === (receipt.locationId || locationId));

  const primary: DocumentAction | null = capturing
    ? { label: "Receive", icon: ArrowDownToLine, onSelect: receive, disabled: !thisReceive }
    : null;

  const menu: DocumentAction[] = [
    ...(receipt.status === "draft" ? [{ label: "Start receiving", icon: Play, onSelect: start }] : []),
    ...(capturing ? [{ label: "Open on floor", icon: ScanLine, to: `/floor/receive?id=${receipt.id}` }] : []),
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Inbound"
        list={{ label: "Receipts", to: "/inbound/receipts" }}
        title={receipt.number}
        description={receipt.notes || "Inbound receipt"}
        status={receipt.status}
        steps={RECEIPT_STEPS}
        refId={receipt.id}
        stampRules={STEP_RULES.receipt}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <RailCard>
              <ProgressRow label="Received" done={units.received} total={units.expected} />
              <DocumentFact label="Lines">{lines.length}</DocumentFact>
              {!capturing && dock ? (
                <DocumentFact label="Dock">
                  <span className="font-mono">{dock.code}</span>
                </DocumentFact>
              ) : null}
              <DocumentFact label="Created">
                <RelativeTime at={receipt.createdAt} />
              </DocumentFact>
            </RailCard>
            <DocumentActivity
              refId={receipt.id}
              refreshKey={`${receipt.status}:${lines.map((line) => line.qtyReceived).join(",")}`}
            />
          </DocumentRail>
        }
      >
        {capturing ? (
          <LinesBar hint="Defaults to the receiving dock. Type a bay code to find another, or add one.">
            <Field label="Receive into">
              <BayCombobox
                locations={locations}
                warehouseId={receipt.warehouseId || warehouseId}
                value={locationId}
                onChange={setLocationId}
                onCreated={(location) => setLocations((current) => [...current, location])}
              />
            </Field>
          </LinesBar>
        ) : null}
        <Table
          columns={[
            "Item",
            "Expected",
            "Received",
            ...(capturing ? ["This receive"] : []),
            ...(capturing && tracksAnything ? ["Lot / serial"] : []),
          ]}
        >
          {lines.map((line) => (
            <tr key={line.id}>
              <td>
                <SkuCell sku={line.sku} name={line.itemName} imageUrl={line.imageUrl} to={`/stock/items/${line.itemId}`} />
              </td>
              <td className="font-mono tabular-nums">{line.qty}</td>
              <td>
                <ProgressCell done={line.qtyReceived} total={line.qty} />
              </td>
              {capturing ? (
                <td>
                  {line.remaining > 0 ? (
                    <Input
                      type="number"
                      min={0}
                      max={line.remaining}
                      className="w-20"
                      aria-label={`Receive qty for ${line.sku}`}
                      value={qtys[line.itemId] ?? "0"}
                      onChange={(e) => setQtys((current) => ({ ...current, [line.itemId]: e.target.value }))}
                    />
                  ) : (
                    <Muted>Done</Muted>
                  )}
                </td>
              ) : null}
              {capturing && tracksAnything ? (
                <td className="space-y-1">
                  {line.remaining > 0 ? (
                    <>
                      {line.trackLot ? (
                        <Input
                          placeholder="Lot"
                          aria-label={`Lot for ${line.sku}`}
                          value={lots[line.itemId] ?? ""}
                          onChange={(e) => setLots((current) => ({ ...current, [line.itemId]: e.target.value }))}
                        />
                      ) : null}
                      {line.trackSerial ? (
                        <Input
                          placeholder="Serials"
                          aria-label={`Serials for ${line.sku}`}
                          value={serials[line.itemId] ?? ""}
                          onChange={(e) => setSerials((current) => ({ ...current, [line.itemId]: e.target.value }))}
                        />
                      ) : null}
                      <CatchWeightInput
                        show={line.catchWeight}
                        value={weights[line.itemId] ?? ""}
                        onChange={(value) => setWeights((current) => ({ ...current, [line.itemId]: value }))}
                      />
                      <ExpiryInput
                        show={line.trackExpiry}
                        value={expiries[line.itemId] ?? ""}
                        onChange={(value) => setExpiries((current) => ({ ...current, [line.itemId]: value }))}
                      />
                    </>
                  ) : (
                    <Muted>—</Muted>
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

/* ------------------------------------------------------------------------------------------------
 * Line editor for create sheets (also used by Orders, ASNs, Purchases, Putaway, Returns, RTVs).
 * ---------------------------------------------------------------------------------------------- */

export function LineFields({
  items,
  lines,
  setLines,
}: {
  items: Item[];
  lines: Line[];
  setLines: (updater: (current: Line[]) => Line[]) => void;
}) {
  const update = (index: number, patch: Partial<Line>) =>
    setLines((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_1.75rem] gap-2 text-xs text-muted-foreground">
        <span>SKU</span>
        <span>Qty</span>
        <span />
      </div>
      {lines.map((line, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_5rem_1.75rem] items-center gap-2">
          <Select aria-label={`Line ${index + 1} SKU`} value={line.itemId} onChange={(e) => update(index, { itemId: e.target.value })}>
            <option value="">Select SKU</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sku} — {item.name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={1}
            aria-label={`Line ${index + 1} qty`}
            value={line.qty}
            onChange={(e) => update(index, { qty: e.target.value })}
          />
          <IconButton
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove line ${index + 1}`}
            disabled={lines.length === 1}
            onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
          >
            <X />
          </IconButton>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => setLines((current) => [...current, { itemId: "", qty: "1" }])}>
        <Plus className="size-4" />
        Add line
      </Button>
    </div>
  );
}
