import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, ErrorBanner, Input, PageHeader, Table } from "../components/ui";
import { useWarehouse } from "../warehouse";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatPickupLabel,
  nextPickup,
  type PromiseAsk,
  type PromiseBoard,
  type PromiseCode,
  type PromiseOrder,
} from "@/domain/promise";

const CODE_LABEL: Record<PromiseCode, string> = {
  leaves_today: "This pickup",
  next_pickup: "Later pickup",
  inbound: "Inbound",
  short: "Can't promise",
};

const FILTERS: { id: "all" | PromiseCode; label: string }[] = [
  { id: "all", label: "All" },
  { id: "leaves_today", label: "This pickup" },
  { id: "next_pickup", label: "Later" },
  { id: "inbound", label: "Inbound" },
  { id: "short", label: "Can't promise" },
];

function codeVariant(code: PromiseCode): "default" | "secondary" | "destructive" | "outline" {
  if (code === "short") return "destructive";
  if (code === "leaves_today") return "default";
  if (code === "inbound") return "outline";
  return "secondary";
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
  const [board, setBoard] = useState<PromiseBoard | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("1");
  const [ask, setAsk] = useState<PromiseAsk | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!warehouseId) return;
    setError(null);
    setAsk(null);
    api<PromiseBoard>(`/api/analytics/promises?warehouseId=${encodeURIComponent(warehouseId)}`)
      .then(setBoard)
      .catch((err: Error) => setError(err.message));
  }, [warehouseId]);

  const rows = useMemo(() => {
    const orders = board?.orders ?? [];
    if (filter === "all") return orders;
    return orders.filter((order) => order.code === filter);
  }, [board, filter]);

  const pickupAt = board ? nextPickup(now, board.timeZone, board.cutoffMinutes) : null;

  async function askSku() {
    if (!warehouseId) return;
    setError(null);
    setAsking(true);
    try {
      const params = new URLSearchParams({
        warehouseId,
        sku: sku.trim(),
        qty: qty.trim() || "1",
      });
      const next = await api<PromiseAsk>(`/api/analytics/promises/ask?${params.toString()}`);
      setAsk(next);
    } catch (err) {
      setAsk(null);
      setError(err instanceof Error ? err.message : "Could not quote that SKU");
    } finally {
      setAsking(false);
    }
  }

  const tiles = [
    { label: "This pickup", value: board ? board.kpis.leavesToday : "—" },
    { label: "Later pickup", value: board ? board.kpis.nextPickup : "—" },
    { label: "Waiting on inbound", value: board ? board.kpis.inbound : "—" },
    { label: "Can't promise", value: board ? board.kpis.short : "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Analytics"
        title="Promise"
        description="When an open order leaves on the carrier pickup. The same answer a checkout or a buying agent can read."
        actions={
          board && pickupAt != null ? (
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{board.timeZone.replaceAll("_", " ")}</p>
              <p className="font-mono text-lg tabular-nums leading-none">{formatZoneClock(now, board.timeZone)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Next pickup {board.cutoffLabel} · {formatRemain(pickupAt - now)}
              </p>
            </div>
          ) : null
        }
      />
      <ErrorBanner error={error} />
      {board ? (
        <p className="max-w-3xl text-sm text-muted-foreground">
          {board.notice}{" "}
          {board.paceAssumed
            ? `Pace uses the bench rate of ${board.benchUnitsPerHour} units an hour until 15 minutes of floor work exist today.`
            : `Floor pace is ${Math.round(board.pacePerHour ?? 0)} units an hour over the last 60 minutes.`}{" "}
          Inbound counts {board.inboundSlackHours} hours after it lands. Pickup is {board.cutoffLabel} local.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label} className="from-primary/5 to-card bg-gradient-to-t shadow-xs">
            <CardHeader>
              <CardDescription>{tile.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{tile.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void askSku();
          }}
        >
          <label className="grid gap-1 text-xs text-muted-foreground">
            SKU
            <Input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="LAMP" className="w-40 font-mono" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Qty
            <Input
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              inputMode="numeric"
              className="w-24"
            />
          </label>
          <Button type="submit" disabled={asking || !sku.trim()}>
            {asking ? "Asking…" : "Ask"}
          </Button>
          <p className="pb-2 text-xs text-muted-foreground">A new order sits behind the open pick queue. Nothing is reserved.</p>
        </form>
        {ask ? <AskResult ask={ask} /> : null}
      </Card>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((entry) => (
          <Button
            key={entry.id}
            type="button"
            size="xs"
            variant={filter === entry.id ? "primary" : "secondary"}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>
      <Table columns={["Order", "Customer", "Units", "Leaves", "Why"]}>
        {rows.length ? (
          rows.map((order) => <OrderRow key={order.orderId} order={order} timeZone={board?.timeZone ?? "UTC"} />)
        ) : (
          <tr>
            <td colSpan={5} className="py-6 text-center text-muted-foreground">
              {board ? "Nothing in this lane." : "Loading the floor…"}
            </td>
          </tr>
        )}
      </Table>
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
        <Badge variant={codeVariant(ask.code)}>{CODE_LABEL[ask.code]}</Badge>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{when}</p>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{ask.reason}</p>
      {ask.unitsAhead > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{ask.unitsAhead} units are already in front of this qty.</p>
      ) : null}
    </div>
  );
}

function OrderRow({ order, timeZone }: { order: PromiseOrder; timeZone: string }) {
  const when = order.promisedAt != null ? formatPickupLabel(order.promisedAt, timeZone) : "—";
  return (
    <tr>
      <td>
        <Link className="font-mono font-medium hover:underline" to={`/outbound/orders/${order.orderId}`}>
          {order.number}
        </Link>
        <p className="text-[11px] text-muted-foreground">{order.status}</p>
      </td>
      <td>{order.customerName}</td>
      <td className="tabular-nums">
        {order.units}
        {order.unitsAhead > 0 ? <p className="text-[11px] text-muted-foreground">behind {order.unitsAhead}</p> : null}
      </td>
      <td>
        <Badge variant={codeVariant(order.code)}>{CODE_LABEL[order.code]}</Badge>
        <p className="mt-1 text-[11px] text-muted-foreground">{when}</p>
        {order.split ? <p className="text-[11px] text-muted-foreground">Some lines could leave sooner.</p> : null}
      </td>
      <td className="max-w-md text-muted-foreground">{order.reason}</td>
    </tr>
  );
}
