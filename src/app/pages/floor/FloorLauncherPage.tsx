import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Box,
  Calculator,
  ChevronRight,
  ClipboardList,
  Factory,
  Forklift,
  Hammer,
  Layers,
  Loader2,
  Package,
  Package2,
  Printer,
  Repeat,
  ScanLine,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Truck,
  Undo2,
  Warehouse,
} from "lucide-react";
import { Button, EmptyState, ErrorBanner, PageHeader } from "../../components/ui";
import { SkuThumb } from "../../components/sku-thumb";
import { FLOOR_ANCHORS, scrollToFloorAnchor } from "../../components/floor-tab-bar";
import { useSession } from "../../session";
import { MyDayCard } from "../LaborPage";
import { useWarehouse } from "../../warehouse";
import { ScannerInputControls } from "../../scanner/ScannerInputControls";
import { useApiQuery } from "../../query";
import { useExceptionInbox } from "../../exceptions";
import { api, type FloorJob, type Item } from "../../api";
import { VERB_LABELS, type FloorVerb, isFloorVerb } from "@/domain/jobs";
import { garageOffersOnFloor, isGarageMode, pathOnly } from "@/domain/operating-mode";
import {
  floorUsageKey,
  groupFloorTiles,
  jobBayRoute,
  jobReasonText,
  openWorkByVerb,
  parseFloorUsage,
  recordFloorTap,
  usualFloorPaths,
  type FloorUsage,
} from "@/domain/floor-usage";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { OfflineQueueNotice } from "../../offline-queue-banner";
import { FloorScanBox, type ScanReport } from "./floor-ui";

type Icon = ComponentType<{ className?: string }>;

type VerbTile = { to: string; title: string; body: string; verb?: FloorVerb; icon: Icon };

const EXCEPTIONS_TILE = "/floor/exceptions";

const verbs: VerbTile[] = [
  { to: "/floor/receive", title: "Receive", body: "Post a receipt or purchase onto the dock, including partials.", verb: "receive", icon: Truck },
  { to: "/floor/asn", title: "ASN", body: "Scan an ASN- notice and receive onto the dock.", icon: Package },
  { to: "/floor/yard", title: "Yard", body: "Scan a YRD- visit to check in, dock, or check out.", icon: Warehouse },
  { to: "/floor/putaway", title: "Put away", body: "Put away a vendor BOX-/SSCC, post remaining on a ticket, or scan the dock to a bulk bay.", verb: "putaway", icon: Repeat },
  { to: "/floor/replenish", title: "Replenish", body: "Move remaining qty from bulk onto a pick face below min.", verb: "replenish", icon: ArrowDownToLine },
  { to: "/floor/count", title: "Count", body: "Blind-count a bay. System qty stays hidden until you post.", verb: "count", icon: Calculator },
  { to: "/floor/hold", title: "Hold", body: "Lock a bay, SKU, or lot so pick and replenish skip it.", verb: "hold", icon: ShieldAlert },
  { to: "/floor/plates", title: "Plates", body: "Build a tote, pallet, or carton in a bay, then move it in one scan.", icon: Package2 },
  { to: "/floor/kit", title: "Kit", body: "Build a finished SKU from its recipe in one step.", verb: "kit", icon: Factory },
  { to: "/floor/assemble", title: "Assemble", body: "Complete a work order on the bench.", verb: "assemble", icon: Hammer },
  { to: "/floor/pick", title: "Pick", body: "Go to the suggested bay, open a pick map, pick remaining qty, or unpick / cancel.", verb: "pick", icon: ClipboardList },
  { to: "/floor/wave", title: "Wave", body: "Scan a WAV- wave; batch-pick aggregated SKUs when mode is batch.", icon: Layers },
  { to: "/floor/pack", title: "Pack", body: "Pack remaining qty, print a pack slip, close the box.", verb: "pack", icon: Box },
  { to: "/floor/ship", title: "Ship", body: "Buy a label, close the order, fulfill Shopify.", verb: "ship", icon: Send },
  { to: "/floor/return", title: "Return", body: "Receive an RMA: restock, scrap, or hold at the dock.", verb: "return", icon: Undo2 },
  { to: "/floor/rtv", title: "Vendor return", body: "Ship remaining qty back to the vendor from a bay.", verb: "rtv", icon: ArrowUpFromLine },
  { to: "/floor/lookup", title: "Lookup", body: "Scan a SKU, bay, document, serial, or lot.", icon: Search },
  { to: "/floor/print", title: "Print", body: "Print a bay, SKU, pick list, pack slip, or shipping label.", icon: Printer },
  { to: "/floor/checkout", title: "Check out", body: "Scan a truck, inspect it, bind a shift or ticket.", icon: Forklift },
  { to: EXCEPTIONS_TILE, title: "Exceptions", body: "Claim a held bay, a count variance, or an over-full bay and fix it.", icon: AlertTriangle },
];

