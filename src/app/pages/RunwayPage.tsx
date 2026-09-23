import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FilePlus2, Hourglass } from "lucide-react";
import {
  api,
  type Item,
  type Purchase,
  type RunwayBoard,
  type RunwayDraftLine,
  type RunwayRow,
  type RunwayStatus,
  type RunwayWindow,
} from "../api";
import { Button, EmptyState, ErrorBanner, Input, PageHeader, ToneBadge } from "../components/ui";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { Muted, SkuCell } from "../components/cells";
import { useApiQuery } from "../query";
import { useWrite } from "../use-write";
import { useWarehouse } from "../warehouse";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isRunwayMultiplier, RUNWAY_STATUSES, type RunwayMultiplier } from "@/domain/runway";
import { statusTone, type StatusTone } from "@/domain/status";

type RunwaySnapshot = RunwayBoard & { draftLines: RunwayDraftLine[] };

const STATUS_LABEL: Record<RunwayStatus, string> = {
  out: "Out",
  order_now: "Order today",
  order_soon: "Order this week",
  covered: "Inbound covers",
  watch: "Watch",
  thin: "Thin history",
  healthy: "Healthy",
  idle: "Idle",
};

/** Same colours as StatusBadge; "order this week" is not in the shared map yet, so it reads amber here. */
function runwayTone(status: RunwayStatus): StatusTone {
  return status === "order_soon" ? "warning" : statusTone(status);
}

function runwayQuery(warehouseId: string, window: RunwayWindow, multiplier: number) {
  const params = new URLSearchParams();
  if (warehouseId) params.set("warehouseId", warehouseId);
  params.set("window", window);
  params.set("multiplier", String(multiplier));
  return `?${params.toString()}`;
}

