"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Boxes,
  ClipboardList,
  Clock,
  Container,
  FileInput,
  Forklift,
  Hammer,
  Inbox,
  Keyboard,
  Loader2,
  Lock,
  MapPin,
  Moon,
  Package,
  Plus,
  Puzzle,
  Rows3,
  ScanBarcode,
  ShoppingCart,
  Sun,
  Undo2,
  Warehouse,
  Waves,
  ArrowRightLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calculator,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { api, type Purchase, type SearchResults } from "@/app/api";
import { useSession } from "@/app/session";
import { useWarehouse } from "@/app/warehouse";
import { useDensity } from "@/app/density";
import { destinationsForSession } from "@/app/navigation";
import { refreshApi } from "@/app/query";
import { StatusBadge } from "@/app/components/ui";
import { garageAllowsPath, isGarageMode } from "@/domain/operating-mode";
import { matchesSearch } from "@/app/components/data-table/table-state";
import { useTheme } from "@/hooks/use-theme";

type Entry = {
  id: string;
  label: ReactNode;
  sub?: string;
  icon: LucideIcon;
  status?: string;
  hint?: string;
  run: () => void;
};

type ActionEntry = Entry & { keywords: string; path: string };

type Recent = { path: string; label: string; sub?: string; kind: string };

const RECENT_KEY = "rackline-recent";

function readRecents(): Recent[] {
  try {
    return (JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]") as Recent[]).slice(0, 6);
  } catch {
    return [];
  }
}

function rememberRecent(entry: Recent) {
  try {
    const next = [entry, ...readRecents().filter((row) => row.path !== entry.path)].slice(0, 6);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* Recents are a convenience. */
  }
}

const KIND_ICON: Record<string, LucideIcon> = {
  item: Package,
  location: MapPin,
  order: ClipboardList,
  receipt: Inbox,
  putaway: ArrowRightLeft,
  "work order": Hammer,
  count: Calculator,
  purchase: ShoppingCart,
  return: Undo2,
  "vendor return": ArrowUpFromLine,
  replenish: ArrowDownToLine,
  kit: Puzzle,
  hold: Lock,
  wave: Waves,
  asn: FileInput,
  yard: Container,
  equipment: Forklift,
  serial: ScanBarcode,
};

function resultEntries(results: SearchResults | undefined): (Recent & { status?: string })[] {
  if (!results) return [];
  const rows: (Recent & { status?: string })[] = [];
  const push = (kind: string, path: string, label: string, sub?: string | null, status?: string) =>
    rows.push({ kind, path, label, sub: sub ?? undefined, status });
  for (const row of results.orders) push("order", `/outbound/orders/${row.id}`, row.number, row.customerName, row.status);
  for (const row of results.items) push("item", `/stock/items/${row.id}`, row.sku, row.name);
  for (const row of results.locations) push("location", `/stock/locations/${row.id}`, row.code, row.name);
  for (const row of results.receipts) push("receipt", `/inbound/receipts/${row.id}`, row.number, row.notes, row.status);
  for (const row of results.purchases) push("purchase", `/inbound/purchases/${row.id}`, row.number, row.vendorName, row.status);
  for (const row of results.asns ?? []) push("asn", `/inbound/asns/${row.id}`, row.number, row.vendorName, row.status);
  for (const row of results.yard ?? []) push("yard", `/inbound/yard/${row.id}`, row.number, row.carrierName, row.status);
  for (const row of results.transfers) push("putaway", `/inbound/putaway/${row.id}`, row.number, null, row.status);
  for (const row of results.vendorReturns ?? [])
    push("vendor return", `/inbound/vendor-returns/${row.id}`, row.number, row.vendorName, row.status);
  for (const row of results.workOrders) push("work order", `/make/work-orders/${row.id}`, row.number, null, row.status);
  for (const row of results.kits ?? []) push("kit", `/make/kits/${row.id}`, row.number, null, row.status);
  for (const row of results.waves ?? []) push("wave", `/outbound/waves/${row.id}`, row.number, null, row.status);
  for (const row of results.returns) push("return", `/outbound/returns/${row.id}`, row.number, row.customerName, row.status);
  for (const row of results.counts) push("count", `/stock/counts/${row.id}`, row.number, null, row.status);
  for (const row of results.holds ?? []) push("hold", `/stock/holds/${row.id}`, row.number, null, row.status);
  for (const row of results.replenishments ?? []) push("replenish", `/stock/replenish/${row.id}`, row.number, null, row.status);
  for (const row of results.equipment ?? []) push("equipment", `/equipment/${row.id}`, row.code, row.name, row.status);
  for (const row of results.serials ?? []) push("serial", `/stock/items/${row.itemId}`, row.serialCode, row.sku, row.status);
  return rows;
}