const adjustTile: VerbTile = {
  to: "/floor/adjust",
  title: "Adjust",
  body: "Signed qty change with a reason.",
  icon: SlidersHorizontal,
};

const TASK_HINTS: Record<string, string> = {
  "/floor/receive": "Bring stock onto the dock",
  "/floor/putaway": "Move stock into its bay",
  "/floor/pick": "Collect items for an order",
  "/floor/pack": "Check items into a box",
  "/floor/ship": "Label and send an order",
  "/floor/count": "Check what is in a bay",
  "/floor/kit": "Build from a recipe",
  "/floor/assemble": "Complete a work order",
  "/floor/lookup": "Find a label or item",
};

const VERB_ICON: Partial<Record<string, Icon>> = Object.fromEntries(
  verbs.filter((tile) => tile.verb).map((tile) => [tile.verb as string, tile.icon]),
);

function verbLabel(verb: string): string {
  return isFloorVerb(verb) ? VERB_LABELS[verb] : verb;
}

function readUsage(key: string): FloorUsage {
  try {
    return parseFloorUsage(localStorage.getItem(key));
  } catch {
    return {};
  }
}

/** Tap counts per verb for this person, kept in this browser. */
function useFloorUsage(userId: string): [FloorUsage, (path: string) => void] {
  const key = floorUsageKey(userId);
  const [usage, setUsage] = useState<FloorUsage>(() => readUsage(key));

  useEffect(() => {
    setUsage(readUsage(key));
  }, [key]);

  // Write straight away: the tap also navigates, so a deferred state update may never land.
  const record = useCallback(
    (path: string) => {
      const next = recordFloorTap(readUsage(key), pathOnly(path));
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private mode or full storage: the usual row just stays as it was.
      }
      setUsage(next);
    },
    [key],
  );

  return [usage, record];
}

