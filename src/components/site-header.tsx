"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ScanLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import { useScanner } from "@/app/scanner/ScannerProvider";
import { useSession } from "@/app/session";
import { useOperatingMode } from "@/app/use-operating-mode";
import { homePath, useWarehouse } from "@/app/warehouse";
import { GARAGE_SWITCH_LABEL, MANUFACTURER_MODE_LABEL, garageAllowsPath, isGarageMode } from "@/domain/operating-mode";
import { api, type ScanHit, type SearchResults } from "@/app/api";
import { documentPath } from "@/domain/barcodes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function SiteHeader({ floor }: { floor?: boolean }) {
  const scanner = useScanner();
  const me = useSession();
  const warehouse = useWarehouse();
  const location = useLocation();
  const navigate = useNavigate();
  const onFloor = floor || location.pathname.startsWith("/floor");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      data-slot="site-header"
      className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height) print:hidden"
    >
      <div className="flex w-full items-center gap-1.5 px-3">
        {onFloor ? (
          <Link to="/floor" className="text-xs font-semibold">
            Floor
          </Link>
        ) : (
          <SidebarTrigger className="-ml-1 size-7" />
        )}
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
        <select
          className="h-7 max-w-40 rounded-md border bg-transparent px-1.5 text-xs"
          value={warehouse.warehouseId}
          onChange={(e) => warehouse.setWarehouseId(e.target.value)}
          aria-label="Warehouse"
        >
          {warehouse.warehouses.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <GarageModeSwitch />
        <div className="ml-auto flex items-center gap-1.5">
          <ToggleGroup
            type="single"
            value={onFloor ? "floor" : "office"}
            onValueChange={(value) => {
              if (value === "floor") navigate("/floor");
              if (value === "office") navigate(homePath(me.role) === "/floor" ? "/today" : homePath(me.role));
            }}
            variant="outline"
            size="sm"
            className="h-7"
          >
            <ToggleGroupItem value="office" className="h-7 px-2 text-[11px]">
              Office
            </ToggleGroupItem>
            <ToggleGroupItem value="floor" className="h-7 px-2 text-[11px]">
              Floor
            </ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" size="xs" className="hidden min-w-40 justify-start gap-2 font-normal text-muted-foreground sm:inline-flex" onClick={() => setSearchOpen(true)}>
            <Search className="size-3.5" />
            <span>Search</span>
            <kbd className="ml-auto rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
              {typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}
            </kbd>
          </Button>
          <Button variant="outline" size="icon-xs" className="sm:hidden" onClick={() => setSearchOpen(true)} aria-label="Search">
            <Search className="size-3.5" />
          </Button>
          {scanner.cameraSupported ? (
            <Button variant="outline" size="xs" onClick={() => scanner.openCamera()}>
              <ScanLine className="size-3.5" />
              Scan
            </Button>
          ) : (
            <span className="hidden text-[11px] text-muted-foreground lg:inline">Gun scanners work from any screen</span>
          )}
          <ModeToggle />
        </div>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} garage={isGarageMode(me.organization.operatingMode)} />
      <ScanNavigate enabled={!onFloor} />
    </header>
  );
}

const MODE_HINT = "Same parts, orders, and builds. Manufacturer opens the rest of the floor.";

