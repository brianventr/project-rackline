import { Fragment, useId, useState } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Term } from "@/app/components/term";
import { cn } from "@/lib/utils";
import {
  HIERARCHY_GROUPS,
  binCodeParts,
  formatBinAddress,
  hierarchyLevel,
  hierarchyLevelsIn,
  hierarchyPathFor,
  parseBinCode,
  type BinCodePart,
  type HierarchyGroup,
  type HierarchyLevel,
  type HierarchyLevelId,
} from "@/domain/hierarchy";
import { FOCUS_RING, TAP, pageLabel, type NavigateTo, type TourViewer } from "./shared";

/* ------------------------------------------------------------------ chips */

function LevelChip({
  level,
  active,
  onSelect,
  className,
}: {
  level: HierarchyLevel;
  active: boolean;
  onSelect: (id: HierarchyLevelId) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(level.id)}
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 text-xs font-medium leading-none motion-safe:transition-colors",
        TAP,
        FOCUS_RING,
        active
          ? "border-primary/50 bg-primary/10 text-foreground ring-2 ring-primary/10"
          : "bg-card text-foreground/80 hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {level.title}
    </button>
  );
}

/** Organization contains warehouse contains area … contains bin: one box inside the next. */
function NestedBoxes({
  levels,
  selected,
  onSelect,
  depth = 0,
}: {
  levels: HierarchyLevel[];
  selected: HierarchyLevelId;
  onSelect: (id: HierarchyLevelId) => void;
  depth?: number;
}) {
  const [level, ...rest] = levels;
  if (!level) return null;
  const active = level.id === selected;
  return (
    <div
      className={cn(
        "rounded-md border p-1 pl-1.5 sm:pl-2",
        depth % 2 ? "bg-card" : "bg-muted/40",
        active && "border-primary/50",
      )}
    >
      <LevelChip level={level} active={active} onSelect={onSelect} />
      {rest.length ? (
        <div className="mt-1">
          <NestedBoxes levels={rest} selected={selected} onSelect={onSelect} depth={depth + 1} />
        </div>
      ) : null}
    </div>
  );
}

/** SKU → on hand → overlays, as a short vertical chain. */
function Chain({
  levels,
  selected,
  onSelect,
}: {
  levels: HierarchyLevel[];
  selected: HierarchyLevelId;
  onSelect: (id: HierarchyLevelId) => void;
}) {
  return (
    <div className="flex flex-col items-stretch">
      {levels.map((level, index) => (
        <Fragment key={level.id}>
          {index > 0 ? <ArrowDown aria-hidden className="mx-auto my-0.5 size-4 text-muted-foreground" /> : null}
          <LevelChip level={level} active={level.id === selected} onSelect={onSelect} className="w-full justify-center" />
        </Fragment>
      ))}
    </div>
  );
}

