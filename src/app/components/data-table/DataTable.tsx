import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  columnVisibilityFeature,
  constructSortFn,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Download,
  ListFilter,
  Loader2,
  Search,
  SearchX,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table as UiTable, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { EmptyState, ErrorBanner, SkeletonRows, TABLE_FRAME } from "../ui";
import { useConfirm, type ConfirmOptions } from "../confirm";
import {
  compareSortValues,
  countTabs,
  facetOptions,
  filterRows,
  parseFacetParam,
  parseSortParam,
  sortParam,
  toCsv,
  type FacetDef,
  type ListSort,
  type SortValue,
  type TabDef,
} from "./table-state";

export type { FacetDef, TabDef, ListSort } from "./table-state";

export type DataColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Present → the column sorts on this value. */
  sortValue?: (row: T) => SortValue;
  /** Value written to CSV export. Defaults to `sortValue`. */
  csv?: (row: T) => string | number | null | undefined;
  className?: string;
  align?: "left" | "right";
  /** Columns can be hidden from the Columns menu unless this is false. */
  hideable?: boolean;
  defaultHidden?: boolean;
};

export type BulkAction<T> = {
  label: string;
  icon?: LucideIcon;
  tone?: "default" | "danger";
  run: (rows: T[]) => Promise<unknown> | unknown;
  /** Ask first. Danger actions should always confirm. */
  confirm?: (rows: T[]) => ConfirmOptions;
  /** Hide the action unless every selected row qualifies. */
  when?: (rows: T[]) => boolean;
};

export type DataTableProps<T extends object> = {
  /** Stable id; column choices persist per browser under it. */
  id: string;
  data: readonly T[] | undefined;
  columns: DataColumn<T>[];
  getRowId: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  rowHref?: (row: T) => string | null | undefined;
  search?: { placeholder?: string; text: (row: T) => string };
  tabs?: TabDef<T>[];
  defaultTab?: string;
  facets?: FacetDef<T>[];
  defaultSort?: ListSort;
  bulkActions?: BulkAction<T>[];
  /** Right side of the tab row, e.g. a New button. */
  toolbar?: ReactNode;
  /** Shown when there are no rows at all (before any filter). */
  empty?: ReactNode;
  pageSize?: number;
  /** File name stem for Export CSV. Omit to hide export. */
  exportName?: string;
  rowClassName?: (row: T) => string | undefined;
  /** Prefix for URL params when a page shows more than one table. */
  paramPrefix?: string;
};

const EMPTY: never[] = [];

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnVisibilityFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    smart: constructSortFn({ sort: (a: SortValue, b: SortValue) => compareSortValues(a, b) }),
  },
});

function resolve<S>(updater: S | ((old: S) => S), previous: S): S {
  return typeof updater === "function" ? (updater as (old: S) => S)(previous) : updater;
}