/**
 * ⌘K: search every record, jump to any page, or run a common action.
 * Results come from `/api/search`; pages and actions filter locally.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onShowShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowShortcuts: () => void;
}) {
  const navigate = useNavigate();
  const me = useSession();
  const garage = isGarageMode(me.organization.operatingMode);
  const warehouse = useWarehouse();
  const { theme, setTheme } = useTheme();
  const [density, setDensity] = useDensity();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recents, setRecents] = useState<Recent[]>([]);

  useEffect(() => {
    if (open) {
      setRecents(readRecents());
    } else {
      setQ("");
      setDebounced("");
    }
  }, [open]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(q.trim()), 150);
    return () => window.clearTimeout(handle);
  }, [q]);

  const search = useQuery({
    queryKey: ["api", `/api/search?q=${encodeURIComponent(debounced)}`],
    queryFn: () => api<SearchResults>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

  function close() {
    onOpenChange(false);
  }

  function go(path: string) {
    close();
    navigate(path);
  }

  const allow = (path: string) => !garage || garageAllowsPath(path);
  const dark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const actions: ActionEntry[] = [
    {
      id: "action:new-order",
      label: "New order",
      icon: Plus,
      keywords: "create floor order",
      run: () => go("/outbound/orders?new=1"),
      path: "/outbound/orders",
    },
    {
      id: "action:draft-po",
      label: "Draft PO from the reorder queue",
      icon: ShoppingCart,
      keywords: "purchase reorder low stock buy",
      path: "/inbound/purchases",
      run: () => {
        close();
        api<Purchase>("/api/purchases/from-reorder", {
          method: "POST",
          body: JSON.stringify({ warehouseId: warehouse.warehouseId }),
        })
          .then((created) => {
            toast.success(`Drafted ${created.number}.`);
            void refreshApi();
            navigate(`/inbound/purchases/${created.id}`);
          })
          .catch((err: Error) => toast.error(err.message));
      },
    },
    ...warehouse.warehouses
      .filter((row) => row.id !== warehouse.warehouseId)
      .map((row) => ({
        id: `action:warehouse:${row.id}`,
        label: `Switch to ${row.name}`,
        icon: Warehouse,
        keywords: "warehouse building change",
        path: "/today",
        run: () => {
          warehouse.setWarehouseId(row.id);
          toast.success(`Now showing ${row.name}.`);
          close();
        },
      })),
    {
      id: "action:theme",
      label: dark ? "Switch to light theme" : "Switch to dark theme",
      icon: dark ? Sun : Moon,
      keywords: "theme dark light mode appearance",
      path: "/today",
      run: () => {
        setTheme(dark ? "light" : "dark");
        close();
      },
    },
    {
      id: "action:density",
      label: density === "compact" ? "Use comfortable rows" : "Use compact rows",
      icon: Rows3,
      keywords: "density compact comfortable dense spacing",
      path: "/today",
      run: () => {
        setDensity(density === "compact" ? "comfortable" : "compact");
        close();
      },
    },
    {
      id: "action:shortcuts",
      label: "Keyboard shortcuts",
      icon: Keyboard,
      keywords: "help keys hotkeys",
      hint: "?",
      path: "/today",
      run: () => {
        close();
        onShowShortcuts();
      },
    },
  ].filter((entry) => allow(entry.path));

  const destinations = destinationsForSession(me.role, garage);
  const query = q.trim();
  const results = resultEntries(search.data).filter((row) => allow(row.path));
  const pageMatches = destinations.filter((item) => matchesSearch(`${item.title} ${item.keywords ?? ""}`, query));
  const actionMatches = actions.filter((entry) => matchesSearch(`${String(entry.label)} ${entry.keywords}`, query));
  const searching = query.length > 0 && (search.isFetching || debounced !== query);

  function openRecord(row: Recent) {
    rememberRecent({ path: row.path, label: row.label, sub: row.sub, kind: row.kind });
    go(row.path);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search Rackline</DialogTitle>
          <DialogDescription>Find a SKU, bay, or document, jump to a page, or run an action.</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          loop
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-item]]:py-2 [&_[data-slot=command-input-wrapper]]:h-12"
        >
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder="Search SKUs, bays, ORD-…, Shopify #1004, or type a page"
            className="text-base"
          />
          <CommandList className="max-h-[min(60vh,28rem)]">
            {!searching ? <CommandEmpty>Nothing matches “{query}”.</CommandEmpty> : null}

            {query && (results.length || searching) ? (
              <CommandGroup heading="Records">
                {searching && !results.length ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Searching…
                  </div>
                ) : null}
                {results.slice(0, 12).map((row) => {
                  const Icon = KIND_ICON[row.kind] ?? Boxes;
                  return (
                    <CommandItem key={`${row.kind}:${row.path}:${row.label}`} value={`${row.kind}:${row.path}:${row.label}`} onSelect={() => openRecord(row)}>
                      <Icon className="text-muted-foreground" />
                      <span className="font-mono font-medium">{row.label}</span>
                      {row.sub ? <span className="truncate text-muted-foreground">{row.sub}</span> : null}
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        {row.status ? <StatusBadge status={row.status} /> : null}
                        <span className="text-[11px] capitalize text-muted-foreground">{row.kind}</span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}

            {!query && recents.length ? (
              <CommandGroup heading="Recent">
                {recents.filter((row) => allow(row.path)).map((row) => {
                  const Icon = KIND_ICON[row.kind] ?? Clock;
                  return (
                    <CommandItem key={`recent:${row.path}`} value={`recent:${row.path}`} onSelect={() => openRecord(row)}>
                      <Icon className="text-muted-foreground" />
                      <span className="font-mono font-medium">{row.label}</span>
                      {row.sub ? <span className="truncate text-muted-foreground">{row.sub}</span> : null}
                      <span className="ml-auto text-[11px] capitalize text-muted-foreground">{row.kind}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}

            {actionMatches.length ? (
              <CommandGroup heading="Actions">
                {actionMatches.map((entry) => (
                  <CommandItem key={entry.id} value={entry.id} onSelect={entry.run}>
                    <entry.icon className="text-muted-foreground" />
                    {entry.label}
                    {entry.hint ? <CommandShortcut>{entry.hint}</CommandShortcut> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {pageMatches.length ? (
              <CommandGroup heading="Go to">
                {pageMatches.slice(0, query ? 8 : 40).map((item) => (
                  <CommandItem key={`page:${item.url}`} value={`page:${item.url}`} onSelect={() => go(item.url)}>
                    <item.icon className="text-muted-foreground" />
                    {item.title}
                    <ArrowRight className="ml-auto size-3.5 opacity-40" />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              <kbd className="rounded border bg-muted px-1 font-mono">↑↓</kbd> move
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> open
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1 font-mono">esc</kbd> close
            </span>
            <span className="ml-auto hidden sm:inline">A gun scan anywhere opens that record too.</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
