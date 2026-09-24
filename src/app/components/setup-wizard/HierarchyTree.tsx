import { useState, type ReactNode } from "react";
import { Box, ChevronRight, Columns3, Hammer, LayoutGrid, Rows3, Truck, Warehouse, type LucideIcon } from "lucide-react";
import { ToneBadge } from "@/app/components/ui";
import type { HierarchyNode, HierarchyNodeKind } from "@/domain/hierarchy";
import { cn } from "@/lib/utils";

const EMPTY_CODES: ReadonlySet<string> = new Set();

/**
 * Warehouse → areas → racks → bays → bins as a nested, collapsible list. Reads the tree from
 * `buildHierarchyTree`, so planned bins draw the same way as real ones; codes in `highlightCodes`
 * carry a "new" badge, and a closed node shows how many bins sit under it.
 */
export function HierarchyTree({
  tree,
  highlightCodes = EMPTY_CODES,
  defaultOpenDepth = 2,
  className,
}: {
  tree: HierarchyNode;
  /** Bin, bay, or rack codes to mark as new. An area or rack whose every child is new is new too; the building never is. */
  highlightCodes?: ReadonlySet<string>;
  /** Levels open on first render: 2 opens the warehouse and its areas and leaves racks closed. */
  defaultOpenDepth?: number;
  className?: string;
}) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  function isOpen(node: HierarchyNode, depth: number): boolean {
    return toggled[node.key] ?? depth < defaultOpenDepth;
  }

  function toggle(node: HierarchyNode, depth: number) {
    setToggled((prev) => ({ ...prev, [node.key]: !isOpen(node, depth) }));
  }

  return (
    <ul className={cn("m-0 list-none p-0 text-sm", className)} aria-label={`${tree.label} hierarchy`}>
      <TreeNode node={tree} depth={0} highlight={highlightCodes} isOpen={isOpen} toggle={toggle} />
    </ul>
  );
}

const KIND_ICON: Record<HierarchyNodeKind, LucideIcon> = {
  warehouse: Warehouse,
  area: LayoutGrid,
  rack: Rows3,
  bay: Columns3,
  bin: Box,
};

/** Docks and outbound bays get their own glyphs so the areas read at a glance. */
function iconFor(node: HierarchyNode): LucideIcon {
  if (node.kind === "area" || node.kind === "bin") {
    if (node.note?.startsWith("Dock")) return Truck;
    if (node.note?.startsWith("Bench")) return Hammer;
    if (node.note?.startsWith("Outbound")) return Truck;
  }
  return KIND_ICON[node.kind];
}

function isNew(node: HierarchyNode, highlight: ReadonlySet<string>): boolean {
  if (node.code && highlight.has(node.code)) return true;
  // The building itself is never new: it exists before the first bin does.
  if (node.kind === "bin" || node.kind === "warehouse") return false;
  return node.children.length > 0 && node.children.every((child) => isNew(child, highlight));
}

function TreeNode({
  node,
  depth,
  highlight,
  isOpen,
  toggle,
}: {
  node: HierarchyNode;
  depth: number;
  highlight: ReadonlySet<string>;
  isOpen: (node: HierarchyNode, depth: number) => boolean;
  toggle: (node: HierarchyNode, depth: number) => void;
}) {
  const hasChildren = node.children.length > 0;
  const open = hasChildren && isOpen(node, depth);
  const fresh = isNew(node, highlight);
  const Icon = iconFor(node);
  const showCode = node.code && node.code !== node.label;

  return (
    <li className="m-0 p-0">
      <div
        className={cn(
          "flex min-h-8 items-center gap-1.5 rounded-md pr-1.5",
          node.kind === "warehouse" && "font-medium",
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggle(node, depth)}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ChevronRight
              aria-hidden
              className={cn("size-4 motion-safe:transition-transform motion-safe:duration-150", open && "rotate-90")}
            />
            <span className="sr-only">
              {open ? "Collapse" : "Expand"} {node.label}
            </span>
          </button>
        ) : (
          <span aria-hidden className="size-8 shrink-0" />
        )}
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{node.label}</span>
        {showCode ? <code className="shrink-0 font-mono text-xs text-muted-foreground">{node.code}</code> : null}
        {node.note ? <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{node.note}</span> : null}
        {fresh ? (
          <ToneBadge tone="info" dot={false} className="shrink-0">
            new
          </ToneBadge>
        ) : null}
        {hasChildren && !open ? (
          <CountPill>
            {node.count} {node.count === 1 ? "bin" : "bins"}
          </CountPill>
        ) : null}
      </div>
      {open ? (
        <ul className="m-0 ml-4 list-none border-l pl-1">
          {node.children.map((child) => (
            <TreeNode key={child.key} node={child} depth={depth + 1} highlight={highlight} isOpen={isOpen} toggle={toggle} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CountPill({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums leading-none text-muted-foreground">
      {children}
    </span>
  );
}
