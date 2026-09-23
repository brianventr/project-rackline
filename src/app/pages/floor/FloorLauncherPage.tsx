import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
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
import { useScanner } from "../../scanner/ScannerProvider";
import { useApiQuery } from "../../query";
import { api, type FloorJob, type Item } from "../../api";
import { VERB_LABELS, type FloorVerb, isFloorVerb } from "@/domain/jobs";
import { garageAllowsPath, isGarageMode, pathOnly } from "@/domain/operating-mode";
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

type Icon = ComponentType<{ className?: string }>;

type VerbTile = { to: string; title: string; body: string; verb?: FloorVerb; icon: Icon };

const verbs: VerbTile[] = [
  { to: "/floor/lookup", title: "Lookup", body: "Scan a SKU, bay, document, serial, or lot.", icon: Search },
  { to: "/floor/print", title: "Print", body: "Print a bay, SKU, pick list, pack slip, or shipping label.", icon: Printer },
  { to: "/floor/receive", title: "Receive", body: "Post a receipt or purchase onto the dock, including partials.", verb: "receive", icon: Truck },
  { to: "/floor/asn", title: "ASN", body: "Scan an ASN- notice and receive onto the dock.", icon: Package },
  { to: "/floor/yard", title: "Yard", body: "Scan a YRD- visit to check in, dock, or check out.", icon: Warehouse },
  { to: "/floor/checkout", title: "Check out", body: "Scan a truck, inspect it, bind a shift or ticket.", icon: Forklift },
  { to: "/floor/putaway", title: "Put away", body: "Put away a vendor BOX-/SSCC, post remaining on a ticket, or scan the dock to a bulk bay.", verb: "putaway", icon: Repeat },
  { to: "/floor/replenish", title: "Replenish", body: "Move remaining qty from bulk onto a pick face below min.", verb: "replenish", icon: ArrowDownToLine },
  { to: "/floor/pick", title: "Pick", body: "Go to the suggested bay, open a pick map, pick remaining qty, or unpick / cancel.", verb: "pick", icon: ClipboardList },
  { to: "/floor/wave", title: "Wave", body: "Scan a WAV- wave; batch-pick aggregated SKUs when mode is batch.", icon: Layers },
  { to: "/floor/pack", title: "Pack", body: "Pack remaining qty, print a pack slip, close the box.", verb: "pack", icon: Box },
  { to: "/floor/ship", title: "Ship", body: "Buy a label, close the order, fulfill Shopify.", verb: "ship", icon: Send },
  { to: "/floor/return", title: "Return", body: "Receive an RMA: restock, scrap, or hold at the dock.", verb: "return", icon: Undo2 },
  { to: "/floor/rtv", title: "Vendor return", body: "Ship remaining qty back to the vendor from a bay.", verb: "rtv", icon: ArrowUpFromLine },
  { to: "/floor/count", title: "Count", body: "Blind-count a bay. System qty stays hidden until you post.", verb: "count", icon: Calculator },
  { to: "/floor/hold", title: "Hold", body: "Lock a bay, SKU, or lot so pick and replenish skip it.", verb: "hold", icon: ShieldAlert },
  { to: "/floor/assemble", title: "Assemble", body: "Complete a work order on the bench.", verb: "assemble", icon: Hammer },
  { to: "/floor/kit", title: "Kit", body: "Build a finished SKU from its recipe in one step.", verb: "kit", icon: Factory },
];

