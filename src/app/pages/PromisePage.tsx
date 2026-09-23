import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Clock, PackageCheck, Truck, TriangleAlert, type LucideIcon } from "lucide-react";
import { api, errorText } from "../api";
import { Button, Card, EmptyState, ErrorBanner, Input, PageHeader, ToneBadge, toneClass } from "../components/ui";
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { DocLink } from "../components/cells";
import { TextField, useZodForm } from "../components/form-kit";
import { Term } from "../components/term";
import { useApiQuery } from "../query";
import { useWarehouse } from "../warehouse";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { qtySchema, skuSchema } from "@/domain/form-schemas";
import { statusText, type StatusTone } from "@/domain/status";
import {
  formatPickupLabel,
  nextPickup,
  type PromiseAsk,
  type PromiseBoard,
  type PromiseCode,
  type PromiseOrder,
} from "@/domain/promise";

/** Server cap in `parsePromiseQty` (src/domain/promise.ts). */
const MAX_ASK_QTY = 100_000;

/**
 * GET /api/analytics/promises/ask (`parsePromiseSku`, `parsePromiseQty`). Both fields stay text so the
 * query is built exactly as before: SKU trimmed, a blank qty asks for 1.
 */
const askFormSchema = z.object({
  sku: skuSchema,
  qty: z.string().superRefine((value, ctx) => {
    if (!value.trim()) return;
    const parsed = qtySchema.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: parsed.error.issues[0]?.message ?? "Qty must be 1 or more.", input: value });
    } else if (parsed.data > MAX_ASK_QTY) {
      ctx.addIssue({ code: "custom", message: "Qty can be 100,000 at most.", input: value });
    }
  }),
});
type AskFormValues = z.output<typeof askFormSchema>;

const CODE_LABEL: Record<PromiseCode, string> = {
  leaves_today: "This pickup",
  next_pickup: "Later pickup",
  inbound: "Inbound",
  short: "Can't promise",
};

const PROMISE_TABS: TabDef<PromiseOrder>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "leaves_today", label: "This pickup", match: (order) => order.code === "leaves_today" },
  { id: "next_pickup", label: "Later", match: (order) => order.code === "next_pickup" },
  { id: "inbound", label: "Inbound", match: (order) => order.code === "inbound" },
  { id: "short", label: "Can't promise", match: (order) => order.code === "short" },
];

const CODE_TONE: Record<PromiseCode, StatusTone> = {
  leaves_today: "success",
  next_pickup: "info",
  inbound: "progress",
  short: "danger",
};

const CODE_RANK: Record<PromiseCode, number> = { leaves_today: 0, next_pickup: 1, inbound: 2, short: 3 };

function PromiseBadge({ code }: { code: PromiseCode }) {
  return <ToneBadge tone={CODE_TONE[code]}>{CODE_LABEL[code]}</ToneBadge>;
}

function promiseColumns(timeZone: string): DataColumn<PromiseOrder>[] {
  return [
    {
      id: "number",
      header: "Order",
      sortValue: (order) => order.number,
      cell: (order) => (
        <span className="flex flex-col">
          <DocLink to={`/outbound/orders/${order.orderId}`}>{order.number}</DocLink>
          <span className="text-[11px] text-muted-foreground">{statusText(order.status)}</span>
        </span>
      ),
    },
    { id: "customer", header: "Customer", sortValue: (order) => order.customerName, cell: (order) => order.customerName },
    {
      id: "units",
      header: "Units",
      align: "right",
      sortValue: (order) => order.units,
      cell: (order) => (
        <span className="flex flex-col items-end">
          <span className="font-mono">{order.units}</span>
          {order.unitsAhead > 0 ? <span className="text-[11px] text-muted-foreground">behind {order.unitsAhead}</span> : null}
        </span>
      ),
    },
    {
      id: "leaves",
      header: "Leaves",
      sortValue: (order) => order.promisedAt ?? Number.MAX_SAFE_INTEGER,
      csv: (order) => (order.promisedAt != null ? formatPickupLabel(order.promisedAt, timeZone) : CODE_LABEL[order.code]),
      cell: (order) => (
        <span className="flex flex-col items-start gap-1">
          <PromiseBadge code={order.code} />
          <span className="text-[11px] text-muted-foreground">
            {order.promisedAt != null ? formatPickupLabel(order.promisedAt, timeZone) : "—"}
          </span>
          {order.split ? <span className="text-[11px] text-muted-foreground">Some lines could leave sooner.</span> : null}
        </span>
      ),
    },
    {
      id: "code",
      header: "Lane",
      defaultHidden: true,
      sortValue: (order) => CODE_RANK[order.code],
      csv: (order) => CODE_LABEL[order.code],
      cell: (order) => <PromiseBadge code={order.code} />,
    },
    {
      id: "why",
      header: "Why",
      csv: (order) => order.reason,
      cell: (order) => <span className="block max-w-md whitespace-normal text-muted-foreground">{order.reason}</span>,
    },
  ];
}

