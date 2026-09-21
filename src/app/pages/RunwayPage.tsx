import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Item, type Purchase, type RunwayBoard, type RunwayDraftLine, type RunwayRow, type RunwayStatus, type RunwayWindow } from "../api";
import { Button, ErrorBanner, Input, PageHeader, Table } from "../components/ui";
import { useWarehouse } from "../warehouse";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isRunwayMultiplier, type RunwayMultiplier } from "@/domain/runway";

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

function statusVariant(status: RunwayStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "out" || status === "order_now") return "destructive";
  if (status === "healthy" || status === "covered") return "default";
  return "secondary";
}

export function RunwayPage() {
  const { warehouseId } = useWarehouse();
  const navigate = useNavigate();
  const [window, setWindow] = useState<RunwayWindow>("30d");
  const [multiplier, setMultiplier] = useState<RunwayMultiplier>(1);
  const [board, setBoard] = useState<RunwaySnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baselineDraft, setBaselineDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const next = await api<RunwaySnapshot>(`/api/analytics/runway${runwayQuery(warehouseId, window, multiplier)}`);
    setBoard(next);
    setSelectedId((current) => current && next.rows.some((row) => row.itemId === current) ? current : next.rows[0]?.itemId ?? null);
  }

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [warehouseId, window, multiplier]);

  const selected = board?.rows.find((row) => row.itemId === selectedId) ?? null;

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

  async function saveBaseline() {
    if (!selected) return;
    setError(null);
    setSaving(true);
    try {
      await api<Item>(`/api/items/${selected.itemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          baselineShipRate: baselineDraft.trim() === "" ? null : Number(baselineDraft),
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save baseline");
    } finally {
      setSaving(false);
    }
  }

  async function draftPo() {
    if (!warehouseId) {
      setError("Select a warehouse before drafting a PO");
      return;
    }
    setError(null);
    setDrafting(true);
    try {
      const created = await api<Purchase>("/api/purchases/from-runway", {
        method: "POST",
        body: JSON.stringify({ warehouseId }),
      });
      navigate(`/inbound/purchases/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not draft PO");
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="space-y-6">
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
            >
              <ToggleGroupItem value="0.5">0.5×</ToggleGroupItem>
              <ToggleGroupItem value="1">1×</ToggleGroupItem>
              <ToggleGroupItem value="1.5">1.5×</ToggleGroupItem>
              <ToggleGroupItem value="2">2×</ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant="secondary"
              disabled={drafting || !(board?.draftLines.length)}
              onClick={() => void draftPo()}
            >
              {drafting ? "Drafting…" : "Draft PO"}
            </Button>
          </div>
        }
      />
      <ErrorBanner error={error} />
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
        <Card>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                <span className="font-mono">{selected.sku}</span> {selected.name}
              </p>
              <p className="text-sm text-muted-foreground">
                Burn {formatRate(selected.burnRate)}/day
                {selected.rateSource === "baseline" ? " from baseline" : selected.rateSource === "observed" ? " from ships" : ""}
                {selected.thin ? " · thin history" : ""}
                {selected.inboundQty ? ` · inbound ${selected.inboundQty}` : ""}
              </p>
            </div>
            <div className="flex items-end gap-2">
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
              <Button variant="secondary" disabled={saving} onClick={() => void saveBaseline()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
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
      <Table
        columns={[
          "SKU",
          "Sellable",
          "Observed",
          "Baseline",
          "Burn",
          "Inbound",
          "Days",
          "Stockout",
          "Order by",
          "Status",
        ]}
      >
        {(board?.rows ?? []).map((row) => (
          <tr
            key={row.itemId}
            className={row.itemId === selectedId ? "cursor-pointer bg-muted/40" : "cursor-pointer"}
            onClick={() => setSelectedId(row.itemId)}
          >
            <td className="px-4 py-3 font-mono">
              <Link className="hover:underline" to={`/stock/items/${row.itemId}`} onClick={(event) => event.stopPropagation()}>
                {row.sku}
              </Link>
              <span className="ml-2 text-muted-foreground">{row.name}</span>
            </td>
            <td className="px-4 py-3 font-mono tabular-nums">{row.sellable}</td>
            <td className="px-4 py-3 font-mono tabular-nums">{formatRate(row.observedRate)}</td>
            <td className="px-4 py-3 font-mono tabular-nums">{row.baselineRate != null ? formatRate(row.baselineRate) : "auto"}</td>
            <td className="px-4 py-3 font-mono tabular-nums">{formatRate(row.burnRate)}</td>
            <td className="px-4 py-3 font-mono tabular-nums">
              {row.inboundQty ? `${row.inboundQty}${row.inboundAt ? ` · ${formatWhen(row.inboundAt)}` : ""}` : "—"}
            </td>
            <td className="px-4 py-3 font-mono tabular-nums">{formatDays(row)}</td>
            <td className="px-4 py-3 font-mono tabular-nums">{formatWhen(row.stockoutAt)}</td>
            <td className="px-4 py-3 font-mono tabular-nums">{formatWhen(row.orderByAt)}</td>
            <td className="px-4 py-3">
              <Badge variant={statusVariant(row.status)}>{STATUS_LABEL[row.status]}</Badge>
              {row.coveredByOpenPo ? <span className="ml-2 text-xs text-muted-foreground">open PO</span> : null}
            </td>
          </tr>
        ))}
      </Table>
      {board && board.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SKUs in this warehouse yet.</p>
      ) : null}
    </div>
  );
}
