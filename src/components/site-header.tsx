"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ChevronsUpDown,
  Compass,
  Factory,
  Keyboard,
  LayoutDashboard,
  Monitor,
  Moon,
  Rows2,
  Rows4,
  ScanLine,
  Search,
  SlidersHorizontal,
  Sun,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutsDialog, useGlobalShortcuts } from "@/components/keyboard-shortcuts";
import { useScanner } from "@/app/scanner/ScannerProvider";
import { useSession } from "@/app/session";
import { useOperatingMode } from "@/app/use-operating-mode";
import { useDensity } from "@/app/density";
import { openTour } from "@/app/tour";
import { homePath, useWarehouse } from "@/app/warehouse";
import {
  GARAGE_MODE_LABEL,
  GARAGE_SWITCH_LABEL,
  MANUFACTURER_MODE_LABEL,
  isGarageMode,
} from "@/domain/operating-mode";
import { api, type ScanHit } from "@/app/api";
import { documentPath } from "@/domain/barcodes";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export function SiteHeader({ floor }: { floor?: boolean }) {
  const scanner = useScanner();
  const me = useSession();
  const location = useLocation();
  const onFloor = floor || location.pathname.startsWith("/floor");
  const garage = isGarageMode(me.organization.operatingMode);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useGlobalShortcuts({
    enabled: !onFloor && !searchOpen,
    garage,
    owner: me.role === "owner",
    onSearch: () => setSearchOpen(true),
    onHelp: () => setShortcutsOpen(true),
  });

  return (
    <header
      data-slot="site-header"
      className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 print:hidden"
    >
      <div className="flex w-full min-w-0 items-center gap-1.5 px-3">
        {onFloor ? (
          <Link to="/floor" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ScanLine className="size-4" />
            </span>
            <span className="hidden sm:inline">Floor</span>
          </Link>
        ) : (
          <SidebarTrigger className="-ml-1 size-8" />
        )}
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
        <WarehouseSwitcher />
        <div className="hidden md:block">
          <GarageModeSwitch />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden sm:block">
            <WorkspaceToggle onFloor={onFloor} />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="hidden min-w-44 justify-start gap-2 font-normal text-muted-foreground md:inline-flex"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="size-4" />
            <span>Search or jump to…</span>
            <kbd className="ml-auto rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
              {mac ? "⌘K" : "Ctrl K"}
            </kbd>
          </Button>
          <Button variant="outline" size="icon" className="size-8 md:hidden" onClick={() => setSearchOpen(true)} aria-label="Search">
            <Search className="size-4" />
          </Button>
          {scanner.cameraSupported ? (
            <Button variant="outline" size="sm" className="h-8" onClick={() => scanner.openCamera()} aria-label="Scan with camera">
              <ScanLine className="size-4" />
              <span className="hidden lg:inline">Scan</span>
            </Button>
          ) : null}
          <DisplayMenu onFloor={onFloor} onShowShortcuts={() => setShortcutsOpen(true)} />
        </div>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} onShowShortcuts={() => setShortcutsOpen(true)} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} garage={garage} owner={me.role === "owner"} />
      <ScanNavigate enabled={!onFloor} />
    </header>
  );
}