function formatRemain(ms: number): string {
  if (ms <= 0) return "now";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatZoneClock(now: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
}

export function PromisePage() {
  const { warehouseId } = useWarehouse();
  const boardQuery = useApiQuery<PromiseBoard>(
    warehouseId ? `/api/analytics/promises?warehouseId=${encodeURIComponent(warehouseId)}` : null,
    { refetchInterval: 60_000 },
  );
  const board = boardQuery.data ?? null;
  const askForm = useZodForm(askFormSchema, { sku: "", qty: "1" });
  const [ask, setAsk] = useState<PromiseAsk | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setError(null);
    setAsk(null);
  }, [warehouseId]);

  const pickupAt = board ? nextPickup(now, board.timeZone, board.cutoffMinutes) : null;
  const columns = promiseColumns(board?.timeZone ?? "UTC");

  async function askSku(values: AskFormValues) {
    if (!warehouseId) return;
    setError(null);
    setAsking(true);
    try {
      const params = new URLSearchParams({
        warehouseId,
        sku: values.sku.trim(),
        qty: values.qty.trim() || "1",
      });
      const next = await api<PromiseAsk>(`/api/analytics/promises/ask?${params.toString()}`);
      setAsk(next);
    } catch (err) {
      setAsk(null);
      setError(errorText(err, "Could not quote that SKU."));
    } finally {
      setAsking(false);
    }
  }

  const tiles: { label: string; value: number | undefined; icon: LucideIcon; tone: StatusTone }[] = [
    { label: "This pickup", value: board?.kpis.leavesToday, icon: PackageCheck, tone: "success" },
    { label: "Later pickup", value: board?.kpis.nextPickup, icon: Clock, tone: "info" },
    { label: "Waiting on inbound", value: board?.kpis.inbound, icon: Truck, tone: "progress" },
    { label: "Can't promise", value: board?.kpis.short, icon: TriangleAlert, tone: "danger" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-(--density-gap)">
      <PageHeader
        eyebrow="Analytics"
        title="Promise"
        description={
          <>
            When an open order leaves on the <Term id="cutoff">carrier pickup</Term>. The same answer a checkout or a
            buying agent can read.
          </>
        }
        actions={
          board && pickupAt != null ? (
            <div className="rounded-lg border bg-card px-3 py-2 text-right shadow-xs">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{board.timeZone.replaceAll("_", " ")}</p>
              <p className="font-mono text-lg tabular-nums leading-none">{formatZoneClock(now, board.timeZone)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Next pickup {board.cutoffLabel} · {formatRemain(pickupAt - now)}
              </p>
            </div>
          ) : null
        }
      />
      <ErrorBanner error={error ?? boardQuery.error?.message ?? null} />
      {board ? (
        <p className="max-w-3xl text-sm text-muted-foreground">
          {board.notice}{" "}
          {board.paceAssumed
            ? `Pace uses the bench rate of ${board.benchUnitsPerHour} units an hour until 15 minutes of floor work exist today.`
            : `Floor pace is ${Math.round(board.pacePerHour ?? 0)} units an hour over the last 60 minutes.`}{" "}
          Inbound counts {board.inboundSlackHours} hours after it lands. Pickup is {board.cutoffLabel} local.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border bg-card p-4 shadow-xs">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-muted-foreground">{tile.label}</p>
              <span className={`flex size-7 items-center justify-center rounded-md ${toneClass(tile.tone)}`}>
                <tile.icon className="size-4" />
              </span>
            </div>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{tile.value ?? "—"}</p>
          </div>
        ))}
      </div>
      <Card className="space-y-4">
        <div>
          <p className="text-sm font-medium">Ask about a SKU</p>
          <p className="text-sm text-muted-foreground">A new order sits behind the open pick queue. Nothing is reserved.</p>
        </div>
        <form className="flex flex-wrap items-start gap-3" onSubmit={askForm.handleSubmit(askSku)}>
          <TextField form={askForm} name="sku" label="SKU" placeholder="LAMP" className="w-40 [&_input]:font-mono" />
          {/* Qty stays a text input with the number pad, as before: a number input would read "1e" as blank. */}
          <Form {...askForm}>
            <FormField
              control={askForm.control}
              name="qty"
              render={({ field }) => (
                // minmax(0,1fr) pins the track to w-24 so a long message overflows under Ask instead of widening the input.
                <FormItem className="w-24 grid-cols-[minmax(0,1fr)] text-sm">
                  <FormLabel>Qty</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="numeric" />
                  </FormControl>
                  <FormMessage className="w-max max-w-48" />
                </FormItem>
              )}
            />
          </Form>
          <Button type="submit" className="mt-3.5" disabled={asking}>
            {asking ? "Asking…" : "Ask"}
          </Button>
        </form>
        {ask ? <AskResult ask={ask} /> : null}
      </Card>
      <DataTable
        id="promise"
        data={board?.orders}
        loading={boardQuery.isLoading}
        columns={columns}
        getRowId={(order) => order.orderId}
        rowHref={(order) => `/outbound/orders/${order.orderId}`}
        tabs={PROMISE_TABS}
        defaultTab="all"
        defaultSort={{ id: "leaves", desc: false }}
        search={{
          placeholder: "Search order, customer, SKU",
          text: (order) => [order.number, order.customerName, order.slowSku, order.waitingOn].filter(Boolean).join(" "),
        }}
        exportName="promise"
        empty={
          <EmptyState
            icon={Clock}
            title="No open orders to promise."
            body="Orders show up here once they are open for picking."
            action={
              <Button size="sm" asChild>
                <Link to="/outbound/orders?new=1">New order</Link>
              </Button>
            }
          />
        }
      />
    </div>
  );
}

function AskResult({ ask }: { ask: PromiseAsk }) {
  const when =
    ask.promisedAt != null ? formatPickupLabel(ask.promisedAt, ask.timeZone) : "No dated cover";
  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-sm">
          {ask.sku} <span className="text-muted-foreground">× {ask.qty}</span>
        </p>
        <PromiseBadge code={ask.code} />
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{when}</p>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{ask.reason}</p>
      {ask.unitsAhead > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{ask.unitsAhead} units are already in front of this qty.</p>
      ) : null}
    </div>
  );
}
