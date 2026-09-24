import { Fragment, useId, type ComponentType, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpFromLine,
  ArrowUpRight,
  Box,
  Calculator,
  Check,
  ClipboardList,
  Factory,
  Hammer,
  LayoutDashboard,
  ListChecks,
  Repeat,
  ScanLine,
  ScrollText,
  Search,
  Send,
  ShieldAlert,
  Truck,
  Undo2,
  Wrench,
} from "lucide-react";
import { ToneBadge } from "@/app/components/ui";
import { Term } from "@/app/components/term";
import { cn } from "@/lib/utils";
import { FLOOR_VERBS, VERB_LABELS, type FloorVerb } from "@/domain/jobs";
import { GARAGE_MODE_LABEL, MANUFACTURER_MODE_LABEL, garageAllowsPath } from "@/domain/operating-mode";
import { flowStagesFor } from "@/domain/tour";
import { FOCUS_RING, Key, MiniPhone, TAP, pageLabel, type NavigateTo, type TourViewer } from "./shared";

export { BinCodeBreakdown, HierarchyDiagram } from "./hierarchy-diagram";
export type { NavigateTo, TourViewer } from "./shared";

type Icon = ComponentType<{ className?: string }>;

/* ------------------------------------------------------------------ welcome */

function WelcomeTile({
  icon: TileIcon,
  title,
  caption,
  highlight,
}: {
  icon: Icon;
  title: string;
  caption: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center rounded-lg border px-1.5 py-3 text-center sm:px-3",
        highlight ? "border-primary/50 bg-primary/5 ring-2 ring-primary/10" : "bg-card",
      )}
    >
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-md border",
          highlight ? "border-primary/30 bg-card text-primary" : "bg-muted/60 text-foreground",
        )}
      >
        <TileIcon className="size-4" />
      </span>
      <span className="mt-2 text-sm font-medium leading-tight">{title}</span>
      <span className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{caption}</span>
      {highlight ? (
        <span className="mt-2 hidden w-full flex-col gap-0.5 font-mono text-[9px] leading-none text-muted-foreground sm:flex">
          <span className="rounded-sm bg-muted px-1 py-0.5 text-left">RCP +40</span>
          <span className="rounded-sm bg-muted px-1 py-0.5 text-left">PICK −4</span>
          <span className="rounded-sm border border-dashed px-1 py-0.5 text-left text-primary">SHIP −4</span>
        </span>
      ) : null}
    </div>
  );
}

/** Office · one ledger · floor, with both sides writing into the middle. */
export function WelcomeDiagram({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="The office plans and looks, the floor scans and does, and both write every change onto one append-only ledger."
      className={cn("grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 sm:gap-2", className)}
    >
      <WelcomeTile icon={LayoutDashboard} title="Office" caption="Plan and look" />
      <ArrowRight className="size-4 text-muted-foreground sm:size-5" />
      <WelcomeTile icon={ScrollText} title="One ledger" caption="Every change, appended" highlight />
      <ArrowLeft className="size-4 text-muted-foreground sm:size-5" />
      <WelcomeTile icon={ScanLine} title="Floor" caption="Scan and do" />
    </div>
  );
}

/* ------------------------------------------------------------------ flow */

