import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type LaborBoard, type LaborSkuDetail, type LaborStaffDetail } from "../api";
import { ErrorBanner, PageHeader, StatStrip, Table } from "../components/ui";
import { useWarehouse } from "../warehouse";
import { useSession } from "../session";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Preset = "today" | "7d" | "30d";

function laborQuery(warehouseId: string, preset: Preset) {
  const params = new URLSearchParams();
  if (warehouseId) params.set("warehouseId", warehouseId);
  params.set("preset", preset);
  return `?${params.toString()}`;
}

function formatPace(value: number) {
  return value.toFixed(1);
}

function formatHours(value: number) {
  if (!value) return "—";
  return `${value.toFixed(2)} h`;
}

function paceHint(value: number) {
  if (value >= 6) return "Ahead of expected";
  if (value <= 4) return "Behind expected";
  return "On expected time";
}

export function LaborPage() {
  const { userId } = useParams();
  if (userId) return <LaborStaffPage userId={userId} />;
  return <LaborBoardPage />;
}

function LaborFilters({
  preset,
  onPreset,
}: {
  preset: Preset;
  onPreset: (value: Preset) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={preset}
      onValueChange={(value) => {
        if (value === "today" || value === "7d" || value === "30d") onPreset(value);
      }}
      variant="outline"
      size="sm"
    >
      <ToggleGroupItem value="today">Today</ToggleGroupItem>
      <ToggleGroupItem value="7d">7 days</ToggleGroupItem>
      <ToggleGroupItem value="30d">30 days</ToggleGroupItem>
    </ToggleGroup>
  );
}

