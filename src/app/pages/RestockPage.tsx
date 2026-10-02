import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FilePlus2, PackagePlus } from "lucide-react";
import { api } from "../api";
import { Button, EmptyState, ErrorBanner, PageHeader, ToneBadge } from "../components/ui";
import { DataTable, type DataColumn, type TabDef } from "../components/data-table/DataTable";
import { Muted } from "../components/cells";
import { Term } from "../components/term";
import { useApiQuery, refreshApi } from "../query";
import { useWrite } from "../use-write";
import { useWarehouse } from "../warehouse";
import { ASN_MILESTONE_LABELS, freightIsLate, isAsnMilestone, timelineFraction } from "@/domain/restock";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type RestockRow = {
  itemId: string;
  sku: string;
  name: string;
  pool: "house" | "client";
  poolKey: string;
  poolLabel: string;
  clientId: string | null;
  vendorName: string | null;
  makeDays: number;
  transitDays: number;
  leadDays: number;
  learned: boolean;
  rate: number;
  daysOfCover: number | null;
  suggestedQty: number;
  orderByAt: number | null;
  stockoutAt: number | null;
  due: boolean;
  gap: "make" | "transit";
  purchaseId: string | null;
  purchaseNumber: string | null;
  asnId: string | null;
  asnNumber: string | null;
  asnMilestone: string | null;
  freightAt: number | null;
};

type RestockBoard = { policy: "off" | "alert" | "draft"; rows: RestockRow[] };
type Chip = "all" | "due" | "water" | "house" | "client";