function GarageModeSwitch() {
  const { garage, owner, busy, setMode } = useOperatingMode();

  async function onChecked(checked: boolean) {
    if (!owner || busy) return;
    try {
      await setMode(checked ? "garage" : "warehouse");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch Garage Mode");
    }
  }

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5"
      title={owner ? MODE_HINT : "The owner switches Garage and Manufacturer for the whole shop."}
    >
      <span className={cn("text-[11px] font-medium", garage ? "text-primary" : "text-muted-foreground")}>
        {GARAGE_SWITCH_LABEL}
      </span>
      <Switch
        checked={garage}
        disabled={!owner || busy}
        onCheckedChange={(checked) => void onChecked(checked)}
        aria-label="Garage Mode"
      />
      <span className={cn("hidden text-[11px] font-medium sm:inline", garage ? "text-muted-foreground" : "text-foreground")}>
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

function GlobalSearch({
  open,
  onOpenChange,
  garage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  garage: boolean;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      if (!q.trim()) {
        setResults(null);
        return;
      }
      api<SearchResults>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then(setResults)
        .catch(() => setResults(null));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [q, open]);

  function go(path: string) {
    onOpenChange(false);
    setQ("");
    navigate(path);
  }

  function show(path: string) {
    return !garage || garageAllowsPath(path);
  }

  const items = (results?.items ?? []).filter((row) => show(`/stock/items/${row.id}`));
  const locations = (results?.locations ?? []).filter((row) => show(`/stock/locations/${row.id}`));
  const orders = (results?.orders ?? []).filter((row) => show(`/outbound/orders/${row.id}`));
  const receipts = (results?.receipts ?? []).filter((row) => show(`/inbound/receipts/${row.id}`));
  const transfers = (results?.transfers ?? []).filter((row) => show(`/inbound/putaway/${row.id}`));
  const workOrders = (results?.workOrders ?? []).filter((row) => show(`/make/work-orders/${row.id}`));
  const counts = (results?.counts ?? []).filter((row) => show(`/stock/counts/${row.id}`));
  const purchases = (results?.purchases ?? []).filter((row) => show(`/inbound/purchases/${row.id}`));
  const returns = (results?.returns ?? []).filter((row) => show(`/outbound/returns/${row.id}`));
  const vendorReturns = (results?.vendorReturns ?? []).filter((row) => show(`/inbound/vendor-returns/${row.id}`));
  const replenishments = (results?.replenishments ?? []).filter((row) => show(`/stock/replenish/${row.id}`));
  const kits = (results?.kits ?? []).filter((row) => show(`/make/kits/${row.id}`));
  const holds = (results?.holds ?? []).filter((row) => show(`/stock/holds/${row.id}`));
  const waves = (results?.waves ?? []).filter((row) => show(`/outbound/waves/${row.id}`));
  const asns = (results?.asns ?? []).filter((row) => show(`/inbound/asns/${row.id}`));
  const yard = (results?.yard ?? []).filter((row) => show(`/inbound/yard/${row.id}`));
  const equipment = (results?.equipment ?? []).filter((row) => show(`/equipment/${row.id}`));
  const serials = (results?.serials ?? []).filter((row) => show(`/stock/items/${row.itemId}`));
  const empty =
    !!results &&
    !items.length &&
    !locations.length &&
    !orders.length &&
    !receipts.length &&
    !transfers.length &&
    !workOrders.length &&
    !counts.length &&
    !purchases.length &&
    !returns.length &&
    !vendorReturns.length &&
    !replenishments.length &&
    !kits.length &&
    !holds.length &&
    !waves.length &&
    !asns.length &&
    !yard.length &&
    !equipment.length &&
    !serials.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>Search the warehouse</DialogTitle>
          <DialogDescription>Find a SKU, bay, receipt, order, or work order.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          className="h-10 rounded-none border-0 border-b shadow-none focus-visible:ring-0"
          placeholder="SKU, bay, ORD-…, Shopify #1004"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="max-h-80 space-y-0.5 overflow-auto p-1.5 text-xs">
          {items.map((item) => (
            <button key={item.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/stock/items/${item.id}`)}>
              <span className="font-mono">{item.sku}</span> {item.name}
            </button>
          ))}
          {locations.map((location) => (
            <button
              key={location.id}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
              onClick={() => go(`/stock/locations/${location.id}`)}
            >
              <span className="font-mono">{location.code}</span> {location.name}
            </button>
          ))}
          {orders.map((order) => (
            <button
              key={order.id}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
              onClick={() => go(`/outbound/orders/${order.id}`)}
            >
              Order {order.number} · {order.customerName}
            </button>
          ))}
          {receipts.map((receipt) => (
            <button
              key={receipt.id}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
              onClick={() => go(`/inbound/receipts/${receipt.id}`)}
            >
              Receipt {receipt.number}
            </button>
          ))}
          {transfers.map((transfer) => (
            <button
              key={transfer.id}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
              onClick={() => go(`/inbound/putaway/${transfer.id}`)}
            >
              Putaway {transfer.number}
            </button>
          ))}
          {workOrders.map((order) => (
            <button
              key={order.id}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
              onClick={() => go(`/make/work-orders/${order.id}`)}
            >
              Work order {order.number}
            </button>
          ))}
          {counts.map((count) => (
            <button
              key={count.id}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
              onClick={() => go(`/stock/counts/${count.id}`)}
            >
              Count {count.number}
            </button>
          ))}
          {purchases.map((purchase) => (
            <button
              key={purchase.id}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
              onClick={() => go(`/inbound/purchases/${purchase.id}`)}
            >
              Purchase {purchase.number} · {purchase.vendorName}
            </button>
          ))}
          {returns.map((rma) => (
            <button key={rma.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/outbound/returns/${rma.id}`)}>
              Return {rma.number} · {rma.customerName}
            </button>
          ))}
          {vendorReturns.map((row) => (
            <button key={row.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/inbound/vendor-returns/${row.id}`)}>
              Vendor return {row.number} · {row.vendorName}
            </button>
          ))}
          {replenishments.map((row) => (
            <button key={row.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/stock/replenish/${row.id}`)}>
              Replenish {row.number}
            </button>
          ))}
          {kits.map((row) => (
            <button key={row.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/make/kits/${row.id}`)}>
              Kit {row.number}
            </button>
          ))}
          {holds.map((row) => (
            <button key={row.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/stock/holds/${row.id}`)}>
              Hold {row.number}
            </button>
          ))}
          {waves.map((row) => (
            <button key={row.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/outbound/waves/${row.id}`)}>
              Wave {row.number}
            </button>
          ))}
          {asns.map((row) => (
            <button key={row.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/inbound/asns/${row.id}`)}>
              ASN {row.number} · {row.vendorName}
            </button>
          ))}
          {yard.map((row) => (
            <button key={row.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/inbound/yard/${row.id}`)}>
              Yard {row.number} · {row.carrierName}
            </button>
          ))}
          {equipment.map((row) => (
            <button key={row.id} className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted" onClick={() => go(`/equipment/${row.id}`)}>
              {row.code} · {row.name}
            </button>
          ))}
          {serials.map((row) => (
            <button
              key={`${row.itemId}:${row.serialCode}`}
              className="block w-full rounded-sm px-2 py-1 text-left hover:bg-muted"
              onClick={() => go(`/stock/items/${row.itemId}`)}
            >
              Serial {row.serialCode} · {row.sku}
            </button>
          ))}
          {empty ? <p className="text-muted-foreground">Nothing matches that search.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
