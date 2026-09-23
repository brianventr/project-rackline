import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import NumberFlow from "@number-flow/react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  Boxes,
  ChevronDown,
  Clock,
  Factory,
  Hourglass,
  LayoutGrid,
  Loader2,
  Pin,
  PinOff,
  RefreshCw,
  Repeat,
  Send,
  ShieldAlert,
  Truck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api, errorText, type Dashboard, type FloorJob, type Purchase, type TeamMember } from "../api";
import { EmptyState, ErrorBanner, PageHeader, StatusBadge, ToneBadge } from "../components/ui";
import { PersonAvatar } from "../components/cells";
import { OnboardingChecklist } from "../components/onboarding";
import { Term } from "../components/term";
import { useWarehouse } from "../warehouse";
import { useSession } from "../session";
import { useDashboard } from "../dashboard";
import { refreshApi, useApiQuery } from "../query";
import { statusLabel } from "@/domain/status";
import { formatCountVariance } from "@/domain/blind-count";
import { formatExpiresOn } from "@/domain/expiry";
import { desiredVerb } from "@/domain/jobs";
import { DEFAULT_JOB_REASON } from "@/domain/job-rank";
import { ageInDays, relativeTime } from "@/domain/relative-time";
import { jobForRef, jobForSuggestion } from "../jobs";
import { cn } from "@/lib/utils";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";
import { formatPickupLabel, type PromiseBoard } from "@/domain/promise";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

const LANES = ["inbound", "outbound", "make", "stock", "exceptions"] as const;
type LaneId = (typeof LANES)[number];

const LANE_LABEL: Record<LaneId, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
  make: "Make",
  stock: "Stock",
  exceptions: "Exceptions",
};

const LANE_ICON: Record<LaneId, LucideIcon> = {
  inbound: ArrowDownToLine,
  outbound: Send,
  make: Factory,
  stock: Boxes,
  exceptions: AlertTriangle,
};

const LANE_NEXT: Record<LaneId, string> = {
  inbound: "Receive a purchase or receipt onto the dock.",
  outbound: "Open orders stay on the floor until someone picks them.",
  make: "Start a kit or work order when a recipe is ready.",
  stock: "Scan a bay to start a count, or wait for replenishment.",
  exceptions: "Tracker exceptions and posted variances show up here.",
};

const GARAGE_LANE_NEXT: Record<LaneId, string> = {
  inbound: "Buy parts or receive a box onto the bench.",
  outbound: "Orders wait here until you pick, pack, and ship them.",
  make: "Start a kit or a build when the recipe is ready.",
  stock: "The shelf is quiet. On-hand and runway live with your parts.",
  exceptions: "A label that bounced shows up here.",
};

type LaneAction = { label: string; to: string } | null;

/** What an empty lane offers next. Links only; each page keeps its own create button and gating. */
const LANE_ACTION: Record<LaneId, LaneAction> = {
  inbound: { label: "Open receipts", to: "/inbound/receipts" },
  outbound: { label: "New order", to: "/outbound/orders?new=1" },
  make: { label: "Open work orders", to: "/make/work-orders" },
  stock: { label: "Count a bay", to: "/floor/count" },
  exceptions: null,
};

const GARAGE_LANE_ACTION: Record<LaneId, LaneAction> = {
  inbound: { label: "Buy parts", to: "/inbound/purchases" },
  outbound: { label: "New order", to: "/outbound/orders?new=1" },
  make: { label: "Open builds", to: "/make/work-orders" },
  stock: { label: "Open on hand", to: "/stock" },
  exceptions: null,
};

type WorkRow = {
  id: string;
  lane: LaneId;
  queue: string;
  to: string;
  title: string;
  meta: string;
  status: string;
  actionTo: string;
  action: string;
  createdAt?: number;
  job?: FloorJob;
  relabel?: { orderId: string; packageId?: string };
};

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short" });