function readVisibility(id: string, columns: DataColumn<object>[]): ColumnVisibilityState {
  const defaults: ColumnVisibilityState = {};
  for (const column of columns) if (column.defaultHidden) defaults[column.id] = false;
  try {
    const raw = window.localStorage.getItem(`rackline-columns:${id}`);
    return raw ? { ...defaults, ...(JSON.parse(raw) as ColumnVisibilityState) } : defaults;
  } catch {
    return defaults;
  }
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("a,button,input,select,textarea,label,[role=checkbox],[role=menuitem]");
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The list view every office page shares: status tabs with counts, search, facet filters,
 * sortable columns, paging, column picker, CSV export, and bulk actions on selected rows.
 * Tab, search, sort, facets, and page live in the URL so any view is a shareable link.
 */
export function DataTable<T extends object>({
  id,
  data,
  columns,
  getRowId,
  loading,
  error,
  rowHref,
  search,
  tabs,
  defaultTab,
  facets,
  defaultSort,
  bulkActions,
  toolbar,
  empty,
  pageSize = 50,
  exportName,
  rowClassName,
  paramPrefix = "",
}: DataTableProps<T>) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const key = (name: string) => `${paramPrefix}${name}`;
  const rows = data ?? (EMPTY as T[]);

  const tabId = params.get(key("tab")) ?? defaultTab ?? tabs?.[0]?.id ?? null;
  const activeTab = tabs?.find((tab) => tab.id === tabId) ?? null;
  const query = params.get(key("q")) ?? "";
  const sortable = columns.filter((column) => column.sortValue).map((column) => column.id);
  const sort = parseSortParam(params.get(key("sort")), sortable) ?? defaultSort ?? null;
  const page = Math.max(1, Number(params.get(key("page")) || 1));
  const facetState = (facets ?? []).map((def) => ({ def, selected: parseFacetParam(params.get(key(def.id))) }));
  const facetKey = facetState.map((facet) => facet.selected.join(",")).join("|");

  function update(changes: Record<string, string | null>, resetPage = true) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [name, value] of Object.entries(changes)) {
          if (value == null || value === "") next.delete(key(name));
          else next.set(key(name), value);
        }
        if (resetPage && !("page" in changes)) next.delete(key("page"));
        return next;
      },
      { replace: true },
    );
  }

  // Search and facets narrow first; tab counts are computed on that set so badges match a click.
  const narrowed = useMemo(
    () =>
      filterRows(rows, {
        facets: facetState,
        search: search ? { text: search.text, query } : null,
      }),
    [rows, query, facetKey],
  );
  const tabCounts = useMemo(() => (tabs ? countTabs(narrowed, tabs) : {}), [narrowed, tabs]);
  // Keyed on the tab id, not the tab object, so inline `tabs` props do not hand the table new data every render.
  const visibleRows = useMemo(
    () => (activeTab ? narrowed.filter((row) => activeTab.match(row)) : narrowed),
    [narrowed, activeTab?.id],
  );

  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(() =>
    readVisibility(id, columns as DataColumn<object>[]),
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setRowSelection({});
  }, [tabId, query, facetKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`rackline-columns:${id}`, JSON.stringify(columnVisibility));
    } catch {
      /* Column choices are a convenience. */
    }
  }, [id, columnVisibility]);

  const selectable = !!bulkActions?.length;
  const tableColumns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    const defs = columns.map((column, index) =>
      helper.accessor(
        (row: T) => {
          const value = column.sortValue?.(row);
          return value === null || value === "" ? undefined : value;
        },
        {
          id: column.id,
          header: column.header,
          enableSorting: !!column.sortValue,
          enableHiding: column.hideable ?? index > 0,
          sortFn: "smart",
          sortUndefined: "last",
        },
      ),
    );
    return helper.columns(defs);
  }, [columns]);

  const sorting: SortingState = sort ? [sort] : [];
  const pagination: PaginationState = { pageIndex: page - 1, pageSize };

  const table = useTable({
    features,
    columns: tableColumns,
    data: visibleRows,
    getRowId: (row: T) => getRowId(row),
    enableSortingRemoval: true,
    // Page, sort, and selection resets are driven from the URL above; auto-resets would fight them.
    autoResetAll: false,
    state: { sorting, pagination, columnVisibility, rowSelection },
    onSortingChange: (updater) => {
      const next = resolve(updater, sorting)[0] ?? null;
      update({ sort: sortParam(next) });
    },
    onPaginationChange: (updater) => {
      const next = resolve(updater, pagination);
      update({ page: next.pageIndex > 0 ? String(next.pageIndex + 1) : null }, false);
    },
    onColumnVisibilityChange: (updater) => setColumnVisibility((old) => resolve(updater, old)),
    onRowSelectionChange: (updater) => setRowSelection((old) => resolve(updater, old)),
  });

  const pageRows = table.getRowModel().rows;
  const pageCount = Math.max(1, table.getPageCount());
  const selectedRows = selectable ? table.getSelectedRowModel().rows.map((row) => row.original) : [];
  const leafColumns = table.getVisibleLeafColumns();
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const filtersActive = !!query || facetState.some((facet) => facet.selected.length > 0);

  useEffect(() => {
    if (!loading && page > pageCount) update({ page: null }, false);
  }, [loading, page, pageCount]);

  async function runBulk(action: BulkAction<T>) {
    const targets = selectedRows;
    if (!targets.length) return;
    if (action.confirm) {
      const ok = await confirm(action.confirm(targets));
      if (!ok) return;
    }
    setBusy(action.label);
    try {
      await action.run(targets);
      setRowSelection({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action.label} failed`);
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    // Headerless columns hold row actions, not data.
    const shown = columns.filter((column) => column.header && table.getColumn(column.id)?.getIsVisible() !== false);
    const sorted = table.getPrePaginatedRowModel().rows.map((row) => row.original);
    const text = toCsv(
      shown.map((column) => column.header),
      sorted.map((row) =>
        shown.map((column) => {
          const value = column.csv ? column.csv(row) : column.sortValue?.(row);
          return typeof value === "boolean" ? (value ? "yes" : "no") : value;
        }),
      ),
    );
    download(exportName ?? id, text);
  }

  function onRowClick(event: MouseEvent<HTMLTableRowElement>, row: T) {
    if (!rowHref || isInteractive(event.target)) return;
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    const href = rowHref(row);
    if (!href) return;
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
    else navigate(href);
  }

  const availableBulk = (bulkActions ?? []).filter((action) => !action.when || action.when(selectedRows));
  const firstShown = visibleRows.length ? pagination.pageIndex * pageSize + 1 : 0;
  const lastShown = Math.min(visibleRows.length, (pagination.pageIndex + 1) * pageSize);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {tabs?.length || toolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {tabs?.length ? (
            <div role="tablist" aria-label="Status" className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border bg-card p-1 shadow-xs">
              {tabs.map((tab) => {
                const active = tab.id === activeTab?.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => update({ tab: tab.id === (defaultTab ?? tabs[0]?.id) ? null : tab.id })}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
                      active && "bg-muted text-foreground",
                    )}
                  >
                    {tab.label}
                    <span
                      className={cn(
                        "min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums",
                        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {loading ? "·" : (tabCounts[tab.id] ?? 0)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <span />
          )}
          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      {selectable && selectedRows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5">
          <span className="text-sm font-medium">{selectedRows.length} selected</span>
          <span className="mx-1 h-4 w-px bg-border" />
          {availableBulk.map((action) => (
            <Button
              key={action.label}
              size="sm"
              variant={action.tone === "danger" ? "destructive" : "outline"}
              disabled={!!busy}
              onClick={() => void runBulk(action)}
            >
              {busy === action.label ? <Loader2 className="animate-spin" /> : action.icon ? <action.icon /> : null}
              {action.label}
            </Button>
          ))}
          {availableBulk.length === 0 ? (
            <span className="text-sm text-muted-foreground">No action fits every selected row.</span>
          ) : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRowSelection({})}>
            <X />
            Clear
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {search ? (
            <div className="relative min-w-48 flex-1 sm:max-w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => update({ q: event.target.value })}
                placeholder={search.placeholder ?? "Search"}
                aria-label={search.placeholder ?? "Search"}
                className="h-8 bg-card pl-8 text-sm"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => update({ q: null })}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}
          {facetState.map(({ def, selected }) => (
            <FacetMenu
              key={def.id}
              def={def}
              selected={selected}
              options={facetOptions(rows, def)}
              onChange={(values) => update({ [def.id]: values.join(",") || null })}
            />
          ))}
          {filtersActive ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                update({ q: null, ...Object.fromEntries(facetState.map(({ def }) => [def.id, null])) })
              }
            >
              Reset
              <X />
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {loading ? "Loading…" : `${visibleRows.length} ${visibleRows.length === 1 ? "row" : "rows"}`}
            </span>
            <ColumnsMenu
              columns={columns}
              isVisible={(columnId) => table.getColumn(columnId)?.getIsVisible() !== false}
              toggle={(columnId, visible) => table.getColumn(columnId)?.toggleVisibility(visible)}
            />
            {exportName ? (
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={!visibleRows.length} aria-label="Export CSV">
                <Download />
                <span className="hidden md:inline">Export</span>
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <ErrorBanner error={error ?? null} />

      {!loading && rows.length === 0 && !error ? (
        (empty ?? <EmptyState title="Nothing here yet." />)
      ) : (
        <div className={TABLE_FRAME}>
          <UiTable>
            <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
              <TableRow className="hover:bg-transparent">
                {selectable ? (
                  <TableHead className="w-8">
                    <Checkbox
                      aria-label="Select all rows on this page"
                      checked={
                        table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false
                      }
                      onCheckedChange={(value) => table.toggleAllPageRowsSelected(value === true)}
                    />
                  </TableHead>
                ) : null}
                {leafColumns.map((column) => {
                  const def = columnById.get(column.id);
                  const sorted = column.getIsSorted();
                  return (
                    <TableHead
                      key={column.id}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className={cn(
                        "text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                        def?.align === "right" && "text-right",
                        def?.className,
                      )}
                    >
                      {column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={column.getToggleSortingHandler()}
                          className={cn(
                            "-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase hover:text-foreground",
                            sorted && "text-foreground",
                            def?.align === "right" && "flex-row-reverse",
                          )}
                        >
                          {def?.header}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        def?.header
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <SkeletonRows columns={leafColumns.length + (selectable ? 1 : 0)} />
              ) : pageRows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <td colSpan={leafColumns.length + (selectable ? 1 : 0)}>
                    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                      <SearchX className="size-5" />
                      <p>
                        {filtersActive
                          ? "No rows match these filters."
                          : activeTab
                            ? `Nothing in ${activeTab.label.toLowerCase()} right now.`
                            : "No rows."}
                      </p>
                      {filtersActive ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            update({ q: null, ...Object.fromEntries(facetState.map(({ def }) => [def.id, null])) })
                          }
                        >
                          Clear filters
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </TableRow>
              ) : (
                pageRows.map((row) => {
                  const selected = selectable && row.getIsSelected();
                  return (
                    <TableRow
                      key={row.id}
                      data-state={selected ? "selected" : undefined}
                      onClick={(event) => onRowClick(event, row.original)}
                      className={cn(rowHref && "cursor-pointer", rowClassName?.(row.original))}
                    >
                      {selectable ? (
                        <td className="w-8">
                          <Checkbox
                            aria-label="Select row"
                            checked={selected}
                            onCheckedChange={(value) => row.toggleSelected(value === true)}
                          />
                        </td>
                      ) : null}
                      {row.getVisibleCells().map((cell) => {
                        const def = columnById.get(cell.column.id);
                        return (
                          <td key={cell.id} className={cn(def?.align === "right" && "text-right tabular-nums", def?.className)}>
                            {def?.cell(row.original)}
                          </td>
                        );
                      })}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </UiTable>
        </div>
      )}

      {!loading && pageCount > 1 ? (
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {firstShown}–{lastShown} of {visibleRows.length}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
              <ChevronLeft />
              Prev
            </Button>
            <span className="px-2 tabular-nums">
              {pagination.pageIndex + 1} / {pageCount}
            </span>
            <Button size="sm" variant="outline" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
              Next
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FacetMenu<T>({
  def,
  selected,
  options,
  onChange,
}: {
  def: FacetDef<T>;
  selected: string[];
  options: { value: string; count: number }[];
  onChange: (values: string[]) => void;
}) {
  if (options.length < 2 && selected.length === 0) return null;
  const label = (value: string) => (def.format ? def.format(value) : value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className={cn("border-dashed", selected.length && "border-solid border-primary/40")}>
          <ListFilter />
          {def.label}
          {selected.length ? (
            <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">
              {selected.length === 1 ? label(selected[0]!) : `${selected.length} selected`}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>{def.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={checked}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(value) =>
                onChange(value ? [...selected, option.value] : selected.filter((item) => item !== option.value))
              }
            >
              <span className="flex-1 capitalize">{label(option.value)}</span>
              <span className="ml-4 text-xs tabular-nums text-muted-foreground">{option.count}</span>
            </DropdownMenuCheckboxItem>
          );
        })}
        {selected.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={false} onCheckedChange={() => onChange([])}>
              Clear
            </DropdownMenuCheckboxItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnsMenu<T>({
  columns,
  isVisible,
  toggle,
}: {
  columns: DataColumn<T>[];
  isVisible: (columnId: string) => boolean;
  toggle: (columnId: string, visible: boolean) => void;
}) {
  const hideable = columns.filter((column, index) => (column.hideable ?? index > 0) && column.header);
  if (!hideable.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" aria-label="Choose columns">
          <Settings2 />
          <span className="hidden md:inline">Columns</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideable.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={isVisible(column.id)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(value) => toggle(column.id, value === true)}
          >
            {column.header}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