const adjustTile: VerbTile = {
  to: "/floor/adjust",
  title: "Adjust",
  body: "Signed qty change with a reason.",
  icon: SlidersHorizontal,
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
  const scanner = useScanner();
  const [claimError, setClaimError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [usage, recordTap] = useFloorUsage(me.user.id);
  const garage = isGarageMode(me.organization.operatingMode);
  const allowed = new Set(me.floorVerbs ?? []);
  const items = [
    ...verbs.filter((item) => !item.verb || allowed.has(item.verb) || me.role === "owner"),
    ...(me.role === "owner" ? [adjustTile] : []),
  ].filter((item) => !garage || garageAllowsPath(item.to));

  const warehouseQuery = warehouseId ? `warehouseId=${encodeURIComponent(warehouseId)}` : "";
  const nextQ = useApiQuery<FloorJob[]>(`/api/jobs/next${warehouseQuery ? `?${warehouseQuery}` : ""}`, {
    refetchOnMount: "always",
  });
  const openQ = useApiQuery<FloorJob[]>(`/api/jobs?open=1${warehouseQuery ? `&${warehouseQuery}` : ""}`, {
    refetchOnMount: "always",
  });

  const keep = useCallback((job: FloorJob) => !garage || garageAllowsPath(job.floorPath), [garage]);
  const nextJobs = useMemo(() => (nextQ.data ?? []).filter(keep), [nextQ.data, keep]);
  const openJobs = useMemo(() => (openQ.data ?? []).filter(keep), [openQ.data, keep]);
  const mine = useMemo(() => openJobs.filter((job) => job.assigneeId === me.user.id), [openJobs, me.user.id]);
  const counts = useMemo(() => openWorkByVerb(openJobs, me.user.id), [openJobs, me.user.id]);

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

  const loaded = !nextQ.isLoading && !openQ.isLoading;
  const error = claimError ?? nextQ.error?.message ?? openQ.error?.message ?? null;
  const recentScan = scanner.lastScan && scanner.lastScan.at >= mountedAt ? scanner.lastScan : null;

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
    <div className="space-y-4">
      <PageHeader
        eyebrow={garage ? "Garage Mode" : "Floor"}
        title={garage ? "What are you making?" : "What are you doing?"}
        description={
          garage
            ? "Founder bench. Receive, make, pick, and ship. Unassigned work stays pickable — scan first, or pick a verb."
            : "Next job is ranked from the same ledger. Unassigned work stays pickable — scan first, or pick a verb."
        }
      />
      <MyDayCard />
      <ErrorBanner error={error} />
      {recentScan ? (
        <div role="status" className="flex items-center gap-2 rounded-lg border bg-card py-1 pl-3 pr-1 text-sm">
          <ScanLine aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            Scanned <span className="break-all font-mono font-semibold">{recentScan.raw}</span>. Pick a verb to use it.
          </span>
          <Link
            to="/floor/lookup"
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Look it up
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>
      ) : null}

      <section id={FLOOR_ANCHORS.next} aria-labelledby="floor-next-heading" className="scroll-mt-16">
        <h2 id="floor-next-heading" className="sr-only">
          Next job
        </h2>
        {next ? (
          <NextJobCard job={next} item={nextItem} starting={starting} onStart={() => void startNext()} />
        ) : nextQ.isLoading ? (
          <Skeleton className="h-44 w-full rounded-xl" />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="Nothing ranked for you right now."
            body="Unassigned work is on the verb screens below."
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

      <section id={FLOOR_ANCHORS.mine} aria-labelledby="floor-mine-heading" className="scroll-mt-16 space-y-1.5">
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
                    className="flex min-h-14 items-center gap-3 px-3 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                    to={job.floorPath}
                    onClick={() => recordTap(job.floorPath)}
                  >
                    <JobIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        <span className="font-medium">{verbLabel(job.verb)}</span>{" "}
                        {job.number ? <span className="font-mono">{job.number}</span> : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            {openQ.isLoading ? "Loading your jobs…" : "Nothing assigned to you. Start the next job or pick a verb."}
          </p>
        )}
      </section>

      {usual.length ? (
        <section aria-labelledby="floor-usual-heading" className="space-y-1.5">
          <SectionLabel id="floor-usual-heading">Your usual</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {usual.map((item) => (
              <VerbTileLink
                key={item.to}
                item={item}
                count={item.verb ? counts[item.verb] : undefined}
                compact
                onTap={recordTap}
              />
            ))}
          </div>
        </section>
      ) : null}

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`floor-group-${group.id}`} className="space-y-1.5">
          <SectionLabel id={`floor-group-${group.id}`}>{group.label}</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {group.tiles.map((item) => (
              <VerbTileLink
                key={item.to}
                item={item}
                count={item.verb ? counts[item.verb] : undefined}
                onTap={recordTap}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SectionLabel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
    <div className="overflow-hidden rounded-xl border border-primary/30 bg-card shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b border-primary/15 bg-primary/5 px-4 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Next job</p>
        {reason ? <p className="min-w-0 truncate text-xs font-medium text-tone-warning">{reason}</p> : null}
      </div>
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {job.itemId ? (
            <SkuThumb
              sku={item?.sku ?? job.number ?? "?"}
              name={item?.name}
              imageUrl={imageUrl}
              size="lg"
              className="size-20 text-sm sm:size-24"
            />
          ) : (
            <div
              aria-hidden
              className="flex size-20 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary sm:size-24"
            >
              <JobIcon className="size-8" />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xl font-semibold leading-tight tracking-tight">
              {verbLabel(job.verb)}
              {job.number ? <span className="ml-1.5 font-mono">{job.number}</span> : null}
            </p>
            {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
            {route ? (
              <p className="flex items-center gap-1.5 font-mono text-base font-semibold">
                <span className="sr-only">Bay </span>
                {route}
              </p>
            ) : null}
            {job.qty != null ? (
              <p className="text-sm text-muted-foreground">
                Qty <span className="font-mono text-base font-semibold text-foreground">{job.qty}</span>
              </p>
            ) : null}
          </div>
        </div>
        <Button className="h-14 w-full text-base sm:w-44" disabled={starting} onClick={onStart}>
          {starting ? <Loader2 className="size-5 animate-spin" /> : null}
          Start
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
  onTap,
}: {
  item: VerbTile;
  count: number | undefined;
  compact?: boolean;
  onTap: (path: string) => void;
}) {
  return (
    <Link
      to={item.to}
      title={item.body}
      onClick={() => onTap(item.to)}
      className={cn(
        "flex min-h-14 items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium outline-none transition-colors",
        "hover:border-primary/40 hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        compact ? null : "sm:items-start",
      )}
    >
      <item.icon className={cn("size-5 shrink-0 text-muted-foreground", compact ? null : "sm:mt-0.5")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.title}</span>
        {compact ? null : (
          <span className="mt-0.5 hidden text-xs font-normal text-muted-foreground sm:line-clamp-2">{item.body}</span>
        )}
      </span>
      {count ? (
        <>
          <span
            aria-hidden
            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[11px] font-semibold tabular-nums text-primary-foreground"
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
