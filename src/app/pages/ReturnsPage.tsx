import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDownToLine, Play, Plus, ScanLine, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorText, type Item, type Location, type Order, type Rma, type RmaLine } from "../api";
import { Button, Card, EmptyState, ErrorBanner, Field, Input, PageHeader, StatusBadge, Table, summarizeLines } from "../components/ui";
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
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink, LineChips, Muted, ProgressCell, RelativeTime, SkuCell, ProgressRow } from "../components/cells";
import { FormSheet } from "../components/form-sheet";
import { LinesField, SelectField, TextField, useZodForm, type ZodFormOutput } from "../components/form-kit";
import { Term } from "../components/term";
import { apiMutate, useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { cn } from "@/lib/utils";
import { STEP_RULES } from "@/domain/step-stamps";
import { RETURN_STEPS, canReceiveReturn } from "@/domain/status";
import { hasRemaining } from "@/domain/partial-receive";
import { useWarehouse, inWarehouse } from "../warehouse";
import { CatchWeightInput, parseWeightGrams } from "../components/catch-weight-field";
import { ExpiryInput, parseExpiryInput } from "../components/expiry-field";
import { DispositionSelect } from "../components/disposition-field";
import { dispositionLabel, parseDisposition, type ReturnDisposition } from "@/domain/return-disposition";
import { blankLine, returnFormSchema } from "@/domain/form-schemas";

export function ReturnsPage() {
  const { id } = useParams();
  if (id) return <ReturnDetail id={id} />;
  return <ReturnList />;
}

function rmaUnits(rma: Rma) {
  const lines = rma.lines ?? [];
  return {
    expected: lines.reduce((sum, line) => sum + line.qtyExpected, 0),
    received: lines.reduce((sum, line) => sum + line.qtyReceived, 0),
  };
}

const RETURN_TABS: TabDef<Rma>[] = [
  { id: "open", label: "To receive", match: (rma) => canReceiveReturn(rma.status) },
  { id: "received", label: "Received", match: (rma) => rma.status === "received" },
  { id: "all", label: "All", match: () => true },
];

const RETURN_COLUMNS: DataColumn<Rma>[] = [
  {
    id: "number",
    header: "Return",
    sortValue: (rma) => rma.number,
    cell: (rma) => <DocLink to={`/outbound/returns/${rma.id}`}>{rma.number}</DocLink>,
  },
  {
    id: "customer",
    header: "Customer",
    sortValue: (rma) => rma.customerName,
    cell: (rma) => (
      <span className="flex flex-col">
        <span className="font-medium">{rma.customerName}</span>
        {rma.notes ? <span className="line-clamp-1 text-xs text-muted-foreground">{rma.notes}</span> : null}
      </span>
    ),
  },
  {
    id: "order",
    header: "Order",
    sortValue: (rma) => rma.orderNumber ?? "",
    cell: (rma) =>
      rma.orderId ? (
        <DocLink to={`/outbound/orders/${rma.orderId}`} className="font-normal">
          {rma.orderNumber || "Order"}
        </DocLink>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "lines",
    header: "Lines",
    csv: (rma) =>
      summarizeLines((rma.lines ?? []).map((line) => ({ sku: line.sku, itemName: line.itemName, qty: line.qtyExpected }))),
    cell: (rma) => <LineChips lines={(rma.lines ?? []).map((line) => ({ sku: line.sku, qty: line.qtyExpected }))} />,
  },
  {
    id: "received",
    header: "Received",
    sortValue: (rma) => {
      const units = rmaUnits(rma);
      return units.expected ? units.received / units.expected : 0;
    },
    csv: (rma) => {
      const units = rmaUnits(rma);
      return `${units.received}/${units.expected}`;
    },
    cell: (rma) => {
      const units = rmaUnits(rma);
      return <ProgressCell done={units.received} total={units.expected} />;
    },
  },
  {
    id: "created",
    header: "Created",
    sortValue: (rma) => rma.createdAt,
    csv: (rma) => new Date(rma.createdAt).toISOString(),
    cell: (rma) => <RelativeTime at={rma.createdAt} />,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (rma) => RETURN_STEPS.indexOf(rma.status as (typeof RETURN_STEPS)[number]),
    csv: (rma) => rma.status,
    cell: (rma) => <StatusBadge status={rma.status} />,
  },
];

function ReturnList() {
  const { warehouseId } = useWarehouse();
  const returns = useApiQuery<Rma[]>("/api/returns");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => inWarehouse(returns.data ?? [], warehouseId), [returns.data, warehouseId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Outbound"
        title="Returns"
        description={
          <>
            Customer <Term id="rma">RMAs</Term>. Receive back into a bay as{" "}
            <Term id="disposition">restock, scrap, or hold</Term>.
          </>
        }
      />
      <DataTable
        id="returns"
        data={rows}
        loading={returns.isLoading}
        error={returns.error?.message}
        columns={RETURN_COLUMNS}
        getRowId={(rma) => rma.id}
        rowHref={(rma) => `/outbound/returns/${rma.id}`}
        tabs={RETURN_TABS}
        defaultTab="open"
        defaultSort={{ id: "created", desc: true }}
        search={{
          placeholder: "Search return, customer, order, SKU",
          text: (rma) =>
            [rma.number, rma.customerName, rma.orderNumber, rma.notes, ...(rma.lines ?? []).map((line) => line.sku)]
              .filter(Boolean)
              .join(" "),
        }}
        exportName="returns"
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New return
          </Button>
        }
        empty={
          <EmptyState
            icon={Undo2}
            title="No returns yet."
            body="Open an RMA when a customer sends goods back, then receive them as restock, scrap, or hold."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                New return
              </Button>
            }
          />
        }
      />
      <NewReturnSheet open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewReturnSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { warehouseId } = useWarehouse();
  const items = useApiQuery<Item[]>(open ? "/api/items" : null);
  const orders = useApiQuery<Order[]>(open ? "/api/orders" : null);
  const form = useZodForm(returnFormSchema, { customerName: "", orderId: "", notes: "", lines: [blankLine()] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep what was typed between opens, but start each open without stale inline errors.
  const { reset, getValues } = form;
  useEffect(() => {
    if (open) reset(getValues(), { keepDefaultValues: true });
  }, [open, reset, getValues]);

  async function create(values: ZodFormOutput<typeof returnFormSchema>) {
    setError(null);
    setBusy(true);
    try {
      // Same body as before: no order sends null, blank rows are already dropped, qty is a number.
      const created = await apiMutate<Rma>("/api/returns", {
        body: JSON.stringify({
          warehouseId,
          customerName: values.customerName,
          orderId: values.orderId || null,
          notes: values.notes,
          lines: values.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
        }),
      });
      toast.success(`Return ${created.number} opened.`);
      onOpenChange(false);
      navigate(`/outbound/returns/${created.id}`);
    } catch (err) {
      setError(errorText(err, "Could not create the return."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New return"
      description="What the customer is sending back. Receive it on the record when the box arrives."
      submitLabel="Create return"
      onSubmit={form.handleSubmit(create)}
      busy={busy}
      error={error}
    >
      <TextField form={form} name="customerName" label="Customer" autoFocus />
      <SelectField
        form={form}
        name="orderId"
        label="Original order"
        placeholder="None"
        options={inWarehouse(orders.data ?? [], warehouseId).map((order) => ({
          value: order.id,
          label: `${order.number} · ${order.customerName}`,
        }))}
      />
      <TextField form={form} name="notes" label="Notes" placeholder="Wrong color, damaged carton…" />
      <LinesField form={form} name="lines" items={items.data ?? []} />
    </FormSheet>
  );
}

function dispositionDefaults(rma: Rma): Record<string, ReturnDisposition> {
  return Object.fromEntries(
    (rma.lines ?? []).map((line) => {
      try {
        return [line.itemId, parseDisposition(line.disposition)];
      } catch {
        return [line.itemId, "restock" as const];
      }
    }),
  );
}

function qtyDefaults(rma: Rma): Record<string, string> {
  return Object.fromEntries((rma.lines ?? []).map((line) => [line.itemId, String(line.remaining)]));
}

function receivedMessage(lines: { qty: number; disposition: ReturnDisposition }[], bay: string | undefined): string {
  const total = lines.reduce((sum, line) => sum + line.qty, 0);
  const count = (kind: ReturnDisposition) =>
    lines.filter((line) => line.disposition === kind).reduce((sum, line) => sum + line.qty, 0);
  const parts = [
    count("restock") ? `${count("restock")} back in ${bay ?? "the bay"}` : null,
    count("hold") ? `${count("hold")} on QC hold` : null,
    count("scrap") ? `${count("scrap")} scrapped` : null,
  ].filter(Boolean);
  return `Received ${total} ${total === 1 ? "unit" : "units"}: ${parts.join(", ")}.`;
}

function ReturnDetail({ id }: { id: string }) {
  const { warehouseId } = useWarehouse();
  const [rma, setRma] = useState<Rma | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<Record<string, ReturnDisposition>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const { error, run } = useWrite();

  async function load() {
    const [next, nextLocations] = await Promise.all([api<Rma>(`/api/returns/${id}`), api<Location[]>("/api/locations")]);
    setRma(next);
    setLocations(nextLocations);
    const dock = nextLocations.find((row) => row.type === "receiving") ?? nextLocations[0];
    if (dock) setLocationId(next.locationId || dock.id);
    setQtys(qtyDefaults(next));
    setDispositions(dispositionDefaults(next));
  }

  useEffect(() => {
    load().catch((err: unknown) => setLoadError(errorText(err, "Could not load this return.")));
  }, [id]);

  if (!rma) {
    return loadError ? <ErrorBanner error={loadError} /> : <DetailSkeleton />;
  }

  const current = rma;
  const lines = current.lines ?? [];
  const remaining = hasRemaining(
    lines.map((line) => ({
      itemId: line.itemId,
      qtyExpected: line.qtyExpected,
      qtyReceived: line.qtyReceived,
    })),
  );
  const receivable = canReceiveReturn(current.status) && remaining;
  const bayCode = (locationIdToFind: string | null | undefined) =>
    locationIdToFind ? locations.find((row) => row.id === locationIdToFind)?.code : undefined;
  const thisReceive = lines.reduce((sum, line) => sum + (line.remaining > 0 ? Number(qtys[line.itemId] || 0) : 0), 0);
  const tracksAnything = lines.some(
    (line) => line.remaining > 0 && (line.trackSerial || line.catchWeight || line.trackExpiry),
  );
  const units = rmaUnits(current);

  async function start() {
    const next = await run(
      "Start receiving",
      () => api<Rma>(`/api/returns/${id}/start`, { method: "POST" }),
      `${current.number} is receiving.`,
    );
    if (next) setRma(next);
  }

  async function receive() {
    const received = lines
      .map((line) => ({
        itemId: line.itemId,
        qty: Number(qtys[line.itemId] || 0),
        serials: serials[line.itemId] || undefined,
        weightGrams: parseWeightGrams(weights[line.itemId]),
        expiresOn: parseExpiryInput(expiries[line.itemId]),
        disposition: dispositions[line.itemId] ?? "restock",
      }))
      .filter((line) => line.qty > 0);
    const bay = bayCode(locationId);
    const next = await run(
      "Receive",
      () =>
        api<Rma>(`/api/returns/${id}/receive`, {
          method: "POST",
          body: JSON.stringify({ locationId, lines: received }),
        }),
      () => receivedMessage(received, bay),
    );
    if (next) {
      setRma(next);
      setQtys(qtyDefaults(next));
      setDispositions(dispositionDefaults(next));
    }
  }

  const primary: DocumentAction | null = receivable
    ? { label: "Receive", icon: ArrowDownToLine, onSelect: receive, disabled: thisReceive <= 0 || !locationId }
    : null;

  const menu: DocumentAction[] = [
    ...(current.status === "open" ? [{ label: "Start receiving", icon: Play, onSelect: start }] : []),
    ...(receivable ? [{ label: "Open on floor", icon: ScanLine, to: `/floor/return?id=${current.id}` }] : []),
  ];

  const lineColumns = [
    "Item",
    "Expected",
    "Received",
    ...(receivable ? ["This receive"] : []),
    "Disposition",
    ...(receivable && tracksAnything ? ["Serial / weight / expiry"] : []),
  ];

  return (
    <div className="space-y-(--density-gap)">
      <DocumentHeader
        eyebrow="Outbound"
        list={{ label: "Returns", to: "/outbound/returns" }}
        title={current.number}
        description={`${current.customerName}${current.notes ? ` · ${current.notes}` : ""}`}
        status={current.status}
        steps={RETURN_STEPS}
        refId={current.id}
        stampRules={STEP_RULES.rma}
        primary={primary}
        menu={menu}
      />
      <ErrorBanner error={error} />
      <DocumentFrame
        rail={
          <DocumentRail>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Units</p>
                <ProgressRow label="Received" done={units.received} total={units.expected} />
              </div>
            </Card>
            <Card>
              <div className="space-y-3">
                <p className="text-sm font-medium">Return</p>
                <div className="text-sm">
                  <p className="font-medium">{current.customerName}</p>
                  {current.notes ? <p className="mt-1 text-muted-foreground">{current.notes}</p> : null}
                </div>
                <DocumentFact label="Original order">
                  {current.orderId ? (
                    <Link className="underline" to={`/outbound/orders/${current.orderId}`}>
                      {current.orderNumber || "Order"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">None linked</span>
                  )}
                </DocumentFact>
                {!receivable && current.locationId ? (
                  <DocumentFact label="Received into">
                    <span className="font-mono">{bayCode(current.locationId) ?? "—"}</span>
                  </DocumentFact>
                ) : null}
                <DocumentFact label="Created">
                  <RelativeTime at={current.createdAt} />
                </DocumentFact>
              </div>
            </Card>
          </DocumentRail>
        }
      >
        {receivable ? (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 shadow-xs">
            <div className="min-w-48 flex-1">
              <Field label="Receive into">
                <BayCombobox
                  locations={locations}
                  warehouseId={current.warehouseId || warehouseId}
                  value={locationId}
                  onChange={setLocationId}
                  onCreated={(location) => setLocations((rows) => [...rows, location])}
                />
              </Field>
            </div>
            <p className="max-w-sm text-xs text-muted-foreground">
              Restock puts units back in stock in this bay. Hold receives them under a QC hold. Scrap receives them and writes them off.
            </p>
          </div>
        ) : null}
        <Table columns={lineColumns}>
          {lines.map((line) => (
            <ReturnLineRow
              key={line.id}
              line={line}
              receivable={receivable}
              tracksAnything={tracksAnything}
              qty={qtys[line.itemId] ?? "0"}
              onQty={(value) => setQtys((rows) => ({ ...rows, [line.itemId]: value }))}
              disposition={dispositions[line.itemId] ?? "restock"}
              onDisposition={(value) => setDispositions((rows) => ({ ...rows, [line.itemId]: value }))}
              serial={serials[line.itemId] ?? ""}
              onSerial={(value) => setSerials((rows) => ({ ...rows, [line.itemId]: value }))}
              weight={weights[line.itemId] ?? ""}
              onWeight={(value) => setWeights((rows) => ({ ...rows, [line.itemId]: value }))}
              expiry={expiries[line.itemId] ?? ""}
              onExpiry={(value) => setExpiries((rows) => ({ ...rows, [line.itemId]: value }))}
            />
          ))}
        </Table>
        <DocumentActivity
          refId={current.id}
          refreshKey={`${current.status}:${lines.map((line) => line.qtyReceived).join(",")}`}
        />
      </DocumentFrame>
    </div>
  );
}

function ReturnLineRow({
  line,
  receivable,
  tracksAnything,
  qty,
  onQty,
  disposition,
  onDisposition,
  serial,
  onSerial,
  weight,
  onWeight,
  expiry,
  onExpiry,
}: {
  line: RmaLine;
  receivable: boolean;
  tracksAnything: boolean;
  qty: string;
  onQty: (value: string) => void;
  disposition: ReturnDisposition;
  onDisposition: (value: ReturnDisposition) => void;
  serial: string;
  onSerial: (value: string) => void;
  weight: string;
  onWeight: (value: string) => void;
  expiry: string;
  onExpiry: (value: string) => void;
}) {
  const open = receivable && line.remaining > 0;
  return (
    <tr>
      <td>
        <SkuCell sku={line.sku} name={line.itemName} to={`/stock/items/${line.itemId}`} />
      </td>
      <td className="font-mono tabular-nums">{line.qtyExpected}</td>
      <td>
        <ProgressCell done={line.qtyReceived} total={line.qtyExpected} />
      </td>
      {receivable ? (
        <td>
          {open ? (
            <Input
              type="number"
              min={0}
              max={line.remaining}
              className="w-20"
              aria-label={`Receive qty for ${line.sku}`}
              value={qty}
              onChange={(e) => onQty(e.target.value)}
            />
          ) : (
            <span className="text-muted-foreground">Done</span>
          )}
        </td>
      ) : null}
      <td>
        {open ? (
          <div className="w-32">
            <DispositionSelect value={disposition} onChange={onDisposition} />
          </div>
        ) : (
          <span className={cn(line.disposition === "scrap" && "text-tone-danger", line.disposition === "hold" && "text-tone-warning")}>
            {dispositionLabel(line.disposition || "restock")}
          </span>
        )}
      </td>
      {receivable && tracksAnything ? (
        <td className="space-y-1">
          {open && line.trackSerial ? (
            <Input placeholder="Serials" aria-label={`Serials for ${line.sku}`} value={serial} onChange={(e) => onSerial(e.target.value)} />
          ) : null}
          {open ? (
            <>
              <CatchWeightInput show={line.catchWeight} value={weight} onChange={onWeight} />
              <ExpiryInput show={line.trackExpiry} value={expiry} onChange={onExpiry} />
            </>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

