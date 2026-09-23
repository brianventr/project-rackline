import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge } from "lucide-react";
import { api, type LaborBoard, type LaborSkuDetail, type LaborStaffDetail } from "../api";
import { Button, EmptyState, ErrorBanner, PageHeader, StatStrip, Table, ToneBadge } from "../components/ui";
import { DataTable, type DataColumn, type FacetDef, type TabDef } from "../components/data-table/DataTable";
import { DocLink, Muted, PersonAvatar, RelativeTime, SkuCell } from "../components/cells";
import { Breadcrumbs } from "../components/document";
import { useApiQuery } from "../query";
import { useWarehouse } from "../warehouse";
import { useSession } from "../session";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { FLOOR_VERBS, isJobRefType, jobOfficePath } from "@/domain/jobs";
import type {
  LaborDailyPoint,
  LaborDocumentRow,
  LaborMatrixCell,
  LaborSkuRow,
  LaborStaffRow,
  LaborVerbMix,
} from "@/domain/labor-kpis";

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

/** Pace in mono, green when ahead and amber when behind, with the plain-words hint on hover. */
function Pace({ value }: { value: number }) {
  return (
    <span
      title={paceHint(value)}
      className={cn("font-mono", value >= 6 ? "text-tone-success" : value <= 4 ? "text-tone-warning" : undefined)}
    >
      {formatPace(value)}
    </span>
  );
}

function num(value: number) {
  return <span className="font-mono">{value}</span>;
}

function refPath(refType: string, refId: string): string | null {
  return isJobRefType(refType) ? jobOfficePath({ verb: FLOOR_VERBS[0], refType, refId }) : null;
}

export function LaborPage() {
  const { userId } = useParams();
  if (userId) return <LaborStaffPage userId={userId} />;
  return <LaborBoardPage />;
}

function LaborFilters({ preset, onPreset }: { preset: Preset; onPreset: (value: Preset) => void }) {
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

/** Empty-window shortcut: jump to the widest window, unless it is already showing. */
function LongerWindow({ preset, onPreset }: { preset: Preset; onPreset: (value: Preset) => void }) {
  if (preset === "30d") return null;
  return (
    <Button size="sm" variant="outline" onClick={() => onPreset("30d")}>
      Show 30 days
    </Button>
  );
}

function LaborCharts({ daily, verbMix }: { daily: LaborDailyPoint[]; verbMix: LaborVerbMix[] }) {
  if (!daily.length && !verbMix.length) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {daily.length ? (
        <Card className="px-3">
          <p className="mb-2 text-xs font-medium">Daily volume and pace</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily}>
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
      {verbMix.length ? (
        <Card className="px-3">
          <p className="mb-2 text-xs font-medium">Verb mix</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={verbMix}>
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
  );
}

const STAFF_FACETS: FacetDef<LaborStaffRow>[] = [{ id: "role", label: "Role", value: (row) => row.role }];

const STAFF_COLUMNS: DataColumn<LaborStaffRow>[] = [
  {
    id: "teammate",
    header: "Teammate",
    sortValue: (row) => row.userName,
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <PersonAvatar name={row.userName} />
        <Link className="truncate font-medium hover:text-primary hover:underline" to={`/labor/staff/${row.userId}`}>
          {row.userName}
        </Link>
      </span>
    ),
  },
  { id: "role", header: "Role", sortValue: (row) => row.role, cell: (row) => <span className="capitalize">{row.role}</span> },
  { id: "lines", header: "Lines", align: "right", sortValue: (row) => row.lines, cell: (row) => num(row.lines) },
  { id: "units", header: "Units", align: "right", sortValue: (row) => row.units, cell: (row) => num(row.units) },
  {
    id: "active",
    header: "Active",
    align: "right",
    sortValue: (row) => row.activeHours,
    csv: (row) => row.activeHours.toFixed(2),
    cell: (row) => <span className="font-mono">{formatHours(row.activeHours)}</span>,
  },
  {
    id: "lph",
    header: "LPH",
    align: "right",
    sortValue: (row) => row.lph,
    csv: (row) => row.lph.toFixed(1),
    cell: (row) => <span className="font-mono">{row.lph.toFixed(1)}</span>,
  },
  {
    id: "uph",
    header: "UPH",
    align: "right",
    sortValue: (row) => row.uph,
    csv: (row) => row.uph.toFixed(1),
    cell: (row) => <span className="font-mono">{row.uph.toFixed(1)}</span>,
  },
  {
    id: "pace",
    header: "Pace",
    align: "right",
    sortValue: (row) => row.pace,
    csv: (row) => formatPace(row.pace),
    cell: (row) => <Pace value={row.pace} />,
  },
  {
    id: "exceptions",
    header: "Exceptions",
    align: "right",
    sortValue: (row) => row.exceptionRate,
    csv: (row) => row.exceptionRate.toFixed(1),
    cell: (row) => <span className="font-mono">{row.exceptionRate.toFixed(1)}%</span>,
  },
];

const SKU_TABS: TabDef<LaborSkuRow>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "hard", label: "Hard SKUs", match: (row) => row.hard },
];