export function FloorLauncherPage() {
  const me = useSession();
  const { warehouseId } = useWarehouse();
  const navigate = useNavigate();
  const location = useLocation();
  const [claimError, setClaimError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [usage, recordTap] = useFloorUsage(me.user.id);
  const garage = isGarageMode(me.organization.operatingMode);
  const allowed = new Set(me.floorVerbs ?? []);
  const items = [
    ...verbs.filter((item) => !item.verb || allowed.has(item.verb) || me.role === "owner"),
    ...(me.role === "owner" ? [adjustTile] : []),
  ].filter((item) => !garage || garageOffersOnFloor(item.to));

  const warehouseQuery = warehouseId ? `warehouseId=${encodeURIComponent(warehouseId)}` : "";
  const nextQ = useApiQuery<FloorJob[]>(`/api/jobs/next${warehouseQuery ? `?${warehouseQuery}` : ""}`, {
    refetchOnMount: "always",
  });
  const openQ = useApiQuery<FloorJob[]>(`/api/jobs?open=1${warehouseQuery ? `&${warehouseQuery}` : ""}`, {
    refetchOnMount: "always",
  });

  const keep = useCallback((job: FloorJob) => !garage || garageOffersOnFloor(job.floorPath), [garage]);
  const nextJobs = useMemo(() => (nextQ.data ?? []).filter(keep), [nextQ.data, keep]);
  const openJobs = useMemo(() => (openQ.data ?? []).filter(keep), [openQ.data, keep]);
  const mine = useMemo(() => openJobs.filter((job) => job.assigneeId === me.user.id), [openJobs, me.user.id]);
  const counts = useMemo(() => openWorkByVerb(openJobs, me.user.id), [openJobs, me.user.id]);
  const inbox = useExceptionInbox();
  const tileCount = (item: VerbTile) => (item.to === EXCEPTIONS_TILE ? inbox.data?.counts.floor : item.verb ? counts[item.verb] : undefined);

  const next = nextJobs[0];
  const itemsQ = useApiQuery<Item[]>(next?.itemId ? "/api/items" : null);
  const nextItem = next?.itemId ? itemsQ.data?.find((row) => row.id === next.itemId) : undefined;

  const usual = usualFloorPaths(
    usage,
    items.map((item) => item.to),
  )
    .map((path) => items.find((item) => item.to === path))
    .filter((item): item is VerbTile => Boolean(item));
  const groups = groupFloorTiles(items);
  const quickPaths = [...new Set([
    ...usual.map((item) => item.to),
    "/floor/receive", "/floor/putaway", "/floor/pick", "/floor/pack", "/floor/ship", "/floor/count",
    "/floor/kit", "/floor/assemble", "/floor/lookup",
  ])];
  const quickTasks = quickPaths
    .map((path) => items.find((item) => item.to === path))
    .filter((item): item is VerbTile => Boolean(item))
    .slice(0, 6);

  const onLauncherScan = useCallback(
    (raw: string, report?: ScanReport) => {
      const needle = raw.trim().toLowerCase();
      const job = openJobs.find((row) => {
        const number = row.number?.toLowerCase();
        return Boolean(number && (needle === number || needle.endsWith(number)));
      });
      report?.(Boolean(job) || needle.length > 0);
      if (job) {
        recordTap(job.floorPath);
        navigate(job.floorPath);
        return;
      }
      navigate("/floor/lookup");
    },
    [navigate, openJobs, recordTap],
  );

  const loaded = !nextQ.isLoading && !openQ.isLoading;
  const error = claimError ?? nextQ.error?.message ?? openQ.error?.message ?? null;

  // The tab bar links to /floor#next and /floor#mine; the router does not scroll to hashes.
  useEffect(() => {
    const id = location.hash.replace(/^#/, "");
    if (id !== FLOOR_ANCHORS.next && id !== FLOOR_ANCHORS.mine) return;
    const frame = window.requestAnimationFrame(() => scrollToFloorAnchor(id));
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, location.key, loaded]);

  async function startNext() {
    if (!next || starting) return;
    setClaimError(null);
    setStarting(true);
    try {
      const claimed = await api<FloorJob>(`/api/jobs/${next.id}/claim`, { method: "POST" });
      recordTap(claimed.floorPath);
      navigate(claimed.floorPath);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Could not claim job");
      setStarting(false);
    }
  }

  return (
    <div className="space-y-5" data-slot="floor-workspace">
      <PageHeader
        eyebrow={garage ? "Garage Mode" : "Floor"}
        title={garage ? "Your maker workspace" : "Your floor workspace"}
        description={
          garage
            ? "Receive, make, and put away. Open Ship orders to send your next order."
            : "Scan a label, start your next job, or choose a task."
        }
        actions={
          <Link
            to={`/floor#${FLOOR_ANCHORS.mine}`}
            onClick={() => scrollToFloorAnchor(FLOOR_ANCHORS.mine)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ClipboardList aria-hidden className="size-4 text-primary" />
            {openQ.isLoading ? "Loading your jobs…" : `${mine.length} assigned to you`}
          </Link>
        }
      />
      {garage ? (
        <Link
          to="/ship"
          className="flex items-center gap-3 rounded-xl border bg-card p-4 outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Truck aria-hidden className="size-5 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Ship orders</span>
            <span className="block text-sm text-muted-foreground">Pick, pack, label, and ship in one step.</span>
          </span>
          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        </Link>
      ) : null}
      <OfflineQueueNotice />
      <ErrorBanner error={error} />

      <section aria-labelledby="floor-scan-heading" className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <div className="flex items-center gap-3 border-b bg-primary/5 px-4 py-3 sm:px-5">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ScanLine className="size-5" />
          </span>
          <div>
            <h2 id="floor-scan-heading" className="text-base font-semibold">Scan station</h2>
            <p className="text-sm text-muted-foreground">One scan opens the work in front of you.</p>
          </div>
        </div>
        <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <FloorScanBox label="Scan a label" placeholder="Bay, SKU, or order" onScan={onLauncherScan} ready={loaded} showModeControl={false} replayLastScan={false} />
          <div className="min-w-0 border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-5">
            <ScannerInputControls />
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <section id={FLOOR_ANCHORS.next} aria-labelledby="floor-next-heading" className="scroll-mt-20 space-y-2">
            <SectionLabel id="floor-next-heading">Up next</SectionLabel>
            {next ? (
              <NextJobCard job={next} item={nextItem} starting={starting} onStart={() => void startNext()} />
            ) : nextQ.isLoading ? (
              <Skeleton className="h-44 w-full rounded-xl" />
            ) : (
              <EmptyState
                icon={ClipboardList}
                title="Your queue is clear."
                body="Choose a task or scan a label to keep working."
                action={
                  <Button variant="secondary" className="h-11" asChild>
                    <Link to="/floor/lookup">
                      <Search className="size-4" />
                      Lookup
                    </Link>
                  </Button>
                }
              />
            )}
          </section>

          <section id={FLOOR_ANCHORS.mine} aria-labelledby="floor-mine-heading" className="scroll-mt-20 space-y-2">
            <SectionLabel id="floor-mine-heading">
              My jobs
              {mine.length ? <span className="ml-1.5 font-mono normal-case tracking-normal">{mine.length}</span> : null}
            </SectionLabel>
            {mine.length ? (
              <ul className="divide-y overflow-hidden rounded-lg border bg-card text-sm">
                {mine.map((job) => {
                  const JobIcon = VERB_ICON[job.verb] ?? ClipboardList;
                  const detail = jobReasonText(job) || job.title || "Assigned to you";
                  return (
                    <li key={job.id}>
                      <Link
                        className="flex min-h-18 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                        to={job.floorPath}
                        onClick={() => recordTap(job.floorPath)}
                      >
                        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><JobIcon className="size-5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            <span className="font-medium">{verbLabel(job.verb)}</span>{" "}
                            {job.number ? <span className="font-mono">{job.number}</span> : null}
                          </span>
                          <span className="mt-1 block truncate text-sm text-muted-foreground">{detail}</span>
                        </span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                {openQ.isLoading ? "Loading your jobs…" : "Nothing assigned to you. Start the next job or choose a task."}
              </p>
            )}
          </section>
          <MyDayCard />
        </div>
        <div className="min-w-0 space-y-5">
          <section aria-labelledby="floor-quick-heading" className="space-y-2">
            <SectionLabel id="floor-quick-heading">Quick tasks</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {quickTasks.map((item) => (
                <VerbTileLink key={item.to} item={item} count={tileCount(item)} quick onTap={recordTap} />
              ))}
            </div>
          </section>
          <VerbManual usual={usual} groups={groups} tileCount={tileCount} onTap={recordTap} />
        </div>
      </div>
    </div>
  );
}

function VerbSections({
  idPrefix,
  usual,
  groups,
  tileCount,
  onTap,
}: {
  idPrefix: string;
  usual: VerbTile[];
  groups: { id: string; label: string; tiles: VerbTile[] }[];
  tileCount: (item: VerbTile) => number | undefined;
  onTap: (path: string) => void;
}) {
  return (
    <>
      {usual.length ? (
        <section aria-labelledby={`${idPrefix}-usual`} className="space-y-1.5">
          <SectionLabel id={`${idPrefix}-usual`}>Your usual</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {usual.map((item) => (
              <VerbTileLink key={item.to} item={item} count={tileCount(item)} compact onTap={onTap} />
            ))}
          </div>
        </section>
      ) : null}
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`${idPrefix}-${group.id}`} className="space-y-1.5">
          <SectionLabel id={`${idPrefix}-${group.id}`}>{group.label}</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {group.tiles.map((item) => (
              <VerbTileLink key={item.to} item={item} count={tileCount(item)} onTap={onTap} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function VerbManual({
  usual,
  groups,
  tileCount,
  onTap,
}: {
  usual: VerbTile[];
  groups: { id: string; label: string; tiles: VerbTile[] }[];
  tileCount: (item: VerbTile) => number | undefined;
  onTap: (path: string) => void;
}) {
  return (
    <details className="group rounded-xl border bg-card px-4">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 text-base font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <span>All tasks <span className="ml-1 text-sm font-normal text-muted-foreground">{groups.reduce((total, group) => total + group.tiles.length, 0)}</span></span>
        <ChevronRight aria-hidden className="size-5 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-4 border-t py-4">
        <VerbSections idPrefix="floor-more" usual={usual} groups={groups} tileCount={tileCount} onTap={onTap} />
      </div>
    </details>
  );
}

function SectionLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function NextJobCard({
  job,
  item,
  starting,
  onStart,
}: {
  job: FloorJob;
  item: Item | undefined;
  starting: boolean;
  onStart: () => void;
}) {
  const JobIcon = VERB_ICON[job.verb] ?? ClipboardList;
  const route = jobBayRoute(job);
  const reason = jobReasonText(job);
  const title = job.title && job.title !== route ? job.title : null;
  const subtitle = item ? [item.sku !== job.number ? item.sku : null, item.name].filter(Boolean).join(" · ") : title;
  const imageUrl = (job as FloorJob & { imageUrl?: string | null }).imageUrl ?? item?.imageUrl ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/30 bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-primary/15 bg-primary/5 px-4 py-3">
        <p className="text-xs font-semibold text-primary">Recommended for you</p>
        {reason ? <p className="text-xs font-medium text-tone-warning">{reason}</p> : null}
      </div>
      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {job.itemId ? (
            <SkuThumb
              sku={item?.sku ?? job.number ?? "?"}
              name={item?.name}
              imageUrl={imageUrl}
              size="lg"
              className="size-20 text-sm"
            />
          ) : (
            <div
              aria-hidden
              className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            >
              <JobIcon className="size-8" />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xl font-semibold leading-tight tracking-tight break-words">
              {verbLabel(job.verb)}
              {job.number ? <span className="ml-1.5 font-mono">{job.number}</span> : null}
            </p>
            {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
            {route ? (
              <p className="flex items-center gap-1.5 break-words font-mono text-base font-semibold">
                <span className="sr-only">Bay </span>
                {route}
              </p>
            ) : null}
            {job.qty != null ? (
              <p className="text-sm text-muted-foreground">
                Qty <span className="font-mono text-2xl font-semibold text-foreground">{job.qty}</span>
              </p>
            ) : null}
          </div>
        </div>
        <Button className="h-14 w-full justify-between px-5 text-base" disabled={starting} onClick={onStart}>
          {starting ? <Loader2 className="size-5 animate-spin" /> : null}
          {starting ? "Opening job…" : `Start ${verbLabel(job.verb).toLowerCase()}`}
          {starting ? null : <ArrowRight className="size-5" />}
        </Button>
      </div>
    </div>
  );
}

function VerbTileLink({
  item,
  count,
  compact,
  quick,
  onTap,
}: {
  item: VerbTile;
  count: number | undefined;
  compact?: boolean;
  quick?: boolean;
  onTap: (path: string) => void;
}) {
  return (
    <Link
      to={item.to}
      title={item.body}
      onClick={() => onTap(item.to)}
      className={cn(
        "flex min-h-14 gap-2.5 rounded-xl border bg-card px-3 py-3 text-sm font-medium outline-none transition-colors",
        "hover:border-primary/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        quick ? "relative min-h-28 flex-col items-start p-4" : "items-center sm:items-start",
      )}
    >
      <item.icon aria-hidden className={cn("size-5 shrink-0", quick ? "text-primary" : "text-muted-foreground", compact ? null : "sm:mt-0.5")} />
      <span className="min-w-0 flex-1">
        <span className={cn("block", quick ? "text-base font-semibold" : "truncate")}>{item.title}</span>
        {compact ? null : (
          <span className={cn("mt-1 text-xs font-normal text-muted-foreground", quick ? "block leading-relaxed" : "hidden sm:line-clamp-2")}>
            {quick ? TASK_HINTS[item.to] ?? item.body : item.body}
          </span>
        )}
      </span>
      {count ? (
        <>
          <span
            aria-hidden
            className={cn("inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 px-1.5 font-mono text-xs font-semibold tabular-nums text-primary", quick && "absolute top-3 right-3")}
          >
            {count > 99 ? "99+" : count}
          </span>
          <span className="sr-only">
            , {count} open
          </span>
        </>
      ) : null}
    </Link>
  );
}