/** Inbound → stock → make → outbound, one lane each, every stop a verb. */
export function FlowDiagram({
  viewer,
  onNavigate,
  className,
}: {
  viewer: TourViewer;
  onNavigate: NavigateTo;
  className?: string;
}) {
  const stages = flowStagesFor(viewer);
  const baseId = useId();
  return (
    <div role="group" aria-label="The day, lane by lane" className={cn("flex flex-col md:flex-row md:items-stretch", className)}>
      {stages.map((stage, index) => {
        const headingId = `${baseId}-${stage.id}`;
        const canOpen = !viewer.garage || garageAllowsPath(stage.path);
        return (
          <Fragment key={stage.id}>
            {index > 0 ? (
              <span aria-hidden className="flex shrink-0 items-center justify-center py-1 text-muted-foreground md:px-0.5 md:py-0">
                <ArrowDown className="size-4 md:hidden" />
                <ArrowRight className="hidden size-4 md:block" />
              </span>
            ) : null}
            <section aria-labelledby={headingId} className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card">
              <header className="flex items-center gap-1.5 border-b bg-muted/40 px-2.5 py-1">
                <span
                  aria-hidden
                  className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[10px] font-semibold tabular-nums text-primary-foreground"
                >
                  {index + 1}
                </span>
                {canOpen ? (
                  <button
                    id={headingId}
                    type="button"
                    onClick={() => onNavigate(stage.path)}
                    title={`Open ${pageLabel(stage.path, viewer.garage)}`}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline",
                      TAP,
                      FOCUS_RING,
                    )}
                  >
                    {stage.title}
                    <ArrowUpRight aria-hidden className="size-3.5" />
                  </button>
                ) : (
                  <p id={headingId} className={cn("flex items-center text-sm font-semibold", TAP)}>
                    {stage.title}
                  </p>
                )}
              </header>
              <ol className="divide-y">
                {stage.stops.map((stop) => (
                  <li key={stop.verb} className="px-2.5 py-2">
                    <p className="text-sm font-medium leading-tight">{stop.verb}</p>
                    {stop.doc ? (
                      <code className="mt-1 inline-block rounded bg-muted px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                        {stop.doc}
                      </code>
                    ) : null}
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{stop.note}</p>
                  </li>
                ))}
              </ol>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ floor pieces */

const VERB_ICONS: Record<FloorVerb, Icon> = {
  receive: Truck,
  putaway: Repeat,
  replenish: ArrowDownToLine,
  pick: ClipboardList,
  pack: Box,
  ship: Send,
  return: Undo2,
  rtv: ArrowUpFromLine,
  count: Calculator,
  assemble: Hammer,
  kit: Factory,
  hold: ShieldAlert,
};

const FLOOR_TABS: { label: string; icon: Icon }[] = [
  { label: "Next job", icon: ListChecks },
  { label: "Scan", icon: ScanLine },
  { label: "My jobs", icon: ClipboardList },
  { label: "Lookup", icon: Search },
];

const MAX_TILES = 8;

/** Which verbs to draw: the person's own, or every verb when none are set. */
function verbTiles(verbs: readonly string[] | undefined): FloorVerb[] {
  const own = verbs?.length ? FLOOR_VERBS.filter((verb) => verbs.includes(verb)) : [];
  return own.length ? own : [...FLOOR_VERBS];
}

function MiniNextJob({ start }: { start?: boolean }) {
  return (
    <div className="rounded-lg border border-primary/30 bg-card p-2">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-primary">Next job</p>
      <p className="mt-0.5 text-xs font-semibold leading-tight">Pick ORD-1042</p>
      <p className="text-[10px] text-muted-foreground">3 lines · start at A-01-02</p>
      {start ? (
        <div className="mt-1.5 flex h-7 items-center justify-center rounded-md bg-primary text-[11px] font-medium text-primary-foreground">
          Start
        </div>
      ) : null}
    </div>
  );
}

function MiniScanBox() {
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-md border border-dashed bg-muted/40 px-2 text-[10px] text-muted-foreground">
      <ScanLine className="size-3.5" />
      Scan anything
      <span className="ml-auto h-3 w-px bg-primary motion-safe:animate-pulse" />
    </div>
  );
}

function MiniVerbTile({ verb, muted, children }: { verb?: FloorVerb; muted?: boolean; children?: string }) {
  const TileIcon = verb ? VERB_ICONS[verb] : null;
  return (
    <div
      className={cn(
        "flex min-h-8 items-center gap-1.5 rounded-md border px-1.5 text-[10px] font-medium leading-tight",
        muted ? "border-dashed text-muted-foreground" : "bg-card",
      )}
    >
      {TileIcon ? <TileIcon className="size-3 shrink-0 text-muted-foreground" /> : null}
      <span className="truncate">{children ?? (verb ? VERB_LABELS[verb] : "")}</span>
    </div>
  );
}

function MiniTabBar() {
  return (
    <div className="grid grid-cols-4 border-t bg-muted/40 py-1.5 text-[9px] leading-none">
      {FLOOR_TABS.map((tab, index) => (
        <span key={tab.label} className={cn("flex flex-col items-center gap-1", index === 0 ? "text-primary" : "text-muted-foreground")}>
          <tab.icon className="size-3.5" />
          {tab.label}
        </span>
      ))}
    </div>
  );
}

/**
 * The operator's own screen: Next job, then the verb tiles they were given (all of them when none
 * were set), then the bottom bar.
 */
export function FloorDiagram({ verbs, className }: { verbs?: readonly string[]; className?: string }) {
  const tiles = verbTiles(verbs);
  const shown = tiles.slice(0, MAX_TILES);
  const more = tiles.length - shown.length;
  const labels = shown.map((verb) => VERB_LABELS[verb]).join(", ");
  return (
    <div
      role="img"
      aria-label={`Your floor screen: the Next job card with a Start button, then verb tiles for ${labels}${more ? ` and ${more} more` : ""}, and a bottom bar with ${FLOOR_TABS.map((tab) => tab.label).join(", ")}.`}
      className={className}
    >
      <MiniPhone className="max-w-[16rem]">
        <div className="space-y-2 p-2">
          <MiniNextJob start />
          <div className="grid grid-cols-2 gap-1.5">
            {shown.map((verb) => (
              <MiniVerbTile key={verb} verb={verb} />
            ))}
            {more > 0 ? <MiniVerbTile muted>{`+${more} more`}</MiniVerbTile> : null}
          </div>
        </div>
        <MiniTabBar />
      </MiniPhone>
    </div>
  );
}

/* ------------------------------------------------------------------ workspaces */

const OFFICE_GROUPS = ["Today", "Analytics", "Inbound", "Stock", "Make", "Outbound", "Setup"];
const GARAGE_OFFICE_GROUPS = ["Bench", "Parts", "Build", "Ship", "Shelf", "Runway", "Shop"];
const WORKSPACE_VERBS: FloorVerb[] = ["receive", "putaway", "pick", "ship"];

function MiniOffice({ groups }: { groups: string[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2.5 py-1.5 text-xs font-medium">
        <LayoutDashboard className="size-3.5 text-muted-foreground" />
        Office
      </div>
      <div className="grid min-h-44 grid-cols-[5.25rem_minmax(0,1fr)]">
        <ul className="space-y-0.5 border-r bg-sidebar p-1.5 text-[11px] text-sidebar-foreground">
          {groups.map((group, index) => (
            <li
              key={group}
              className={cn("rounded px-1.5 py-0.5 leading-tight", index === 0 && "bg-sidebar-accent font-medium text-sidebar-accent-foreground")}
            >
              {group}
            </li>
          ))}
        </ul>
        <div aria-hidden className="space-y-2 p-2.5">
          <div className="h-2.5 w-1/2 rounded bg-foreground/70" />
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((tile) => (
              <div key={tile} className="rounded border p-1.5">
                <div className="h-1.5 w-2/3 rounded bg-muted" />
                <div className="mt-1.5 h-2.5 w-1/2 rounded bg-foreground/50" />
              </div>
            ))}
          </div>
          <div className="space-y-1 rounded border p-1.5">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex gap-1.5">
                <div className="h-1.5 w-1/3 rounded bg-muted" />
                <div className="h-1.5 flex-1 rounded bg-muted/60" />
                <div className="h-1.5 w-6 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Office beside floor, with the keys that jump between them underneath. */
export function WorkspacesDiagram({ garage, className }: { garage: boolean; className?: string }) {
  const groups = garage ? GARAGE_OFFICE_GROUPS : OFFICE_GROUPS;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className={cn("space-y-3", className)}>
      <div
        role="img"
        aria-label={`The office sidebar lists ${groups.join(", ")}. The floor is a phone screen with a Next job card, a scan box, and verb tiles.`}
        className="grid gap-3 sm:grid-cols-2 sm:items-start"
      >
        <MiniOffice groups={groups} />
        <div className="rounded-lg border bg-muted/30 p-2.5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
            <ScanLine className="size-3.5 text-muted-foreground" />
            Floor
          </p>
          <MiniPhone>
            <div className="space-y-2 p-2">
              <MiniNextJob />
              <MiniScanBox />
              <div className="grid grid-cols-2 gap-1.5">
                {WORKSPACE_VERBS.map((verb) => (
                  <MiniVerbTile key={verb} verb={verb} />
                ))}
              </div>
            </div>
            <MiniTabBar />
          </MiniPhone>
        </div>
      </div>
      <ul aria-label="Ways to get around" className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="flex gap-0.5">
            <Key>{mac ? "⌘" : "Ctrl"}</Key>
            <Key>K</Key>
          </span>
          search and jump
        </li>
        <li className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            <Key>g</Key>
            <span className="px-0.5">then</span>
            <Key>t</Key>
          </span>
          go to Today
        </li>
        <li className="flex items-center gap-1.5">
          <Key>?</Key>
          shortcuts
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-flex h-5 items-center justify-center rounded border bg-muted px-1">
            <ScanLine aria-hidden className="size-3" />
          </span>
          scan anywhere
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ modes */

const GARAGE_SHOWS = ["Buy parts, receive, and put away", "Recipes, builds, and kits", "Pick, pack, and ship", "Runway and promise"];
const MANUFACTURER_SHOWS = [
  "Everything on the bench",
  "Yard, ASNs, and waves",
  "Replenishment, holds, and counts",
  "Equipment, 3PL clients, EDI, and traffic",
];

function ModeCard({
  icon: ModeIcon,
  title,
  current,
  shows,
}: {
  icon: Icon;
  title: ReactNode;
  current: boolean;
  shows: string[];
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        current ? "border-primary/50 bg-primary/5 ring-2 ring-primary/10" : "bg-card",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card">
          <ModeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{title}</p>
            {current ? <ToneBadge tone="success">Current</ToneBadge> : null}
          </div>
        </div>
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {shows.map((line) => (
          <li key={line} className="flex items-start gap-1.5">
            <Check aria-hidden className="mt-1 size-3 shrink-0 text-tone-success" strokeWidth={3} />
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Garage Mode beside Manufacturer, the current one marked. Switching stays in Settings. */
export function ModesDiagram({
  garage,
  onNavigate,
  className,
}: {
  garage: boolean;
  onNavigate: NavigateTo;
  className?: string;
}) {
  const settings = "/setup/warehouse";
  const canOpen = !garage || garageAllowsPath(settings);
  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <ModeCard icon={Wrench} title={<Term id="garage-mode">{GARAGE_MODE_LABEL}</Term>} current={garage} shows={GARAGE_SHOWS} />
        <ModeCard icon={Factory} title={MANUFACTURER_MODE_LABEL} current={!garage} shows={MANUFACTURER_SHOWS} />
      </div>
      <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
        Switching lives in Settings.
        {canOpen ? (
          <button
            type="button"
            onClick={() => onNavigate(settings)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1 font-medium text-primary underline-offset-4 hover:underline",
              TAP,
              FOCUS_RING,
            )}
          >
            Open {pageLabel(settings, garage)}
            <ArrowRight aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </p>
    </div>
  );
}