const SKU_COLUMNS: DataColumn<LaborSkuRow>[] = [
  {
    id: "sku",
    header: "SKU",
    sortValue: (row) => row.sku,
    cell: (row) => <SkuCell sku={row.sku} name={row.name} to={`/stock/items/${row.itemId}`} />,
  },
  { id: "name", header: "Name", defaultHidden: true, sortValue: (row) => row.name, cell: (row) => row.name },
  {
    id: "complexity",
    header: "Complexity",
    align: "right",
    sortValue: (row) => row.complexity,
    csv: (row) => row.complexity.toFixed(1),
    cell: (row) => <span className="font-mono">{row.complexity.toFixed(1)}</span>,
  },
  { id: "units", header: "Units", align: "right", sortValue: (row) => row.units, cell: (row) => num(row.units) },
  { id: "handlers", header: "Handlers", align: "right", sortValue: (row) => row.handlers, cell: (row) => num(row.handlers) },
  {
    id: "pace",
    header: "Pace",
    align: "right",
    sortValue: (row) => row.pace,
    csv: (row) => formatPace(row.pace),
    cell: (row) => <Pace value={row.pace} />,
  },
  {
    id: "exceptions",
    header: "Exceptions",
    align: "right",
    sortValue: (row) => row.exceptionRate,
    csv: (row) => row.exceptionRate.toFixed(1),
    cell: (row) => <span className="font-mono">{row.exceptionRate.toFixed(1)}%</span>,
  },
  {
    id: "hard",
    header: "Flag",
    sortValue: (row) => row.hard,
    csv: (row) => (row.hard ? "hard" : ""),
    cell: (row) => (row.hard ? <ToneBadge tone="warning">Hard SKU</ToneBadge> : null),
  },
];

const MATRIX_FACETS: FacetDef<LaborMatrixCell>[] = [
  { id: "teammate", label: "Teammate", value: (cell) => cell.userName },
  { id: "sku", label: "SKU", value: (cell) => cell.sku },
];

const MATRIX_COLUMNS: DataColumn<LaborMatrixCell>[] = [
  {
    id: "teammate",
    header: "Teammate",
    sortValue: (cell) => cell.userName,
    cell: (cell) => (
      <span className="flex min-w-0 items-center gap-2">
        <PersonAvatar name={cell.userName} />
        <span className="truncate">{cell.userName}</span>
      </span>
    ),
  },
  {
    id: "sku",
    header: "SKU",
    sortValue: (cell) => cell.sku,
    cell: (cell) => (
      <Link className="font-mono hover:text-primary hover:underline" to={`/stock/items/${cell.itemId}`}>
        {cell.sku}
      </Link>
    ),
  },
  { id: "units", header: "Units", align: "right", sortValue: (cell) => cell.units, cell: (cell) => num(cell.units) },
  {
    id: "pace",
    header: "Pace",
    align: "right",
    sortValue: (cell) => cell.pace,
    csv: (cell) => formatPace(cell.pace),
    cell: (cell) => <Pace value={cell.pace} />,
  },
];