function formatRate(value: number) {
  if (!value) return "0";
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function formatWhen(at: number | null) {
  if (at == null) return "—";
  return new Date(at).toISOString().slice(0, 10);
}

function formatDays(value: number | null) {
  if (value == null) return "180d+";
  return `${value.toFixed(0)}d`;
}

function milestoneLabel(value: string | null) {
  if (!value) return null;
  return isAsnMilestone(value) ? ASN_MILESTONE_LABELS[value] : value;
}

function matchesChip(row: RestockRow, chip: Chip) {
  if (chip === "due") return row.due;
  if (chip === "water") return row.asnMilestone === "on_water";
  if (chip === "house") return row.pool === "house";
  if (chip === "client") return row.pool === "client";
  return true;
}

function summary(rows: RestockRow[], now: number) {
  const due = rows.filter((row) => row.due).length;
  const water = rows.filter((row) => row.asnMilestone === "on_water").length;
  const next = rows
    .map((row) => row.freightAt)
    .filter((at): at is number => at != null && at >= now)
    .sort((a, b) => a - b)[0];
  const order =
    due === 0 ? "Nothing to order today." : due === 1 ? "1 SKU to order now." : `${due} SKUs to order now.`;
  const sea = water === 0 ? "None on the water." : water === 1 ? "1 on the water." : `${water} on the water.`;
  const arrival = next == null ? "No arrival dated." : `Next arrival ${formatWhen(next)}.`;
  return `${order} ${sea} ${arrival}`;
}

const TABS: TabDef<RestockRow>[] = [
  { id: "all", label: "All", match: () => true },
  { id: "due", label: "Order now", match: (row) => row.due },
  { id: "house", label: "Your stock", match: (row) => row.pool === "house" },
  { id: "client", label: "Client stock", match: (row) => row.pool === "client" },
];

const COLUMNS: DataColumn<RestockRow>[] = [
  {
    id: "sku",
    header: "SKU",
    sortValue: (row) => row.sku,
    cell: (row) => (
      <span>
        <span className="font-mono">{row.sku}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{row.name}</span>
      </span>
    ),
  },
  {
    id: "pool",
    header: "Pool",
    sortValue: (row) => row.poolLabel,
    cell: (row) => (row.pool === "house" ? "Your stock" : row.poolLabel),
  },
  {
    id: "rate",
    header: "Burn / day",
    align: "right",
    sortValue: (row) => row.rate,
    cell: (row) => <span className="font-mono">{formatRate(row.rate)}</span>,
  },
  {
    id: "cover",
    header: "Cover",
    align: "right",
    sortValue: (row) => row.daysOfCover ?? 9999,
    cell: (row) => <span className="font-mono">{formatDays(row.daysOfCover)}</span>,
  },
  {
    id: "orderBy",
    header: "Order by",
    sortValue: (row) => row.orderByAt ?? Number.MAX_SAFE_INTEGER,
    cell: (row) =>
      row.due ? (
        <ToneBadge tone="warning">{formatWhen(row.orderByAt)}</ToneBadge>
      ) : (
        <span className="font-mono">{formatWhen(row.orderByAt)}</span>
      ),
  },
  {
    id: "qty",
    header: "Suggest",
    align: "right",
    sortValue: (row) => row.suggestedQty,
    cell: (row) => (row.suggestedQty > 0 ? <span className="font-mono">{row.suggestedQty}</span> : <Muted>—</Muted>),
  },
  {
    id: "lead",
    header: "Lead",
    sortValue: (row) => row.leadDays,
    cell: (row) => (
      <span className="whitespace-nowrap text-sm">
        {row.makeDays}d make · {row.transitDays}d {row.learned ? "learned" : "default"}
      </span>
    ),
  },
  {
    id: "purchase",
    header: "Purchase",
    sortValue: (row) => row.purchaseNumber ?? "",
    cell: (row) =>
      row.purchaseId ? (
        <Link className="font-mono underline" to={`/inbound/purchases/${row.purchaseId}`}>
          {row.purchaseNumber}
        </Link>
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: "freight",
    header: "Freight",
    sortValue: (row) => row.freightAt ?? 0,
    cell: (row) =>
      row.asnId ? (
        <Link className="underline" to={`/inbound/asns/${row.asnId}`}>
          <span className="font-mono">{row.asnNumber}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {milestoneLabel(row.asnMilestone) ?? "No milestone"}
            {row.freightAt ? ` · ${formatWhen(row.freightAt)}` : ""}
          </span>
        </Link>
      ) : (
        <Muted>—</Muted>
      ),
  },
];

const CHIPS: { id: Chip; label: string }[] = [
  { id: "all", label: "All" },
  { id: "due", label: "Order now" },
  { id: "water", label: "On the water" },
  { id: "house", label: "Your stock" },
  { id: "client", label: "Client stock" },
];

export function RestockPage() {
  const { warehouseId } = useWarehouse();
  const draft = useWrite();
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [chip, setChip] = useState<Chip>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const query = useApiQuery<RestockBoard>(
    warehouseId ? `/api/restock?warehouseId=${encodeURIComponent(warehouseId)}` : null,
  );
  const board = query.data;
  const now = Date.now();
  const rows = board?.rows ?? [];
  const visible = useMemo(() => rows.filter((row) => matchesChip(row, chip)), [rows, chip]);
  const selected = rows.find((row) => `${row.itemId}:${row.poolKey}` === selectedKey) ?? null;
  const due = rows.filter((row) => row.due).length;

  async function draftPurchases() {
    if (!warehouseId) return;
    const created = await draft.run(
      "Draft purchases",
      () =>
        api<{ created: number }>("/api/restock/draft", {
          method: "POST",
          body: JSON.stringify({ warehouseId }),
        }),
      (result) =>
        result.created
          ? `Drafted ${result.created} ${result.created === 1 ? "purchase" : "purchases"}. Nothing was sent.`
          : "Nothing new to draft.",
    );
    if (created) void refreshApi("/api/restock");
  }

  return (
    <div className="space-y-(--density-gap)">
      <PageHeader
        eyebrow="Analytics"
        title="Restock"
        description={
          <>
            When to order each SKU so it arrives before <Term id="runway">runway</Term> runs out. Your stock and each{" "}
            <Term id="3pl-client">3PL client</Term> are separate. A draft purchase is not sent.
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={view === "timeline" ? "primary" : "outline"} onClick={() => setView("timeline")}>
              Timeline
            </Button>
            <Button size="sm" variant={view === "list" ? "primary" : "outline"} onClick={() => setView("list")}>
              List
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/analytics/runway">Runway</Link>
            </Button>
            <Button size="sm" disabled={draft.busy || due === 0} onClick={() => void draftPurchases()}>
              <FilePlus2 className="size-4" />
              {draft.busy ? "Drafting…" : due ? `Draft purchases (${due})` : "Draft purchases"}
            </Button>
          </div>
        }
      />
      <ErrorBanner error={query.error?.message ?? draft.error} />
      {board ? <p className="text-sm text-muted-foreground">{summary(rows, now)}</p> : null}
      {board?.policy === "off" ? (
        <p className="text-sm text-muted-foreground">
          Alerts are off. The board still shows the forecast. Turn alerts or drafts on in Settings → Warehouse.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={chip === item.id ? "primary" : "outline"}
            aria-pressed={chip === item.id}
            onClick={() => setChip(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {view === "timeline" ? (
        <Timeline
          rows={visible}
          loading={query.isLoading}
          now={now}
          onOpen={(row) => setSelectedKey(`${row.itemId}:${row.poolKey}`)}
        />
      ) : (
        <DataTable
          id="restock"
          data={visible}
          loading={query.isLoading}
          columns={COLUMNS}
          getRowId={(row) => `${row.itemId}:${row.poolKey}`}
          tabs={TABS}
          defaultTab="all"
          defaultSort={{ id: "orderBy", desc: false }}
          search={{
            placeholder: "Search SKU, pool, vendor",
            text: (row) => [row.sku, row.name, row.poolLabel, row.vendorName].filter(Boolean).join(" "),
          }}
          exportName="restock"
          empty={
            <EmptyState
              icon={PackagePlus}
              title="Nothing is burning yet."
              body="Ship a few orders, or set a vendor transit lane, and this board fills in from the last 30 days."
            />
          }
        />
      )}
      <Sheet open={selected != null} onOpenChange={(open) => (open ? null : setSelectedKey(null))}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {selected ? (
            <RestockSheet row={selected} busy={draft.busy} onDraft={() => void draftPurchases()} />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Timeline({
  rows,
  loading,
  now,
  onOpen,
}: {
  rows: RestockRow[];
  loading: boolean;
  now: number;
  onOpen: (row: RestockRow) => void;
}) {
  if (loading && rows.length === 0) return <p className="text-sm text-muted-foreground">Loading the forecast…</p>;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={PackagePlus}
        title="Nothing is burning yet."
        body="Ship a few orders, or set a vendor transit lane, and this board fills in from the last 30 days."
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Today</span>
        <span>120 days</span>
      </div>
      {rows.map((row) => (
        <TimelineRow key={`${row.itemId}:${row.poolKey}`} row={row} now={now} onOpen={onOpen} />
      ))}
    </div>
  );
}

function TimelineRow({ row, now, onOpen }: { row: RestockRow; now: number; onOpen: (row: RestockRow) => void }) {
  const order = timelineFraction(row.due ? now : row.orderByAt, now);
  const arrive = timelineFraction(row.freightAt, now);
  const out = timelineFraction(row.stockoutAt, now);
  const late = freightIsLate(row.freightAt, row.stockoutAt);
  const pool = row.pool === "house" ? "Your stock" : row.poolLabel;
  const orderWords = row.due ? "Order now" : row.orderByAt ? `Order ${formatWhen(row.orderByAt)}` : "No order date";
  const freightWords = row.asnId
    ? `${milestoneLabel(row.asnMilestone) ?? "Freight"}${row.freightAt ? ` ${formatWhen(row.freightAt)}` : ""}`
    : "No freight yet";
  const outWords = row.stockoutAt ? `Runs out ${formatWhen(row.stockoutAt)}` : "Cover holds";
  const words = [orderWords, freightWords, outWords];
  if (late) words.push("Arrives after it runs out");
  return (
    <button
      type="button"
      className="w-full rounded-lg border bg-card p-3 text-left hover:bg-accent/40"
      onClick={() => onOpen(row)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-sm">{row.sku}</span>
        <span className="truncate text-xs text-muted-foreground">{pool}</span>
      </div>
      <div className="relative mt-5 h-2 rounded-full bg-muted">
        {late && out != null && arrive != null ? (
          <span
            className="absolute top-0 h-2 rounded-full bg-destructive/70"
            style={{ left: `${out * 100}%`, width: `${Math.max(0, (arrive - out) * 100)}%` }}
          />
        ) : null}
        <Mark at={order} label={row.due ? "Order now" : "Order"} warn={row.due} />
        <Mark at={arrive} label="Arrive" warn={late} />
        <Mark at={out} label="Runs out" warn={late} />
      </div>
      <p className={cn("mt-3 text-xs text-muted-foreground", late && "text-destructive")}>
        {words.join(". ")}.
      </p>
    </button>
  );
}

function Mark({ at, label, warn }: { at: number | null; label: string; warn?: boolean }) {
  if (at == null) return null;
  return (
    <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${at * 100}%` }} title={label}>
      <span className={cn("block size-3 rounded-full border-2 border-background", warn ? "bg-destructive" : "bg-foreground")} />
    </span>
  );
}

function RestockSheet({ row, busy, onDraft }: { row: RestockRow; busy: boolean; onDraft: () => void }) {
  const pool = row.pool === "house" ? "your stock" : row.poolLabel;
  const late = freightIsLate(row.freightAt, row.stockoutAt);
  return (
    <div className="space-y-4">
      <SheetTitle className="font-mono">{row.sku}</SheetTitle>
      <SheetDescription>
        {row.name}. This row is {pool}. It burns {formatRate(row.rate)} a day and has {formatDays(row.daysOfCover)} of cover.
      </SheetDescription>
      <p className="text-sm">
        {row.makeDays} days to make it, then {row.transitDays} days in transit ({row.learned ? "learned from arrivals" : "the default"}).
        {row.due ? " Order it now." : row.orderByAt ? ` Order by ${formatWhen(row.orderByAt)}.` : ""}
        {row.suggestedQty > 0 ? ` Suggest ${row.suggestedQty}.` : ""}
      </p>
      {row.purchaseId ? (
        <Button size="sm" variant="outline" asChild>
          <Link to={`/inbound/purchases/${row.purchaseId}`}>Open {row.purchaseNumber}</Link>
        </Button>
      ) : row.due ? (
        <Button size="sm" disabled={busy} onClick={onDraft}>
          <FilePlus2 className="size-4" />
          Draft purchase
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">No purchase yet. Nothing is due.</p>
      )}
      {row.asnId ? (
        <div className="space-y-2 text-sm">
          <p>
            {row.asnNumber} is {milestoneLabel(row.asnMilestone) ?? "not milestoned"}.
            {row.freightAt ? ` It arrives ${formatWhen(row.freightAt)}.` : ""}
            {late ? " That is after the shelf runs out." : ""}
          </p>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/inbound/asns/${row.asnId}`}>Open ASN</Link>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No freight yet.</p>
      )}
    </div>
  );
}