function LaborBoardPage() {
  const { warehouseId } = useWarehouse();
  const [preset, setPreset] = useState<Preset>("7d");
  const [board, setBoard] = useState<LaborBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LaborBoard>(`/api/labor${laborQuery(warehouseId, preset)}`)
      .then(setBoard)
      .catch((err: Error) => setError(err.message));
  }, [warehouseId, preset]);

  const tiles = useMemo(
    () => [
      { label: "Lines", value: board ? board.team.lines : "—" },
      { label: "Units", value: board ? board.team.units : "—" },
      { label: "Pace", value: board ? formatPace(board.team.pace) : "—" },
      { label: "Exceptions", value: board ? `${board.team.exceptionRate.toFixed(1)}%` : "—" },
    ],
    [board],
  );

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Office"
        title="Performance"
        description="Staff pace against SKU difficulty and bay travel — 5 is on expected time, 10 is twice as fast, 0 is twice as slow. Slow SKUs are a process issue; slow operators on easy SKUs are coaching."
        actions={<LaborFilters preset={preset} onPreset={setPreset} />}
      />
      <ErrorBanner error={error} />
      <StatStrip
        items={tiles.map((tile) => ({
          ...tile,
          tone: tile.label === "Exceptions" ? "warn" : "default",
        }))}
      />
      {board?.daily.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="px-3">
            <p className="mb-2 text-xs font-medium">Daily volume and pace</p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={board.daily}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Area dataKey="units" type="monotone" fill="var(--chart-1)" stroke="var(--chart-1)" fillOpacity={0.2} />
                  <Area dataKey="pace" type="monotone" fill="var(--chart-2)" stroke="var(--chart-2)" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="px-3">
            <p className="mb-2 text-xs font-medium">Verb mix</p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={board.verbMix}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="verb" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Bar dataKey="units" fill="var(--chart-1)" radius={4} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      ) : null}
      <div>
        <p className="mb-2 text-sm font-medium">Staff</p>
        <Table columns={["Teammate", "Role", "Lines", "Units", "Active", "LPH", "UPH", "Pace", "Exceptions"]}>
          {(board?.staff ?? []).map((row) => (
            <tr key={row.userId}>
              <td className="px-2.5 py-1.5">
                <Link className="font-medium hover:underline" to={`/labor/staff/${row.userId}`}>
                  {row.userName}
                </Link>
              </td>
              <td className="px-2.5 py-1.5 capitalize">{row.role}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.lines}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.units}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{formatHours(row.activeHours)}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.lph.toFixed(1)}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.uph.toFixed(1)}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums" title={paceHint(row.pace)}>
                {formatPace(row.pace)}
              </td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.exceptionRate.toFixed(1)}%</td>
            </tr>
          ))}
        </Table>
        {board && board.staff.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No floor work in this window.</p> : null}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">SKUs</p>
        <Table columns={["SKU", "Name", "Complexity", "Units", "Handlers", "Pace", "Exceptions", ""]}>
          {(board?.skus ?? []).map((row) => (
            <tr key={row.itemId}>
              <td className="px-2.5 py-1.5 font-mono">
                <Link className="hover:underline" to={`/stock/items/${row.itemId}`}>
                  {row.sku}
                </Link>
              </td>
              <td className="px-2.5 py-1.5">{row.name}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.complexity.toFixed(1)}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.units}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.handlers}</td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums" title={paceHint(row.pace)}>
                {formatPace(row.pace)}
              </td>
              <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.exceptionRate.toFixed(1)}%</td>
              <td className="px-2.5 py-1.5 text-sm text-muted-foreground">{row.hard ? "Hard SKU" : ""}</td>
            </tr>
          ))}
        </Table>
      </div>
      {(board?.matrix.length ?? 0) > 0 ? (
        <div>
          <p className="mb-2 text-sm font-medium">Staff × SKU</p>
          <Table columns={["Teammate", "SKU", "Units", "Pace"]}>
            {(board?.matrix ?? []).map((cell) => (
              <tr key={`${cell.userId}:${cell.itemId}`}>
                <td className="px-2.5 py-1.5">{cell.userName}</td>
                <td className="px-2.5 py-1.5 font-mono">{cell.sku}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums">{cell.units}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums">{formatPace(cell.pace)}</td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function LaborStaffPage({ userId }: { userId: string }) {
  const { warehouseId } = useWarehouse();
  const [preset, setPreset] = useState<Preset>("7d");
  const [detail, setDetail] = useState<(LaborStaffDetail & { range?: LaborBoard["range"] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LaborStaffDetail & { range: LaborBoard["range"] }>(`/api/labor/staff/${encodeURIComponent(userId)}${laborQuery(warehouseId, preset)}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [warehouseId, preset, userId]);

  const staff = detail?.staff;

  return (
    <div className="space-y-3">
      <PageHeader
        eyebrow="Performance"
        title={staff?.userName ?? "Teammate"}
        description={staff ? `${paceHint(staff.pace)}. Top SKUs and recent documents for this window.` : "Loading teammate…"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="text-sm text-muted-foreground hover:underline" to="/labor">
              All staff
            </Link>
            <LaborFilters preset={preset} onPreset={setPreset} />
          </div>
        }
      />
      <ErrorBanner error={error} />
      {staff ? (
        <StatStrip
          items={[
            { label: "Lines", value: staff.lines },
            { label: "Units", value: staff.units },
            { label: "Pace", value: formatPace(staff.pace) },
            { label: "Exceptions", value: `${staff.exceptionRate.toFixed(1)}%`, tone: "warn" },
          ]}
        />
      ) : null}
      {detail?.daily.length || detail?.verbMix.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {detail.daily.length ? (
            <Card className="px-3">
              <p className="mb-2 text-xs font-medium">Daily volume and pace</p>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={detail.daily}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={32} />
                    <Tooltip />
                    <Area dataKey="units" type="monotone" fill="var(--chart-1)" stroke="var(--chart-1)" fillOpacity={0.2} />
                    <Area dataKey="pace" type="monotone" fill="var(--chart-2)" stroke="var(--chart-2)" fillOpacity={0.15} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}
          {detail.verbMix.length ? (
            <Card className="px-3">
              <p className="mb-2 text-xs font-medium">Verb mix</p>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={detail.verbMix}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="verb" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={32} />
                    <Tooltip />
                    <Bar dataKey="units" fill="var(--chart-1)" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
      {detail?.skus.length ? (
        <div>
          <p className="mb-2 text-sm font-medium">SKUs handled</p>
          <Table columns={["SKU", "Units", "Pace", "Exceptions"]}>
            {detail.skus.map((row) => (
              <tr key={row.itemId}>
                <td className="px-2.5 py-1.5 font-mono">
                  <Link className="hover:underline" to={`/stock/items/${row.itemId}`}>
                    {row.sku}
                  </Link>
                </td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.units}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums">{formatPace(row.pace)}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.exceptionRate.toFixed(1)}%</td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}
      {detail?.recent.length ? (
        <div>
          <p className="mb-2 text-sm font-medium">Recent documents</p>
          <Table columns={["When", "Verb", "SKU", "Qty", "Ref"]}>
            {detail.recent.map((row, index) => (
              <tr key={`${row.refId}:${row.createdAt}:${index}`}>
                <td className="px-2.5 py-1.5 text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="px-2.5 py-1.5 font-mono text-xs uppercase">{row.verb}</td>
                <td className="px-2.5 py-1.5 font-mono">{row.sku}</td>
                <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.qty}</td>
                <td className="px-2.5 py-1.5 font-mono text-xs">
                  {row.refType}/{row.refId.slice(0, 8)}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}
    </div>
  );
}

export function SkuHandlers({ itemId, linkStaff = true }: { itemId: string; linkStaff?: boolean }) {
  const { warehouseId } = useWarehouse();
  const [detail, setDetail] = useState<(LaborSkuDetail & { range?: LaborBoard["range"] }) | null>(null);

  useEffect(() => {
    api<LaborSkuDetail & { range: LaborBoard["range"] }>(`/api/labor/skus/${encodeURIComponent(itemId)}${laborQuery(warehouseId, "30d")}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [itemId, warehouseId]);

  if (!detail?.sku && !(detail?.handlers.length ?? 0)) return null;

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Who handles this</p>
      <p className="mb-3 text-sm text-muted-foreground">
        Last 30 days. Pace is expected time from SKU flags and walk, not raw units/hour.
        {detail?.sku?.hard ? " This SKU is harder than expected for the people who touch it." : ""}
      </p>
      <Table columns={["Teammate", "Lines", "Units", "Pace", "Exceptions"]}>
        {(detail?.handlers ?? []).map((row) => (
          <tr key={row.userId}>
            <td className="px-2.5 py-1.5">
              {linkStaff ? (
                <Link className="hover:underline" to={`/labor/staff/${row.userId}`}>
                  {row.userName}
                </Link>
              ) : (
                row.userName
              )}
            </td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.lines}</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.units}</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums">{formatPace(row.pace)}</td>
            <td className="px-2.5 py-1.5 font-mono tabular-nums">{row.exceptionRate.toFixed(1)}%</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function MyDayCard() {
  const { warehouseId } = useWarehouse();
  const me = useSession();
  const [detail, setDetail] = useState<LaborStaffDetail | null>(null);

  useEffect(() => {
    api<LaborStaffDetail>(`/api/labor/staff/${encodeURIComponent(me.user.id)}${laborQuery(warehouseId, "today")}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [warehouseId, me.user.id]);

  const row = detail?.staff;
  if (!row || row.lines + row.exceptionUnits === 0) return null;

  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">My day</p>
      <p className="mt-0.5 text-sm font-semibold">
        {row.lines} {row.lines === 1 ? "line" : "lines"} · {row.units} {row.units === 1 ? "unit" : "units"} · pace {formatPace(row.pace)}
      </p>
      <p className="text-xs text-muted-foreground">
        {paceHint(row.pace)}
        {row.exceptionUnits ? ` · ${row.exceptionUnits} exception units` : ""}
      </p>
    </div>
  );
}