function LaborBoardPage() {
  const { warehouseId } = useWarehouse();
  const [preset, setPreset] = useState<Preset>("7d");
  const [view, setView] = useState("staff");
  const query = useApiQuery<LaborBoard>(`/api/labor${laborQuery(warehouseId, preset)}`, {
    placeholderData: (previous) => previous,
  });
  const board = query.data ?? null;
  const loading = query.isLoading;
  const hasMatrix = (board?.matrix.length ?? 0) > 0;
  const activeView = view === "matrix" && !hasMatrix ? "staff" : view;

  const tiles = [
    { label: "Lines", value: board ? board.team.lines : "—" },
    { label: "Units", value: board ? board.team.units : "—" },
    { label: "Pace", value: board ? formatPace(board.team.pace) : "—" },
    { label: "Exceptions", value: board ? `${board.team.exceptionRate.toFixed(1)}%` : "—" },
  ];

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Office"
        title="Performance"
        description="Staff pace against SKU difficulty and bay travel — 5 is on expected time, 10 is twice as fast, 0 is twice as slow. Slow SKUs are a process issue; slow operators on easy SKUs are coaching."
        actions={<LaborFilters preset={preset} onPreset={setPreset} />}
      />
      <ErrorBanner error={query.error?.message ?? null} />
      <StatStrip
        items={tiles.map((tile) => ({
          ...tile,
          tone: tile.label === "Exceptions" && (board?.team.exceptionRate ?? 0) > 0 ? "warn" : "default",
        }))}
      />
      {board ? <LaborCharts daily={board.daily} verbMix={board.verbMix} /> : null}

      <Tabs value={activeView} onValueChange={setView}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="staff">Staff{board ? ` (${board.staff.length})` : ""}</TabsTrigger>
          <TabsTrigger value="skus">SKUs{board ? ` (${board.skus.length})` : ""}</TabsTrigger>
          {hasMatrix ? <TabsTrigger value="matrix">Staff × SKU</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="staff">
          <DataTable
            id="labor-staff"
            paramPrefix="st_"
            data={board?.staff}
            loading={loading}
            columns={STAFF_COLUMNS}
            getRowId={(row) => row.userId}
            rowHref={(row) => `/labor/staff/${row.userId}`}
            facets={STAFF_FACETS}
            defaultSort={{ id: "units", desc: true }}
            search={{ placeholder: "Search teammate", text: (row) => `${row.userName} ${row.role}` }}
            exportName={`performance-staff-${preset}`}
            empty={
              <EmptyState
                icon={Gauge}
                title="No floor work in this window."
                body="Pace fills in as the team receives, picks, puts away, and counts on the floor."
                action={<LongerWindow preset={preset} onPreset={setPreset} />}
              />
            }
          />
        </TabsContent>

        <TabsContent value="skus">
          <DataTable
            id="labor-skus"
            paramPrefix="sk_"
            data={board?.skus}
            loading={loading}
            columns={SKU_COLUMNS}
            getRowId={(row) => row.itemId}
            rowHref={(row) => `/stock/items/${row.itemId}`}
            tabs={SKU_TABS}
            defaultTab="all"
            defaultSort={{ id: "units", desc: true }}
            search={{ placeholder: "Search SKU or name", text: (row) => `${row.sku} ${row.name}` }}
            exportName={`performance-skus-${preset}`}
            empty={
              <EmptyState
                icon={Gauge}
                title="No SKUs handled in this window."
                body="Each SKU the floor scans shows its difficulty and pace here."
                action={<LongerWindow preset={preset} onPreset={setPreset} />}
              />
            }
          />
        </TabsContent>

        {hasMatrix ? (
          <TabsContent value="matrix">
            <DataTable
              id="labor-matrix"
              paramPrefix="mx_"
              data={board?.matrix}
              loading={loading}
              columns={MATRIX_COLUMNS}
              getRowId={(cell) => `${cell.userId}:${cell.itemId}`}
              facets={MATRIX_FACETS}
              defaultSort={{ id: "units", desc: true }}
              search={{ placeholder: "Search teammate or SKU", text: (cell) => `${cell.userName} ${cell.sku}` }}
              exportName={`performance-staff-sku-${preset}`}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

const STAFF_SKU_COLUMNS: DataColumn<LaborSkuRow>[] = [
  {
    id: "sku",
    header: "SKU",
    sortValue: (row) => row.sku,
    cell: (row) => <SkuCell sku={row.sku} name={row.name} to={`/stock/items/${row.itemId}`} />,
  },
  { id: "units", header: "Units", align: "right", sortValue: (row) => row.units, cell: (row) => num(row.units) },
  {
    id: "pace",
    header: "Pace",
    align: "right",
    sortValue: (row) => row.pace,
    csv: (row) => formatPace(row.pace),
    cell: (row) => <Pace value={row.pace} />,
  },
  {
    id: "exceptions",
    header: "Exceptions",
    align: "right",
    sortValue: (row) => row.exceptionRate,
    csv: (row) => row.exceptionRate.toFixed(1),
    cell: (row) => <span className="font-mono">{row.exceptionRate.toFixed(1)}%</span>,
  },
];

const RECENT_FACETS: FacetDef<LaborDocumentRow>[] = [
  { id: "verb", label: "Verb", value: (row) => row.verb },
  { id: "refType", label: "Document", value: (row) => row.refType },
];

const RECENT_COLUMNS: DataColumn<LaborDocumentRow>[] = [
  {
    id: "when",
    header: "When",
    sortValue: (row) => row.createdAt,
    csv: (row) => new Date(row.createdAt).toISOString(),
    cell: (row) => <RelativeTime at={row.createdAt} />,
  },
  {
    id: "verb",
    header: "Verb",
    sortValue: (row) => row.verb,
    cell: (row) => <span className="font-mono text-xs uppercase">{row.verb}</span>,
  },
  { id: "sku", header: "SKU", sortValue: (row) => row.sku, cell: (row) => <span className="font-mono">{row.sku}</span> },
  { id: "qty", header: "Qty", align: "right", sortValue: (row) => row.qty, cell: (row) => num(row.qty) },
  {
    id: "ref",
    header: "Ref",
    sortValue: (row) => `${row.refType}/${row.refId}`,
    csv: (row) => `${row.refType}/${row.refId}`,
    cell: (row) => {
      const label = `${row.refType}/${row.refId.slice(0, 8)}`;
      const path = refPath(row.refType, row.refId);
      return path ? (
        <DocLink to={path} className="text-xs">
          {label}
        </DocLink>
      ) : (
        <Muted>{label}</Muted>
      );
    },
  },
];

function LaborStaffPage({ userId }: { userId: string }) {
  const { warehouseId } = useWarehouse();
  const [preset, setPreset] = useState<Preset>("7d");
  const query = useApiQuery<LaborStaffDetail & { range: LaborBoard["range"] }>(
    `/api/labor/staff/${encodeURIComponent(userId)}${laborQuery(warehouseId, preset)}`,
    { placeholderData: (previous) => (previous?.staff?.userId === userId ? previous : undefined) },
  );
  const detail = query.data ?? null;
  const staff = detail?.staff;

  return (
    <div className="space-y-(--density-gap)">
      <div className="space-y-1">
        <Breadcrumbs
          items={[{ label: "Office" }, { label: "Performance", to: "/labor" }, { label: staff?.userName ?? "Teammate" }]}
        />
        <PageHeader
          title={staff?.userName ?? (query.isLoading ? "Loading…" : "Teammate")}
          description={staff ? `${paceHint(staff.pace)}. Top SKUs and recent documents for this window.` : undefined}
          actions={<LaborFilters preset={preset} onPreset={setPreset} />}
        />
      </div>
      <ErrorBanner error={query.error?.message ?? null} />
      {staff ? (
        <StatStrip
          items={[
            { label: "Lines", value: staff.lines },
            { label: "Units", value: staff.units },
            { label: "Pace", value: formatPace(staff.pace) },
            {
              label: "Exceptions",
              value: `${staff.exceptionRate.toFixed(1)}%`,
              tone: staff.exceptionRate > 0 ? "warn" : "default",
            },
          ]}
        />
      ) : query.isLoading ? (
        <Skeleton className="h-14 w-full rounded-lg" />
      ) : null}
      {detail && !detail.skus.length && !detail.recent.length ? (
        <EmptyState
          icon={Gauge}
          title="No floor work in this window."
          body="This teammate's pace fills in once they scan on the floor."
          action={<LongerWindow preset={preset} onPreset={setPreset} />}
        />
      ) : null}
      {detail ? <LaborCharts daily={detail.daily} verbMix={detail.verbMix} /> : null}
      {detail?.skus.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">SKUs handled</h2>
          <DataTable
            id="labor-staff-skus"
            paramPrefix="sk_"
            data={detail.skus}
            columns={STAFF_SKU_COLUMNS}
            getRowId={(row) => row.itemId}
            rowHref={(row) => `/stock/items/${row.itemId}`}
            defaultSort={{ id: "units", desc: true }}
            search={{ placeholder: "Search SKU", text: (row) => `${row.sku} ${row.name}` }}
            exportName={`performance-${staff?.userName ?? "teammate"}-skus`}
          />
        </section>
      ) : null}
      {detail?.recent.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Recent documents</h2>
          <DataTable
            id="labor-staff-recent"
            paramPrefix="rd_"
            data={detail.recent}
            columns={RECENT_COLUMNS}
            getRowId={(row) => `${row.refId}:${row.createdAt}:${row.sku}:${row.verb}`}
            rowHref={(row) => refPath(row.refType, row.refId)}
            facets={RECENT_FACETS}
            defaultSort={{ id: "when", desc: true }}
            search={{
              placeholder: "Search SKU or document",
              text: (row) => `${row.sku} ${row.verb} ${row.refType} ${row.refId}`,
            }}
            exportName={`performance-${staff?.userName ?? "teammate"}-recent`}
          />
        </section>
      ) : null}
    </div>
  );
}

export function SkuHandlers({ itemId, linkStaff = true }: { itemId: string; linkStaff?: boolean }) {
  const { warehouseId } = useWarehouse();
  const [detail, setDetail] = useState<(LaborSkuDetail & { range?: LaborBoard["range"] }) | null>(null);

  useEffect(() => {
    api<LaborSkuDetail & { range: LaborBoard["range"] }>(
      `/api/labor/skus/${encodeURIComponent(itemId)}${laborQuery(warehouseId, "30d")}`,
    )
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
            <td>
              {linkStaff ? (
                <Link className="hover:underline" to={`/labor/staff/${row.userId}`}>
                  {row.userName}
                </Link>
              ) : (
                row.userName
              )}
            </td>
            <td className="font-mono tabular-nums">{row.lines}</td>
            <td className="font-mono tabular-nums">{row.units}</td>
            <td className="font-mono tabular-nums">{formatPace(row.pace)}</td>
            <td className="font-mono tabular-nums">{row.exceptionRate.toFixed(1)}%</td>
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
        {row.lines} {row.lines === 1 ? "line" : "lines"} · {row.units} {row.units === 1 ? "unit" : "units"} · pace{" "}
        {formatPace(row.pace)}
      </p>
      <p className="text-xs text-muted-foreground">
        {paceHint(row.pace)}
        {row.exceptionUnits ? ` · ${row.exceptionUnits} exception units` : ""}
      </p>
    </div>
  );
}