function GroupColumn({
  group,
  selected,
  onSelect,
}: {
  group: HierarchyGroup;
  selected: HierarchyLevelId;
  onSelect: (id: HierarchyLevelId) => void;
}) {
  const levels = hierarchyLevelsIn(group.id);
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="min-w-0">
      <p id={headingId} className="mb-1.5 text-sm font-semibold leading-tight">
        {group.title}
        <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{group.question}</span>
      </p>
      {group.id === "where" ? (
        <NestedBoxes levels={levels} selected={selected} onSelect={onSelect} />
      ) : (
        <Chain levels={levels} selected={selected} onSelect={onSelect} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the detail card */

function LevelDetail({ level, viewer, onNavigate }: { level: HierarchyLevel; viewer: TourViewer; onNavigate: NavigateTo }) {
  const group = HIERARCHY_GROUPS.find((row) => row.id === level.group);
  const path = hierarchyPathFor(level, viewer);
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="rounded-lg border bg-muted/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 id={titleId} className="text-sm font-semibold">
          {level.title}
        </h3>
        {group ? (
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{group.title}</span>
        ) : null}
        {level.term ? (
          <span className="text-xs text-muted-foreground">
            Glossary: <Term id={level.term} />
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm">{level.short}</p>
      <p className="mt-1 text-sm text-muted-foreground">{level.long}</p>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          For example{" "}
          <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs text-foreground ring-1 ring-border">{level.example}</code>
        </p>
        {path ? (
          <button
            type="button"
            onClick={() => onNavigate(path)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 text-xs font-medium text-primary underline-offset-4 hover:underline",
              TAP,
              FOCUS_RING,
            )}
          >
            Open {pageLabel(path, viewer.garage)}
            <ArrowRight aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ bin codes */

const PART_TONE: Record<BinCodePart["id"], string> = {
  aisle: "text-tone-info",
  rack: "text-tone-progress",
  bay: "text-tone-success",
  level: "text-tone-warning",
};

/**
 * "A-01-02-2" in large monospace, split into coloured parts with a label under each. Level 1 is not
 * written in a code, so for "A-01-02" the level part draws dashed and says so. Reused by the setup
 * wizard, so it takes any code; a dock or bench name that is not an address says that instead.
 */
export function BinCodeBreakdown({ code, className }: { code: string; className?: string }) {
  const address = parseBinCode(code);
  const shown = code.trim().toUpperCase();
  if (!address) {
    return (
      <div className={cn("rounded-lg border bg-card p-3 sm:p-4", className)}>
        <p className="text-center font-mono text-2xl font-semibold tabular-nums sm:text-3xl">{shown}</p>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Not a storage address. Docks, benches, and outbound bays go by name.
        </p>
      </div>
    );
  }
  const parts = binCodeParts(address);
  const spoken = parts
    .map((part) => `${part.label.toLowerCase()} ${part.value}${part.implied ? " (left off the code)" : ""}`)
    .join(", ");
  return (
    <div className={cn("rounded-lg border bg-card p-3 sm:p-4", className)}>
      <div
        role="img"
        aria-label={`${shown} reads ${spoken}`}
        className="flex flex-wrap items-start justify-center gap-x-1 gap-y-2 font-mono"
      >
        {parts.map((part, index) => (
          <Fragment key={part.id}>
            {index > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "text-2xl font-semibold leading-tight text-muted-foreground sm:text-3xl",
                  part.implied && "opacity-40",
                )}
              >
                -
              </span>
            ) : null}
            <span className={cn("flex flex-col items-center", PART_TONE[part.id])}>
              <span
                className={cn(
                  "px-1 text-2xl font-semibold leading-tight tabular-nums sm:text-3xl",
                  part.implied
                    ? "rounded-md border border-dashed border-muted-foreground/60 text-muted-foreground"
                    : "border-b-2 border-current",
                )}
              >
                {part.value}
              </span>
              <span
                className={cn(
                  "mt-1 whitespace-nowrap font-sans text-[10px] font-medium uppercase tracking-wide",
                  part.implied && "text-muted-foreground",
                )}
              >
                {part.implied ? "Level 1 (left off)" : part.label}
              </span>
            </span>
          </Fragment>
        ))}
      </div>
      <p className="mt-2.5 text-center text-sm text-muted-foreground">{formatBinAddress(address)}</p>
    </div>
  );
}

const EXAMPLE_CODES = ["A-01-02-2", "A-01-02"] as const;

/* ------------------------------------------------------------------ the diagram */

/**
 * The teaching centrepiece: the three questions as three columns, every level a chip, and a card
 * for the chosen one. The where-column nests its boxes so containment is visible; the other two
 * are short chains. Under it, a storage code taken apart.
 */
export function HierarchyDiagram({
  viewer,
  onNavigate,
  className,
}: {
  viewer: TourViewer;
  onNavigate: NavigateTo;
  className?: string;
}) {
  const [selected, setSelected] = useState<HierarchyLevelId>("bin");
  const [code, setCode] = useState<string>(EXAMPLE_CODES[0]);
  const level = hierarchyLevel(selected);
  const codeHeadingId = useId();

  return (
    <div className={cn("space-y-3", className)}>
      {/* The where-column is tall (eight nested boxes), so the two chains and the detail card sit beside it
          on wide screens: picking a chip then updates a card that is already on screen. */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <GroupColumn group={HIERARCHY_GROUPS[0]!} selected={selected} onSelect={setSelected} />
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 grid-cols-2">
            {HIERARCHY_GROUPS.slice(1).map((group) => (
              <GroupColumn key={group.id} group={group} selected={selected} onSelect={setSelected} />
            ))}
          </div>
          <LevelDetail level={level} viewer={viewer} onNavigate={onNavigate} />
        </div>
      </div>

      <section aria-labelledby={codeHeadingId} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={codeHeadingId} className="text-sm font-semibold">
            Read a storage code
            <span className="block text-xs font-normal text-muted-foreground">
              Aisle, rack, bay, then level. Level 1 is left off, so both of these are the same bay.
            </span>
          </p>
          <div role="group" aria-label="Example code" className="flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5">
            {EXAMPLE_CODES.map((example) => {
              const active = code === example;
              return (
                <button
                  key={example}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCode(example)}
                  className={cn(
                    "rounded px-2.5 font-mono text-xs motion-safe:transition-colors",
                    TAP,
                    FOCUS_RING,
                    active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {example}
                </button>
              );
            })}
          </div>
        </div>
        <BinCodeBreakdown code={code} />
      </section>
    </div>
  );
}