function formatRate(value: number) {
  if (!value) return "0";
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function formatDays(row: RunwayRow) {
  if (row.status === "idle") return "—";
  if (row.daysOfCover == null) return "90d+";
  return `${row.daysOfCover.toFixed(1)}d`;
}

function formatWhen(at: number | null) {
  if (at == null) return "—";
  return new Date(at).toISOString().slice(0, 10);
}

function mono(value: string | number) {
  return <span className="font-mono">{value}</span>;
}

const RUNWAY_TABS: TabDef<RunwayRow>[] = [
  { id: "all", label: "All", match: () => true },
  {
    id: "order",
    label: "Needs order",
    match: (row) => row.status === "out" || row.status === "order_now" || row.status === "order_soon",
  },
  { id: "covered", label: "Inbound covers", match: (row) => row.status === "covered" },
  { id: "idle", label: "Idle", match: (row) => row.status === "idle" },
];

const RUNWAY_FACETS: FacetDef<RunwayRow>[] = [
  { id: "status", label: "Status", value: (row) => row.status, format: (value) => STATUS_LABEL[value as RunwayStatus] ?? value },
  { id: "vendor", label: "Vendor", value: (row) => row.lastVendorName },
];

const RUNWAY_COLUMNS: DataColumn<RunwayRow>[] = [
  {
    id: "sku",
    header: "SKU",
    sortValue: (row) => row.sku,
    csv: (row) => row.sku,
    cell: (row) => <SkuCell sku={row.sku} name={row.name} to={`/stock/items/${row.itemId}`} />,
  },
  { id: "name", header: "Name", defaultHidden: true, sortValue: (row) => row.name, cell: (row) => row.name },
  {
    id: "onHand",
    header: "On hand",
    align: "right",
    defaultHidden: true,
    sortValue: (row) => row.onHand,
    cell: (row) => mono(row.onHand),
  },
  { id: "sellable", header: "Sellable", align: "right", sortValue: (row) => row.sellable, cell: (row) => mono(row.sellable) },
  {
    id: "observed",
    header: "Observed",
    align: "right",
    sortValue: (row) => row.observedRate,
    csv: (row) => formatRate(row.observedRate),
    cell: (row) => mono(formatRate(row.observedRate)),
  },
  {
    id: "baseline",
    header: "Baseline",
    align: "right",
    sortValue: (row) => row.baselineRate,
    csv: (row) => (row.baselineRate != null ? formatRate(row.baselineRate) : "auto"),
    cell: (row) => (row.baselineRate != null ? mono(formatRate(row.baselineRate)) : <Muted>auto</Muted>),
  },
  {
    id: "burn",
    header: "Burn",
    align: "right",
    sortValue: (row) => row.burnRate,
    csv: (row) => formatRate(row.burnRate),
    cell: (row) => mono(formatRate(row.burnRate)),
  },
  {
    id: "inbound",
    header: "Inbound",
    align: "right",
    sortValue: (row) => row.inboundQty,
    csv: (row) => (row.inboundQty ? `${row.inboundQty}${row.inboundAt ? ` ${formatWhen(row.inboundAt)}` : ""}` : ""),
    cell: (row) =>
      row.inboundQty ? (
        <span className="flex flex-col items-end">
          {mono(row.inboundQty)}
          {row.inboundAt ? (
            <span className="font-mono text-[11px] text-muted-foreground">{formatWhen(row.inboundAt)}</span>
          ) : null}
        </span>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "days",
    header: "Days",
    align: "right",
    sortValue: (row) => (row.status === "idle" ? null : (row.daysOfCover ?? Number.MAX_SAFE_INTEGER)),
    csv: (row) => formatDays(row),
    cell: (row) => mono(formatDays(row)),
  },
  {
    id: "stockout",
    header: "Stockout",
    sortValue: (row) => row.stockoutAt,
    csv: (row) => formatWhen(row.stockoutAt),
    cell: (row) => mono(formatWhen(row.stockoutAt)),
  },
  {
    id: "orderBy",
    header: "Order by",
    sortValue: (row) => row.orderByAt,
    csv: (row) => formatWhen(row.orderByAt),
    cell: (row) => mono(formatWhen(row.orderByAt)),
  },
  {
    id: "suggested",
    header: "Suggested",
    align: "right",
    defaultHidden: true,
    sortValue: (row) => row.suggestedQty,
    cell: (row) => mono(row.suggestedQty),
  },
  {
    id: "vendor",
    header: "Last vendor",
    defaultHidden: true,
    sortValue: (row) => row.lastVendorName,
    cell: (row) => row.lastVendorName ?? <Muted>—</Muted>,
  },
  {
    id: "status",
    header: "Status",
    sortValue: (row) => RUNWAY_STATUSES.indexOf(row.status),
    csv: (row) => `${STATUS_LABEL[row.status]}${row.coveredByOpenPo ? " (open PO)" : ""}`,
    cell: (row) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <ToneBadge tone={runwayTone(row.status)}>{STATUS_LABEL[row.status]}</ToneBadge>
        {row.coveredByOpenPo ? <span className="text-xs text-muted-foreground">open PO</span> : null}
      </span>
    ),
  },
];

export function RunwayPage() {
  const { warehouseId } = useWarehouse();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [window, setWindow] = useState<RunwayWindow>("30d");
  const [multiplier, setMultiplier] = useState<RunwayMultiplier>(1);
  const [baselineDraft, setBaselineDraft] = useState("");
  const baseline = useWrite();
  const draft = useWrite();

  // Keep the last board on screen while a new window or multiplier loads.
  const query = useApiQuery<RunwaySnapshot>(`/api/analytics/runway${runwayQuery(warehouseId, window, multiplier)}`, {
    placeholderData: (previous) => previous,
  });
  const board = query.data ?? null;
  const rows = board?.rows ?? [];
  const pickedId = params.get("sku");
  const selected = rows.find((row) => row.itemId === pickedId) ?? rows[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setBaselineDraft("");
      return;
    }
    setBaselineDraft(selected.baselineRate != null ? String(selected.baselineRate) : "");
  }, [selected?.itemId, selected?.baselineRate]);

  const tiles = useMemo(
    () => [
      { label: "Out", value: board ? board.kpis.out : "—" },
      { label: "Order today", value: board ? board.kpis.orderNow : "—" },
      { label: "Inbound covers", value: board ? board.kpis.covered : "—" },
      { label: "Idle", value: board ? board.kpis.idle : "—" },
    ],
    [board],
  );

  /** Clicking a row charts that SKU. The pick lives in the URL next to the table's own filters. */
  function selectHref(row: RunwayRow) {
    const next = new URLSearchParams(location.search);
    next.set("sku", row.itemId);
    return `${location.pathname}?${next.toString()}`;
  }

  async function saveBaseline() {
    if (!selected) return;
    const cleared = baselineDraft.trim() === "";
    await baseline.run(
      "Save baseline",
      () =>
        api<Item>(`/api/items/${selected.itemId}`, {
          method: "PATCH",
          body: JSON.stringify({
            baselineShipRate: cleared ? null : Number(baselineDraft),
          }),
        }),
      cleared
        ? `Baseline cleared for ${selected.sku}. Burn follows observed ships.`
        : `Baseline for ${selected.sku} set to ${baselineDraft}/day.`,
    );
  }

  async function draftPo() {
    if (!warehouseId) {
      draft.setError("Select a warehouse before drafting a PO");
      return;
    }
    const lines = board?.draftLines.length ?? 0;
    const created = await draft.run(
      "Draft PO",
      () =>
        api<Purchase>("/api/purchases/from-runway", {
          method: "POST",
          body: JSON.stringify({ warehouseId }),
        }),
      (po) => `Drafted ${po.number} with ${lines} ${lines === 1 ? "line" : "lines"}. Review it before you send it.`,
    );
    if (created) navigate(`/inbound/purchases/${created.id}`);
  }

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Analytics"
        title="Runway"
        description="Live days until a SKU runs out at its baseline shipping rate. Cover is sellable qty (on-hand − held − remaining to pick), plus dated ASN/PO inbound, minus BOM burn from finished goods."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={window}
              onValueChange={(value) => {
                if (value === "7d" || value === "30d" || value === "90d") setWindow(value);
              }}
              variant="outline"
              size="sm"
              aria-label="History window"
            >
              <ToggleGroupItem value="7d">7 days</ToggleGroupItem>
              <ToggleGroupItem value="30d">30 days</ToggleGroupItem>
              <ToggleGroupItem value="90d">90 days</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              type="single"
              value={String(multiplier)}
              onValueChange={(value) => {
                const next = Number(value);
                if (isRunwayMultiplier(next)) setMultiplier(next);
              }}
              variant="outline"
              size="sm"
              aria-label="Demand multiplier"
            >
              <ToggleGroupItem value="0.5">0.5×</ToggleGroupItem>
              <ToggleGroupItem value="1">1×</ToggleGroupItem>
              <ToggleGroupItem value="1.5">1.5×</ToggleGroupItem>
              <ToggleGroupItem value="2">2×</ToggleGroupItem>
            </ToggleGroup>
            <Button
              size="sm"
              disabled={draft.busy || !board?.draftLines.length}
              title={board && !board.draftLines.length ? "Nothing needs ordering right now." : undefined}
              onClick={() => void draftPo()}
            >
              <FilePlus2 className="size-4" />
              {draft.busy ? "Drafting…" : board?.draftLines.length ? `Draft PO (${board.draftLines.length})` : "Draft PO"}
            </Button>
          </div>
        }
      />
      <ErrorBanner error={query.error?.message ?? draft.error ?? baseline.error} />
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
      {selected ? (
        <Card className="px-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="font-mono">{selected.sku}</span> {selected.name}
                <ToneBadge tone={runwayTone(selected.status)}>{STATUS_LABEL[selected.status]}</ToneBadge>
              </p>
              <p className="text-sm text-muted-foreground">
                Burn {formatRate(selected.burnRate)}/day
                {selected.rateSource === "baseline" ? " from baseline" : selected.rateSource === "observed" ? " from ships" : ""}
                {selected.thin ? " · thin history" : ""}
                {selected.inboundQty ? ` · inbound ${selected.inboundQty}` : ""}
              </p>
            </div>
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveBaseline();
              }}
            >
              <label className="grid gap-1 text-xs text-muted-foreground">
                Baseline / day
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  className="w-28"
                  value={baselineDraft}
                  onChange={(e) => setBaselineDraft(e.target.value)}
                  placeholder="auto"
                />
              </label>
              <Button type="submit" size="sm" variant="outline" disabled={baseline.busy}>
                {baseline.busy ? "Saving…" : "Save"}
              </Button>
            </form>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={selected.daily}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={36} />
                <Tooltip />
                <Area dataKey="onHand" type="monotone" fill="var(--chart-1)" stroke="var(--chart-1)" fillOpacity={0.2} />
                <Area dataKey="inbound" type="monotone" fill="var(--chart-2)" stroke="var(--chart-2)" fillOpacity={0.15} />
                <Area dataKey="shipped" type="monotone" fill="var(--chart-3)" stroke="var(--chart-3)" fillOpacity={0.1} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}
      <DataTable
        id="runway"
        data={board?.rows}
        loading={query.isLoading}
        columns={RUNWAY_COLUMNS}
        getRowId={(row) => row.itemId}
        rowHref={selectHref}
        rowClassName={(row) => (row.itemId === selected?.itemId ? "bg-primary/5" : undefined)}
        tabs={RUNWAY_TABS}
        defaultTab="all"
        facets={RUNWAY_FACETS}
        defaultSort={{ id: "status", desc: false }}
        search={{
          placeholder: "Search SKU, name, vendor",
          text: (row) => [row.sku, row.name, row.lastVendorName].filter(Boolean).join(" "),
        }}
        exportName={`runway-${window}`}
        empty={
          <EmptyState
            icon={Hourglass}
            title="No SKUs in this warehouse yet."
            body="Add items and ship a few orders, and runway fills in from their burn rate."
          />
        }
      />
    </div>
  );
}