export function TodayPage() {
  const { warehouseId } = useWarehouse();
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  const navigate = useNavigate();
  const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
  const dashboard = useDashboard();
  const jobsQuery = useApiQuery<FloorJob[]>(`/api/jobs${query}${query ? "&" : "?"}open=1`, { refetchInterval: 60_000 });
  const teamQuery = useApiQuery<TeamMember[]>("/api/team");
  const promiseQuery = useApiQuery<PromiseBoard>(
    warehouseId ? `/api/analytics/promises?warehouseId=${encodeURIComponent(warehouseId)}` : null,
    { refetchInterval: 60_000 },
  );
  const promise = promiseQuery.data ?? null;
  const data = dashboard.data ?? null;
  const jobs = jobsQuery.data ?? EMPTY_JOBS;
  const team = teamQuery.data ?? EMPTY_TEAM;
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [lane, setLane] = useState<LaneId>("inbound");

  async function write(fallback: string, run: () => Promise<unknown>, success?: string) {
    setError(null);
    try {
      await run();
      await refreshApi();
      if (success) toast.success(success);
    } catch (err) {
      setError(errorText(err, fallback));
    }
  }

  const assign = (jobId: string, userId: string | null, name?: string) =>
    write(
      "Could not assign the job.",
      () => api(`/api/jobs/${jobId}/assign`, { method: "POST", body: JSON.stringify({ userId }) }),
      userId ? `Assigned to ${name ?? "teammate"}.` : "Left unassigned. The next scan claims it.",
    );

  const pin = (jobId: string, pinned: boolean) =>
    write(
      "Could not pin the job.",
      () => api(`/api/jobs/${jobId}/pin`, { method: "POST", body: JSON.stringify({ pinned }) }),
      pinned ? "Pinned to the top of the floor queue." : "Unpinned.",
    );

  const relabelTracker = (row: WorkRow) =>
    write(
      "Could not buy a replacement label.",
      () => {
        if (!row.relabel) return Promise.resolve();
        const path = row.relabel.packageId
          ? `/api/orders/${row.relabel.orderId}/packages/${row.relabel.packageId}/relabel`
          : `/api/orders/${row.relabel.orderId}/relabel`;
        return api(path, { method: "POST" });
      },
      "Replacement label bought.",
    );

  async function draftReorderPo() {
    if (!warehouseId) {
      setError("Pick a warehouse before you draft a PO.");
      return;
    }
    setError(null);
    setDrafting(true);
    try {
      const created = await api<Purchase>("/api/purchases/from-reorder", {
        method: "POST",
        body: JSON.stringify({ warehouseId }),
      });
      toast.success(`Drafted ${created.number}.`);
      void refreshApi();
      navigate(`/inbound/purchases/${created.id}`);
    } catch (err) {
      setError(errorText(err, "Could not draft the PO."));
    } finally {
      setDrafting(false);
    }
  }

  const rows = useMemo(() => {
    const built = buildRows(data, jobs);
    if (!garage) return built;
    return built.filter((row) => garageAllowsPath(row.to) && garageAllowsPath(row.actionTo));
  }, [data, jobs, garage]);
  const laneRows = useMemo(
    () =>
      rows
        .filter((row) => row.lane === lane)
        .sort((a, b) => (b.job?.score ?? -1) - (a.job?.score ?? -1) || (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    [rows, lane],
  );
  const laneCounts = useMemo(() => {
    const counts = { inbound: 0, outbound: 0, make: 0, stock: 0, exceptions: 0 };
    for (const row of rows) counts[row.lane] += 1;
    return counts;
  }, [rows]);
  const laneNext = garage ? GARAGE_LANE_NEXT : LANE_NEXT;
  const laneAction = (garage ? GARAGE_LANE_ACTION : LANE_ACTION)[lane];
  const trend = data?.trend ?? [];
  const loading = dashboard.isLoading;

  const allow = (to: string) => !garage || garageAllowsPath(to);
  const exceptions = laneCounts.exceptions + (data?.countVariances ?? 0) + (data?.openHolds ?? 0);

  const headline: HeadlineProps[] = [
    {
      label: "To receive",
      value: data ? data.openReceipts + data.openPurchases + (garage ? 0 : (data.openAsns ?? 0)) : null,
      to: "/inbound/purchases",
      icon: ArrowDownToLine,
      trend: trend.map((day) => day.received),
      trendUnit: "units received",
      days: trend.map((day) => day.start),
    },
    {
      label: "To put away",
      value: data ? data.openTransfers + (data.putawayDue ?? 0) : null,
      to: "/floor/putaway",
      icon: Repeat,
      note: data?.putawayDue ? `${data.putawayDue} waiting on the dock` : "Dock is clear",
    },
    {
      label: "To fulfill",
      value: data?.openOrders ?? null,
      to: "/outbound/orders",
      icon: Truck,
      trend: trend.map((day) => day.shipped),
      trendUnit: "units shipped",
      days: trend.map((day) => day.start),
    },
    ...(data && (data.openWorkOrders || data.openKits || trend.some((day) => day.built))
      ? [
          {
            label: "To make",
            value: data.openWorkOrders + (data.openKits ?? 0),
            to: "/make/work-orders",
            icon: Factory,
            trend: trend.map((day) => day.built),
            trendUnit: "units built",
            days: trend.map((day) => day.start),
          },
        ]
      : []),
    {
      label: "Needs attention",
      value: data ? exceptions : null,
      to: "/today",
      onClick: () => setLane("exceptions"),
      icon: ShieldAlert,
      tone: exceptions > 0 ? ("warning" as const) : ("default" as const),
      note:
        data && exceptions
          ? [
              laneCounts.exceptions ? `${laneCounts.exceptions} exceptions` : null,
              data.countVariances ? `${data.countVariances} variances` : null,
              data.openHolds ? `${data.openHolds} on hold` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : "Nothing flagged",
    },
  ].filter((item) => allow(item.to));

  const moreStats = [
    { label: "Yard", value: data?.openYard, to: "/inbound/yard" },
    { label: "Vendor RTV", value: data?.openVendorReturns, to: "/inbound/vendor-returns" },
    { label: "Waves", value: data?.openWaves, to: "/outbound/waves" },
    { label: "To replenish", value: data ? (data.replenishDue ?? 0) + (data.openReplenishments ?? 0) : undefined, to: "/stock/replenish" },
    { label: "Count variance", value: data?.countVariances, to: "/stock/counts" },
    { label: "On hold", value: data?.openHolds, to: "/stock/holds" },
    { label: "Allocated units", value: data?.allocatedUnits, to: "/outbound/orders" },
    { label: "Expiring lots", value: data?.expiringLots, to: "/stock" },
    { label: "Checked out", value: data?.openCheckouts, to: "/equipment" },
    { label: "Out of service", value: data?.outOfService, to: "/equipment" },
    { label: "Certs due", value: data?.expiringCerts, to: "/setup/team" },
    { label: "Runs out this week", value: data?.runwayThisWeek?.length, to: "/analytics/runway" },
    { label: "This pickup", value: promise?.kpis.leavesToday, to: "/analytics/promise" },
    { label: "On hand units", value: data?.onHandUnits, to: "/stock" },
    { label: "SKUs", value: data?.skuCount, to: "/stock/items" },
  ].filter((item) => allow(item.to));

  return (
    <div className="flex flex-col gap-(--density-gap)">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          eyebrow={garage ? "Garage Mode" : new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}
          title={greeting(me.user.name)}
          description={
            garage ? (
              "Founder bench for today: receive, make, pick, and ship."
            ) : (
              <>
                Assign floor <Term id="job">jobs</Term>, or leave them unassigned so the next scan claims them.
              </>
            )
          }
        />
        <div className="flex items-center gap-2">
          <UpdatedAgo at={dashboard.dataUpdatedAt} />
          <Button
            size="sm"
            variant="outline"
            aria-label="Refresh"
            disabled={dashboard.isFetching}
            onClick={() => void refreshApi()}
          >
            <RefreshCw className={cn(dashboard.isFetching && "animate-spin")} />
          </Button>
          <MoreMetrics stats={moreStats} />
        </div>
      </div>

      {me.role === "owner" ? <OnboardingChecklist /> : null}

      <ErrorBanner error={error ?? dashboard.error?.message ?? null} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
        {headline.map((item) => (
          <HeadlineCard key={item.label} {...item} loading={loading} />
        ))}
      </div>

      <div className="grid min-h-0 gap-(--density-gap) xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 rounded-lg border bg-card shadow-xs" aria-label="Work queue">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <div role="tablist" aria-label="Lane" className="flex max-w-full items-center gap-0.5 overflow-x-auto">
              {LANES.map((id) => {
                const Icon = LANE_ICON[id];
                const active = lane === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setLane(id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
                      active && "bg-muted text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {LANE_LABEL[id]}
                    <span
                      className={cn(
                        "min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums",
                        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                        id === "exceptions" && laneCounts.exceptions > 0 && !active && "bg-tone-warning-bg text-tone-warning",
                      )}
                    >
                      {laneCounts[id]}
                    </span>
                  </button>
                );
              })}
            </div>
            <Link to="/floor" className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Open the floor →
            </Link>
          </div>
          {loading ? (
            <ul className="divide-y">
              {Array.from({ length: 5 }, (_, index) => (
                <li key={index} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                  <Skeleton className="h-7 w-20" />
                </li>
              ))}
            </ul>
          ) : laneRows.length ? (
            <ul className="divide-y">
              {laneRows.map((row) => (
                <QueueRow
                  key={row.id}
                  row={row}
                  team={team}
                  garage={garage}
                  owner={me.role === "owner"}
                  onAssign={assign}
                  onPin={pin}
                  onRelabel={relabelTracker}
                />
              ))}
            </ul>
          ) : (
            <div className="p-4">
              <EmptyState
                icon={LANE_ICON[lane]}
                title={`Nothing in ${LANE_LABEL[lane].toLowerCase()} right now.`}
                body={laneNext[lane]}
                action={
                  laneAction && allow(laneAction.to) ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={laneAction.to}>{laneAction.label}</Link>
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
        </section>

        <aside className="grid content-start gap-(--density-gap) md:grid-cols-2 xl:grid-cols-1">
          <RailCard
            title="Below reorder"
            icon={Boxes}
            action={
              <Button
                size="sm"
                variant="outline"
                disabled={drafting || !data?.lowStock.length}
                onClick={() => void draftReorderPo()}
              >
                {drafting ? <Loader2 className="animate-spin" /> : null}
                Draft PO
              </Button>
            }
            empty={
              <RailEmpty
                icon={Boxes}
                title="No SKUs at reorder."
                body={
                  <>
                    A SKU joins this list when on hand falls to its <Term id="reorder-point">reorder point</Term>.
                  </>
                }
              />
            }
            loading={loading}
          >
            {(data?.lowStock ?? []).slice(0, 6).map((row) => (
              <MeterRow
                key={row.itemId}
                to={`/stock/items/${row.itemId}`}
                label={row.sku}
                value={`${row.onHand} / ${row.reorderPoint}`}
                fraction={row.reorderPoint > 0 ? row.onHand / row.reorderPoint : 0}
                tone={row.onHand <= 0 ? "danger" : "warning"}
                note={row.coveredByOpenPo ? "Open PO" : row.suggestedQty ? `Order ${row.suggestedQty}` : undefined}
              />
            ))}
          </RailCard>
          {allow("/analytics/promise") ? (
            <RailCard
              title="Promise"
              icon={Clock}
              action={
                <Link className="text-sm font-medium text-muted-foreground hover:text-foreground" to="/analytics/promise">
                  Promise →
                </Link>
              }
              empty={
                <RailEmpty
                  icon={Clock}
                  title="Every open order leaves on the next pickup."
                  body={
                    <>
                      Orders that miss the next <Term id="cutoff">carrier pickup</Term> or wait on stock show up here.
                    </>
                  }
                />
              }
              loading={promiseQuery.isLoading}
            >
              {(promise?.orders ?? [])
                .filter((row) => row.code !== "leaves_today")
                .slice(0, 6)
                .map((row) => (
                  <Link
                    key={row.orderId}
                    to={`/outbound/orders/${row.orderId}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-mono">{row.number}</span>{" "}
                      <span className="text-muted-foreground">{row.customerName}</span>
                    </span>
                    {row.code === "short" ? (
                      <ToneBadge tone="danger">Short</ToneBadge>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {row.waitingOn
                          ? row.waitingOn
                          : row.promisedAt
                            ? formatPickupLabel(row.promisedAt, promise?.timeZone ?? "UTC")
                            : "—"}
                      </span>
                    )}
                  </Link>
                ))}
            </RailCard>
          ) : null}
          <RailCard
            title="Runs out this week"
            icon={Hourglass}
            action={
              <Link className="text-sm font-medium text-muted-foreground hover:text-foreground" to="/analytics/runway">
                Runway →
              </Link>
            }
            empty={
              <RailEmpty
                icon={Hourglass}
                title="No SKUs run out in 7 days."
                body="SKUs with less than a week of cover show up here, with a qty to order."
              />
            }
            loading={loading}
          >
            {(data?.runwayThisWeek ?? []).slice(0, 6).map((row) => (
              <MeterRow
                key={row.itemId}
                to={`/stock/items/${row.itemId}`}
                label={row.sku}
                value={row.daysOfCover != null ? `${row.daysOfCover.toFixed(1)} days` : "Out"}
                fraction={row.daysOfCover != null ? row.daysOfCover / 7 : 0}
                tone={row.daysOfCover == null || row.daysOfCover < 2 ? "danger" : "warning"}
                note={row.coveredByOpenPo ? "Open PO" : row.suggestedQty ? `Order ${row.suggestedQty}` : undefined}
              />
            ))}
          </RailCard>
          {garage ? null : (
            <RailCard
              title="Busiest bays"
              icon={LayoutGrid}
              action={
                <Link className="text-sm font-medium text-muted-foreground hover:text-foreground" to="/map">
                  Map →
                </Link>
              }
              empty={
                <RailEmpty
                  icon={LayoutGrid}
                  title="No occupied bays."
                  body="The bays holding the most units show up here once stock is put away."
                />
              }
              loading={loading}
            >
              {(data?.hotBays ?? []).map((row) => (
                <MeterRow
                  key={row.locationId}
                  to={`/map?location=${row.locationId}`}
                  label={row.locationCode}
                  value={`${row.units} units`}
                  fraction={row.units / Math.max(1, ...(data?.hotBays ?? []).map((bay) => bay.units))}
                  tone="info"
                />
              ))}
            </RailCard>
          )}
          <RailCard
            title="Recent activity"
            icon={Repeat}
            empty={
              <RailEmpty
                icon={Repeat}
                title="No ledger activity yet."
                body="Every receive, pick, move, and count posts here as it happens."
              />
            }
            loading={loading}
          >
            {(data?.recent ?? []).slice(0, 6).map((row) => (
              <Link
                key={row.id}
                to="/stock/ledger"
                className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/60"
              >
                <span className="min-w-0 truncate">
                  <span className="capitalize text-muted-foreground">{statusLabel(row.type)}</span>{" "}
                  <span className="font-mono">{Math.abs(row.qty)}</span> × <span className="font-mono">{row.sku}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(row.createdAt)}</span>
              </Link>
            ))}
          </RailCard>
        </aside>
      </div>
    </div>
  );
}

const EMPTY_JOBS: FloorJob[] = [];
const EMPTY_TEAM: TeamMember[] = [];

function greeting(name: string): string {
  const hour = new Date().getHours();
  const first = name.split(/\s+/)[0] || "there";
  if (hour < 12) return `Good morning, ${first}`;
  if (hour < 18) return `Good afternoon, ${first}`;
  return `Good evening, ${first}`;
}

function UpdatedAgo({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 5_000);
    return () => window.clearInterval(id);
  }, []);
  if (!at) return null;
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  return (
    <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">
      Updated {seconds < 5 ? "just now" : seconds < 60 ? `${seconds}s ago` : relativeTime(at)}
    </span>
  );
}

type HeadlineProps = {
  label: string;
  value: number | null;
  to: string;
  icon: LucideIcon;
  onClick?: () => void;
  tone?: "default" | "warning";
  trend?: number[];
  trendUnit?: string;
  days?: number[];
  note?: string;
  loading?: boolean;
};

/** Stat tile: label, value, and either a 7-day sparkline (today in the accent) or a one-line note. */
function HeadlineCard({ label, value, to, icon: Icon, onClick, tone, trend, trendUnit, days, note, loading }: HeadlineProps) {
  const [hover, setHover] = useState<number | null>(null);
  const hasTrend = !!trend?.length;
  const today = hasTrend ? trend![trend!.length - 1]! : 0;
  const average = hasTrend ? trend!.reduce((sum, n) => sum + n, 0) / trend!.length : 0;
  const caption =
    hover != null && hasTrend && days
      ? `${DAY_FORMAT.format(new Date(days[hover]!))} · ${trend![hover]} ${trendUnit}`
      : hasTrend
        ? `${today} today · ${average < 10 ? average.toFixed(1) : Math.round(average)}/day avg`
        : note;
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-md",
            tone === "warning" ? "bg-tone-warning-bg text-tone-warning" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="text-3xl leading-none font-semibold tracking-tight">
          {loading || value == null ? <Skeleton className="h-8 w-12" /> : <NumberFlow value={value} />}
        </div>
        {hasTrend ? <Sparkbars values={trend!} days={days ?? []} unit={trendUnit ?? ""} onHover={setHover} /> : null}
      </div>
      <p className="mt-2 min-h-4 truncate text-xs text-muted-foreground">{loading ? " " : caption}</p>
    </>
  );
  const className =
    "block rounded-lg border bg-card p-4 text-left shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring";
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return (
    <Link to={to} className={className}>
      {body}
    </Link>
  );
}

/** Seven thin daily bars: muted history, today in the accent. Hovering a column names its day and value. */
function Sparkbars({
  values,
  days,
  unit,
  onHover,
}: {
  values: number[];
  days: number[];
  unit: string;
  onHover: (index: number | null) => void;
}) {
  const max = Math.max(1, ...values);
  const barWidth = 6;
  const gap = 2;
  const height = 32;
  const width = values.length * (barWidth + gap) - gap;
  const summary = values.map((value, index) => `${days[index] ? DAY_FORMAT.format(new Date(days[index]!)) : ""} ${value}`).join(", ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Last 7 days, ${unit}: ${summary}`}
      className="shrink-0 overflow-visible"
      onMouseLeave={() => onHover(null)}
    >
      {values.map((value, index) => {
        const h = value > 0 ? Math.max(3, (value / max) * height) : 2;
        const x = index * (barWidth + gap);
        const last = index === values.length - 1;
        return (
          <g key={index} onMouseEnter={() => onHover(index)}>
            <rect x={x - gap / 2} y={0} width={barWidth + gap} height={height} fill="transparent" />
            <rect
              x={x}
              y={height - h}
              width={barWidth}
              height={h}
              rx={2}
              className={last ? "fill-primary" : value > 0 ? "fill-muted-foreground/35" : "fill-muted-foreground/15"}
            />
          </g>
        );
      })}
    </svg>
  );
}

function MoreMetrics({ stats }: { stats: { label: string; value: number | undefined; to: string }[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          More metrics
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="grid grid-cols-2 gap-1">
          {stats.map((stat) => (
            <Link key={stat.label} to={stat.to} className="rounded-md px-2 py-1.5 hover:bg-muted">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-lg font-semibold">{stat.value ?? "—"}</p>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RailCard({
  title,
  icon: Icon,
  action,
  empty,
  loading,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  empty: ReactNode;
  loading?: boolean;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </h2>
        {action}
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : items.length ? (
        <div className="space-y-2">{children}</div>
      ) : (
        empty
      )}
    </section>
  );
}

/** A rail card's empty state: the card already has a frame and a heading, so this one drops its own. */
function RailEmpty({ icon, title, body }: { icon: LucideIcon; title: string; body: ReactNode }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      body={body}
      className="rounded-none border-0 bg-transparent px-2 py-1 [&>div:first-child]:mb-2 [&>div:first-child]:size-8 [&>div:first-child_svg]:size-4"
    />
  );
}

const METER_FILL: Record<"info" | "warning" | "danger", string> = {
  info: "bg-tone-info",
  warning: "bg-tone-warning",
  danger: "bg-tone-danger",
};
const METER_TRACK: Record<"info" | "warning" | "danger", string> = {
  info: "bg-tone-info-bg",
  warning: "bg-tone-warning-bg",
  danger: "bg-tone-danger-bg",
};

/** Label + value with a meter whose track is a lighter step of its own fill, so the state reads across the bar. */
function MeterRow({
  to,
  label,
  value,
  fraction,
  tone,
  note,
}: {
  to: string;
  label: string;
  value: string;
  fraction: number;
  tone: "info" | "warning" | "danger";
  note?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return (
    <Link to={to} className="block rounded-md px-1 py-0.5 hover:bg-muted/60">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-mono">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {note ? <span className="mr-1.5">{note} ·</span> : null}
          <span className="tabular-nums text-foreground">{value}</span>
        </span>
      </div>
      <div className={cn("mt-1 h-1.5 overflow-hidden rounded-full", METER_TRACK[tone])}>
        <div className={cn("h-full rounded-full", METER_FILL[tone])} style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
    </Link>
  );
}

function QueueRow({
  row,
  team,
  garage,
  owner,
  onAssign,
  onPin,
  onRelabel,
}: {
  row: WorkRow;
  team: TeamMember[];
  garage: boolean;
  owner: boolean;
  onAssign: (jobId: string, userId: string | null, name?: string) => Promise<void>;
  onPin: (jobId: string, pinned: boolean) => Promise<void>;
  onRelabel: (row: WorkRow) => Promise<void>;
}) {
  const Icon = LANE_ICON[row.lane];
  const bay = bayFor(row.job);
  const reason = row.job?.reason && row.job.reason !== DEFAULT_JOB_REASON ? row.job.reason : null;
  const days = row.createdAt ? ageInDays(row.createdAt) : null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-(--density-row) hover:bg-muted/30 sm:flex-nowrap">
      <span
        className={cn(
          "hidden size-8 shrink-0 items-center justify-center rounded-full sm:flex",
          row.lane === "exceptions" ? "bg-tone-warning-bg text-tone-warning" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-[calc(100%-1rem)] sm:basis-0">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={row.to} className="truncate font-medium hover:text-primary hover:underline">
            {row.title}
          </Link>
          <span className="shrink-0 rounded border px-1.5 text-[11px] text-muted-foreground">{row.queue}</span>
          {row.job?.pinned ? <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" /> : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[row.meta, bay && !sameRoute(row.meta, bay) ? bay : null].filter(Boolean).join(" · ")}
          {reason ? <span className="ml-1 font-medium text-foreground/80">· {reason}</span> : null}
        </p>
      </div>
      {days != null ? (
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums sm:ml-0",
            days >= 3 ? "font-medium text-tone-warning" : "text-muted-foreground",
          )}
          title={row.createdAt ? `Opened ${new Date(row.createdAt).toLocaleString()}` : undefined}
        >
          {days === 0 ? "Today" : `${days}d old`}
        </span>
      ) : null}
      <StatusBadge status={row.status} />
      {!garage && row.job ? (
        <AssignPopover job={row.job} team={team} owner={owner} onAssign={onAssign} onPin={onPin} />
      ) : null}
      {row.relabel ? (
        <Button size="sm" variant="outline" onClick={() => void onRelabel(row)}>
          Relabel
        </Button>
      ) : (
        <Button size="sm" variant="outline" asChild>
          <Link to={row.actionTo}>
            {row.action}
            <ArrowRight />
          </Link>
        </Button>
      )}
    </li>
  );
}

function AssignPopover({
  job,
  team,
  owner,
  onAssign,
  onPin,
}: {
  job: FloorJob;
  team: TeamMember[];
  owner: boolean;
  onAssign: (jobId: string, userId: string | null, name?: string) => Promise<void>;
  onPin: (jobId: string, pinned: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={job.assigneeName ? `Assigned to ${job.assigneeName}. Change` : "Unassigned. Assign"}
        >
          <PersonAvatar name={job.assigneeName} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Assign</p>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
          onClick={() => {
            setOpen(false);
            void onAssign(job.id, null);
          }}
        >
          <UserRound className="size-4 text-muted-foreground" />
          Unassigned
          {!job.assigneeId ? <span className="ml-auto text-xs text-muted-foreground">current</span> : null}
        </button>
        {team.map((member) => (
          <button
            key={member.userId}
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              setOpen(false);
              void onAssign(job.id, member.userId, member.name);
            }}
          >
            <PersonAvatar name={member.name} className="size-5 text-[9px]" />
            <span className="truncate">{member.name}</span>
            {job.assigneeId === member.userId ? <span className="ml-auto text-xs text-muted-foreground">current</span> : null}
          </button>
        ))}
        {owner ? (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                setOpen(false);
                void onPin(job.id, !job.pinned);
              }}
            >
              {job.pinned ? <PinOff className="size-4 text-muted-foreground" /> : <Pin className="size-4 text-muted-foreground" />}
              {job.pinned ? "Unpin" : "Pin to top of queue"}
            </button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** "A-01-01 → A-02-02" already in the row text should not be repeated as the job's bay route. */
function sameRoute(meta: string, bay: string): boolean {
  const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();
  return squash(meta).includes(squash(bay));
}

function ageOf(row: unknown): number | undefined {
  const at = (row as { createdAt?: unknown }).createdAt;
  return typeof at === "number" ? at : undefined;
}

function bayFor(job?: FloorJob) {
  if (!job) return "";
  return [job.fromCode, job.toCode].filter(Boolean).join(" → ");
}

function floorActionForOrder(status: string, id: string): string {
  if (status === "picked" || status === "packing") return `/floor/pack?id=${id}`;
  if (status === "packed") return `/floor/ship?id=${id}`;
  return `/floor/pick?id=${id}`;
}

function floorLabelForOrder(status: string): string {
  if (status === "picked" || status === "packing") return "Pack";
  if (status === "packed") return "Ship";
  return "Pick";
}

function buildRows(data: Dashboard | null, jobs: FloorJob[]): WorkRow[] {
  const queues = data?.queues;
  if (!queues) return [];
  const rows: WorkRow[] = [
    ...(queues.receipts ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "Receipt",
      to: `/inbound/receipts/${row.id}`,
      title: row.number,
      meta: row.notes || "Receive onto the dock",
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/receive?id=${row.id}`,
      action: "Receive",
      job: jobForRef(jobs, "receipt", row.id, "receive"),
    })),
    ...(queues.purchases ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "PO",
      to: `/inbound/purchases/${row.id}`,
      title: row.number,
      meta: row.vendorName,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/receive?purchase=${row.id}`,
      action: "Receive",
      job: jobForRef(jobs, "purchase", row.id, "receive"),
    })),
    ...(queues.putaways ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "Putaway",
      to: `/inbound/putaway/${row.id}`,
      title: row.number,
      meta: `${row.fromCode ?? "from"} → ${row.toCode ?? "to"}`,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/putaway?id=${row.id}`,
      action: "Put away",
      job: jobForRef(jobs, "transfer", row.id, "putaway"),
    })),
    ...(data?.putawaySuggestions ?? []).map((row) => ({
      id: `dock-${row.fromLocationId}-${row.itemId}`,
      lane: "inbound" as const,
      queue: "Putaway",
      to: `/stock/items/${row.itemId}`,
      title: `${row.sku} × ${row.qty}`,
      meta: `${row.fromCode} → ${row.toCode}`,
      status: "dock",
      actionTo: `/floor/putaway?from=${encodeURIComponent(row.fromBarcode)}`,
      action: "Put away",
      job: jobForSuggestion(jobs, "putawaySuggestion", row.fromLocationId, row.itemId, row.toLocationId),
    })),
    ...(queues.asns ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "ASN",
      to: `/inbound/asns/${row.id}`,
      title: row.number,
      meta: row.vendorName,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/asn?id=${row.id}`,
      action: "Receive",
    })),
    ...(queues.yard ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "Yard",
      to: `/inbound/yard/${row.id}`,
      title: row.number,
      meta: `${row.carrierName}${row.trailerNumber ? ` · ${row.trailerNumber}` : ""}`,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/yard?id=${row.id}`,
      action: "Yard",
    })),
    ...(queues.vendorReturns ?? []).map((row) => ({
      id: row.id,
      lane: "inbound" as const,
      queue: "RTV",
      to: `/inbound/vendor-returns/${row.id}`,
      title: row.number,
      meta: row.vendorName,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/rtv?id=${row.id}`,
      action: "Return",
      job: jobForRef(jobs, "vendorReturn", row.id, "rtv"),
    })),
    ...(queues.orders ?? []).map((row) => ({
      id: row.id,
      lane: "outbound" as const,
      queue: "Order",
      to: `/outbound/orders/${row.id}`,
      title: `${row.number} · ${row.customerName}`,
      meta: row.source === "shopify" ? "Shopify" : "Floor order",
      status: row.status,
      createdAt: ageOf(row),
      actionTo: floorActionForOrder(row.status, row.id),
      action: floorLabelForOrder(row.status),
      job: jobForRef(jobs, "order", row.id, desiredVerb("order", row.status) ?? undefined),
    })),
    ...(queues.waves ?? []).map((row) => ({
      id: row.id,
      lane: "outbound" as const,
      queue: "Wave",
      to: `/outbound/waves/${row.id}`,
      title: row.number,
      meta: `${row.mode} · ${row.orderCount ?? 0} orders`,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/wave?id=${row.id}`,
      action: "Wave",
    })),
    ...(queues.returns ?? []).map((row) => ({
      id: row.id,
      lane: "outbound" as const,
      queue: "RMA",
      to: `/outbound/returns/${row.id}`,
      title: row.number,
      meta: row.customerName,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/return?id=${row.id}`,
      action: "Receive",
      job: jobForRef(jobs, "rma", row.id, "return"),
    })),
    ...(queues.workOrders ?? []).map((row) => ({
      id: row.id,
      lane: "make" as const,
      queue: "WO",
      to: `/make/work-orders/${row.id}`,
      title: row.number,
      meta: `${row.sku} × ${row.qtyCompleted ?? 0}/${row.qty}`,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/assemble?id=${row.id}`,
      action: "Assemble",
      job: jobForRef(jobs, "workOrder", row.id, "assemble"),
    })),
    ...(queues.kits ?? []).map((row) => ({
      id: row.id,
      lane: "make" as const,
      queue: "Kit",
      to: `/make/kits/${row.id}`,
      title: row.number,
      meta: `${row.sku} × ${row.qtyCompleted ?? 0}/${row.qty}`,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/kit?id=${row.id}`,
      action: "Kit",
      job: jobForRef(jobs, "kit", row.id, "kit"),
    })),
    ...(queues.replenishments ?? []).map((row) => ({
      id: row.id,
      lane: "stock" as const,
      queue: "Replenish",
      to: `/stock/replenish/${row.id}`,
      title: row.number,
      meta: `${row.sku} ${row.qtyMoved ?? 0}/${row.qty} · ${row.fromCode ?? "bulk"} → ${row.toCode ?? "pick"}`,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/replenish?id=${row.id}`,
      action: "Replenish",
      job: jobForRef(jobs, "replenishment", row.id, "replenish"),
    })),
    ...(data?.replenishSuggestions ?? [])
      .filter((row) => !(queues.replenishments ?? []).some((doc) => doc.itemId === row.itemId && doc.toLocationId === row.toLocationId && doc.status !== "posted"))
      .map((row) => ({
        id: `sug-${row.itemId}-${row.toLocationId}`,
        lane: "stock" as const,
        queue: "Replenish",
        to: "/stock/replenish",
        title: `${row.sku} × ${row.qty}`,
        meta: `${row.fromCode} → ${row.toCode} · pick ${row.pickQty}/${row.pickMin}`,
        status: "suggested",
        actionTo: "/floor/replenish",
        action: "Replenish",
        job: jobForSuggestion(jobs, "replenishSuggestion", row.fromLocationId, row.itemId, row.toLocationId),
      })),
    ...(queues.holds ?? []).map((row) => ({
      id: row.id,
      lane: "stock" as const,
      queue: "Hold",
      to: `/stock/holds/${row.id}`,
      title: row.number,
      meta: `${row.sku ? `${row.sku}${row.lotCode ? ` ${row.lotCode}` : ""} @ ` : ""}${row.locationCode || "bay"} · ${row.reason}`,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/hold?id=${row.id}`,
      action: "Release",
      job: jobForRef(jobs, "hold", row.id, "hold"),
    })),
    ...(queues.counts ?? []).map((row) => ({
      id: row.id,
      lane: "stock" as const,
      queue: "Count",
      to: `/stock/counts/${row.id}`,
      title: row.number,
      meta: row.locationCode || "Bay count",
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/count?id=${row.id}`,
      action: "Count",
      job: jobForRef(jobs, "cycleCount", row.id, "count"),
    })),
    ...(queues.countVariances ?? []).map((row) => ({
      id: row.id,
      lane: "stock" as const,
      queue: "Variance",
      to: `/stock/counts/${row.countId}`,
      title: `${row.sku} ${formatCountVariance(row.variance)}`,
      meta: `${row.number} · ${row.locationCode || "bay"} · counted ${row.countedQty} vs ${row.systemQty}`,
      status: "variance",
      actionTo: `/stock/counts/${row.countId}`,
      action: "Review",
    })),
    ...(queues.expiringLots ?? []).map((row) => ({
      id: `${row.locationId}:${row.itemId}:${row.lotCode}`,
      lane: "stock" as const,
      queue: "FEFO",
      to: `/stock/items/${row.itemId}`,
      title: `${row.sku} ${row.lotCode}`,
      meta: `${row.locationCode} · ${row.qty} · ${formatExpiresOn(row.expiresOn)}`,
      status: "expiring",
      actionTo: `/stock/items/${row.itemId}`,
      action: "Open",
    })),
    ...(data?.runwayThisWeek ?? []).map((row) => ({
      id: `runway-${row.itemId}`,
      lane: "stock" as const,
      queue: "Runway",
      to: `/stock/items/${row.itemId}`,
      title: `${row.sku} ${row.name}`,
      meta: `${row.daysOfCover != null ? `${row.daysOfCover.toFixed(1)}d` : "out"}${row.suggestedQty ? ` · +${row.suggestedQty}` : ""}${row.coveredByOpenPo ? " · open PO" : ""}`,
      status: "runway",
      actionTo: "/analytics/runway",
      action: "Runway",
    })),
    ...(queues.shopifyExceptions ?? []).map((row) => ({
      id: `shopify-${row.id}`,
      lane: "exceptions" as const,
      queue: "Shopify",
      to: `/outbound/orders/${row.id}`,
      title: row.shopifyOrderName || row.number,
      meta: row.shopifySyncError || row.shopifySyncStatus || "Needs attention",
      status: row.shopifySyncStatus || row.status,
      actionTo: `/outbound/orders/${row.id}`,
      action: "Open",
    })),
    ...(queues.trackerExceptions ?? []).map((row) => ({
      id: row.id,
      lane: "exceptions" as const,
      queue: "Tracker",
      to: `/outbound/orders/${row.orderId}`,
      title: row.packageNumber ? `${row.number} ${row.packageNumber}` : row.number,
      meta: row.trackingNumber ? `${row.trackingNumber} · ${row.trackerStatus}` : row.trackerStatus,
      status: "exception",
      actionTo: `/outbound/orders/${row.orderId}`,
      action: "Relabel",
      relabel: { orderId: row.orderId, packageId: row.packageNumber ? row.id : undefined },
    })),
    ...(queues.checkouts ?? []).map((row) => ({
      id: row.id,
      lane: "exceptions" as const,
      queue: "Checkout",
      to: `/equipment/${row.equipmentId}`,
      title: row.equipmentCode,
      meta: `${row.operatorName}${row.shift ? ` · ${row.shift}` : ""}${row.taskNumber || row.refType ? ` · ${row.taskNumber || row.refType}` : ""}`,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/floor/checkout?id=${row.equipmentId}`,
      action: "Check in",
    })),
    ...(queues.outOfService ?? []).map((row) => ({
      id: row.id,
      lane: "exceptions" as const,
      queue: "OOS",
      to: `/equipment/${row.id}`,
      title: row.code,
      meta: row.name,
      status: row.status,
      createdAt: ageOf(row),
      actionTo: `/equipment/${row.id}`,
      action: "Open",
    })),
    ...(queues.expiringCerts ?? []).map((row) => ({
      id: row.id,
      lane: "exceptions" as const,
      queue: "Cert",
      to: "/setup/team",
      title: row.userName || row.userId,
      meta: `${row.class} · ${formatExpiresOn(row.expiresOn)}`,
      status: "expiring",
      actionTo: "/setup/team",
      action: "Team",
    })),
  ];
  return rows;
}