function WorkspaceToggle({ onFloor }: { onFloor: boolean }) {
  const me = useSession();
  const navigate = useNavigate();
  return (
    <ToggleGroup
      type="single"
      value={onFloor ? "floor" : "office"}
      onValueChange={(value) => {
        if (value === "floor") navigate("/floor");
        if (value === "office") navigate(homePath(me.role) === "/floor" ? "/today" : homePath(me.role));
      }}
      variant="outline"
      size="sm"
      className="h-8"
      aria-label="Workspace"
    >
      <ToggleGroupItem value="office" className="h-8 gap-1.5 px-2.5 text-xs">
        <LayoutDashboard className="size-3.5" />
        Office
      </ToggleGroupItem>
      <ToggleGroupItem value="floor" className="h-8 gap-1.5 px-2.5 text-xs">
        <ScanLine className="size-3.5" />
        Floor
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function WarehouseSwitcher() {
  const warehouse = useWarehouse();
  if (warehouse.warehouses.length <= 1) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 truncate px-1 text-sm font-medium">
        <Warehouse className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{warehouse.warehouse?.name ?? "Warehouse"}</span>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 min-w-0 max-w-48 gap-1.5 px-2 font-medium" aria-label="Switch warehouse">
          <Warehouse className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{warehouse.warehouse?.name ?? "Warehouse"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuLabel>Warehouse</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={warehouse.warehouseId} onValueChange={(id) => warehouse.setWarehouseId(id)}>
          {warehouse.warehouses.map((row) => (
            <DropdownMenuRadioItem key={row.id} value={row.id}>
              {row.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Theme, density, and on small screens the controls that do not fit in the bar. */
function DisplayMenu({ onFloor, onShowShortcuts }: { onFloor: boolean; onShowShortcuts: () => void }) {
  const { theme, setTheme } = useTheme();
  const [density, setDensity] = useDensity();
  const me = useSession();
  const navigate = useNavigate();
  const { garage, owner, busy, setMode } = useOperatingMode();

  async function switchMode() {
    try {
      await setMode(garage ? "warehouse" : "garage");
      toast.success(garage ? `Switched to ${MANUFACTURER_MODE_LABEL}.` : `Switched to ${GARAGE_MODE_LABEL}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch Garage Mode");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="size-8" aria-label="Display and more">
          <SlidersHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="sm:hidden">
          <DropdownMenuLabel>Workspace</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => navigate(onFloor ? (homePath(me.role) === "/floor" ? "/today" : homePath(me.role)) : "/floor")}>
            {onFloor ? <LayoutDashboard /> : <ScanLine />}
            {onFloor ? "Go to the office" : "Go to the floor"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </div>
        {owner ? (
          <div className="md:hidden">
            <DropdownMenuItem disabled={busy} onSelect={() => void switchMode()}>
              <Factory />
              {garage ? `Switch to ${MANUFACTURER_MODE_LABEL}` : `Switch to ${GARAGE_MODE_LABEL}`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </div>
        ) : null}
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Rows</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={density} onValueChange={(value) => setDensity(value as "comfortable" | "compact")}>
          <DropdownMenuRadioItem value="comfortable">
            <Rows2 className="size-4" />
            Comfortable
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">
            <Rows4 className="size-4" />
            Compact
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Help</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => openTour()}>
          <Compass />
          How Rackline works
        </DropdownMenuItem>
        {onFloor ? null : (
          <DropdownMenuItem onSelect={onShowShortcuts}>
            <Keyboard />
            Keyboard shortcuts
            <DropdownMenuShortcut>?</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MODE_HINT = "Same parts, orders, and builds. Manufacturer opens the rest of the floor.";

function GarageModeSwitch() {
  const { garage, owner, busy, setMode } = useOperatingMode();

  async function onChecked(checked: boolean) {
    if (!owner || busy) return;
    try {
      await setMode(checked ? "garage" : "warehouse");
      toast.success(checked ? `Switched to ${GARAGE_MODE_LABEL}.` : `Switched to ${MANUFACTURER_MODE_LABEL}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch Garage Mode");
    }
  }

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1"
      title={owner ? MODE_HINT : "The owner switches Garage and Manufacturer for the whole shop."}
    >
      <span className={cn("text-xs font-medium", garage ? "text-primary" : "text-muted-foreground")}>
        {GARAGE_SWITCH_LABEL}
      </span>
      <Switch
        checked={garage}
        disabled={!owner || busy}
        onCheckedChange={(checked) => void onChecked(checked)}
        aria-label="Garage Mode"
      />
      <span className={cn("text-xs font-medium", garage ? "text-muted-foreground" : "text-foreground")}>
        {MANUFACTURER_MODE_LABEL}
      </span>
    </div>
  );
}

function ScanNavigate({ enabled }: { enabled: boolean }) {
  const scanner = useScanner();
  const navigate = useNavigate();
  const handledAt = useMemo(() => ({ current: 0 }), []);

  useEffect(() => {
    if (!enabled) return;
    const scan = scanner.lastScan;
    if (!scan || scan.at === handledAt.current) return;
    handledAt.current = scan.at;
    api<ScanHit>(`/api/scan?code=${encodeURIComponent(scan.raw)}`)
      .then((hit) => {
        const path = pathForScan(hit);
        if (path) navigate(path);
      })
      .catch(() => {
        /* Search can still open the record. */
      });
  }, [enabled, scanner.lastScan, handledAt, navigate]);

  return null;
}

function pathForScan(hit: ScanHit): string | null {
  switch (hit.kind) {
    case "location":
      return `/stock/locations/${hit.location.id}`;
    case "item":
      return `/stock/items/${hit.item.id}`;
    case "order":
      return documentPath("order", hit.order.id);
    case "receipt":
      return documentPath("receipt", hit.receipt.id);
    case "transfer":
      return documentPath("transfer", hit.transfer.id);
    case "workOrder":
      return documentPath("workOrder", hit.workOrder.id);
    case "cycleCount":
      return documentPath("cycleCount", hit.cycleCount.id);
    case "purchase":
      return documentPath("purchase", hit.purchase.id);
    case "rma":
      return documentPath("rma", hit.rma.id);
    case "vendorReturn":
      return documentPath("vendorReturn", hit.vendorReturn.id);
    case "replenishment":
      return documentPath("replenishment", hit.replenishment.id);
    case "kit":
      return documentPath("kit", hit.kit.id);
    case "hold":
      return documentPath("hold", hit.hold.id);
    case "wave":
      return documentPath("wave", hit.wave.id);
    case "asn":
      return documentPath("asn", hit.asn.id);
    case "yard":
      return documentPath("yard", hit.yard.id);
    case "equipment":
      return documentPath("equipment", hit.equipment.id);
    case "serial":
      return `/stock/items/${hit.item.id}`;
    case "lot":
      return hit.onHand[0] ? `/stock/items/${hit.onHand[0].itemId}` : hit.usedIn[0] ? `/stock/items/${hit.usedIn[0].parentItemId}` : null;
  }
}
