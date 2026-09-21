import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronsUpDown, Radar } from "lucide-react";
import { api, type Item, type TrafficDestination, type TrafficGrain, type TrafficHorizon, type TrafficSnapshot } from "../api";
import { ErrorBanner } from "../components/ui";
import { useWarehouse } from "../warehouse";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  destinationLabel,
  flightStatusLabel,
  frameForSnapshot,
  TrafficMap,
} from "../components/traffic-map/TrafficMap";
import { cn } from "@/lib/utils";

const POLL_MS = 4000;

export function TrafficPage() {
  const { warehouseId } = useWarehouse();
  const [items, setItems] = useState<Item[]>([]);
  const [skuIds, setSkuIds] = useState<string[]>([]);
  const [horizon, setHorizon] = useState<TrafficHorizon>("now");
  const [grain, setGrain] = useState<TrafficGrain>("region");
  const [frame, setFrame] = useState<"us" | "world">("world");
  const [frameTouched, setFrameTouched] = useState(false);
  const [data, setData] = useState<TrafficSnapshot | null>(null);
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Item[]>("/api/items")
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const params = new URLSearchParams();
      if (warehouseId) params.set("warehouseId", warehouseId);
      params.set("horizon", horizon);
      params.set("grain", grain);
      for (const id of skuIds) params.append("skuIds", id);
      try {
        const next = await api<TrafficSnapshot>(`/api/analytics/traffic?${params.toString()}`);
        if (cancelled) return;
        setData(next);
        setError(null);
        if (!frameTouched) setFrame(frameForSnapshot(next));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load traffic");
      }
    }
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [warehouseId, horizon, grain, skuIds, frameTouched]);

  function handleSelectDestination(row: TrafficDestination) {
    if (grain === "country") {
      setGrain("region");
      if (row.country === "US") {
        setFrameTouched(true);
        setFrame("us");
      }
      return;
    }
    if (grain === "region") {
      setGrain("city");
      if (row.country === "US") {
        setFrameTouched(true);
        setFrame("us");
      }
    }
  }

  const selected = data?.flights.find((row) => row.orderId === selectedFlightId) ?? null;
  const skuLabel = useMemo(() => {
    if (skuIds.length === 0) return "All SKUs";
    const names = items.filter((item) => skuIds.includes(item.id)).map((item) => item.sku);
    if (names.length <= 2) return names.join(", ");
    return `${names.length} SKUs`;
  }, [items, skuIds]);

  return (
    <div className="-mx-3 -my-2 flex h-[calc(100dvh-var(--header-height))] min-h-[40rem] flex-col bg-[#061018] text-cyan-50">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-cyan-400/15 px-4 py-3 md:px-5">
        <div>
          <p className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-cyan-300/80">
            <Radar className="size-3.5" />
            Analytics
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-cyan-50">Traffic</h1>
          <p className="mt-0.5 max-w-xl text-xs text-cyan-200/70">
            Live lane estimates from each warehouse origin. Filter SKUs to see where they are flying and landing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SkuFilter items={items} skuIds={skuIds} onChange={setSkuIds} label={skuLabel} />
          <ToggleGroup
            type="single"
            value={horizon}
            onValueChange={(value) => {
              if (value) setHorizon(value as TrafficHorizon);
            }}
            variant="outline"
            size="sm"
            className="border-cyan-400/30 bg-cyan-950/40"
          >
            <ToggleGroupItem value="now" className="text-cyan-100">
              Now
            </ToggleGroupItem>
            <ToggleGroupItem value="7d" className="text-cyan-100">
              7d
            </ToggleGroupItem>
            <ToggleGroupItem value="30d" className="text-cyan-100">
              30d
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={grain}
            onValueChange={(value) => {
              if (value) setGrain(value as TrafficGrain);
            }}
            variant="outline"
            size="sm"
            className="border-cyan-400/30 bg-cyan-950/40"
          >
            <ToggleGroupItem value="country" className="text-cyan-100">
              Country
            </ToggleGroupItem>
            <ToggleGroupItem value="region" className="text-cyan-100">
              State
            </ToggleGroupItem>
            <ToggleGroupItem value="city" className="text-cyan-100">
              City
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={frame}
            onValueChange={(value) => {
              if (!value) return;
              setFrameTouched(true);
              setFrame(value as "us" | "world");
            }}
            variant="outline"
            size="sm"
            className="border-cyan-400/30 bg-cyan-950/40"
          >
            <ToggleGroupItem value="world" className="text-cyan-100">
              World
            </ToggleGroupItem>
            <ToggleGroupItem value="us" className="text-cyan-100">
              US
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      {error ? (
        <div className="px-4 pt-3">
          <ErrorBanner error={error} />
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="relative min-h-[28rem] min-w-0">
          {data ? (
            <TrafficMap
              snapshot={data}
              grain={grain}
              frame={frame}
              selectedFlightId={selectedFlightId}
              onSelectFlight={setSelectedFlightId}
              onSelectDestination={handleSelectDestination}
            />
          ) : (
            <div className="grid h-full min-h-[28rem] place-items-center font-mono text-sm text-cyan-200/60">
              Acquiring radar…
            </div>
          )}
          {data ? (
            <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2">
              <Kpi label="In the air" value={data.kpis.inFlight} />
              <Kpi label="At the gate" value={data.kpis.atGate} />
              <Kpi label="Arrived" value={data.kpis.arrived} />
              <Kpi label="Destinations" value={data.kpis.destCount} />
              <Kpi label="Units" value={data.kpis.units} />
              {data.kpis.exceptions ? <Kpi label="Exceptions" value={data.kpis.exceptions} warn /> : null}
              {data.kpis.unmapped ? <Kpi label="Unmapped" value={data.kpis.unmapped} warn /> : null}
            </div>
          ) : null}
        </div>
        <aside className="flex min-h-0 flex-col border-t border-cyan-400/15 bg-[#07131d] lg:border-l lg:border-t-0">
          <div className="border-b border-cyan-400/15 px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-300/80">Destinations</p>
            <p className="text-xs text-cyan-200/60">Ranked by units of the filtered SKUs</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {(data?.destinations ?? []).length === 0 ? (
              <p className="px-4 py-6 text-sm text-cyan-200/60">No mapped shipments in this horizon.</p>
            ) : (
              <ul>
                {(data?.destinations ?? []).map((row) => (
                  <li key={row.key} className="border-b border-cyan-400/10">
                    <button
                      type="button"
                      className="w-full px-4 py-2.5 text-left hover:bg-cyan-400/5"
                      onClick={() => handleSelectDestination(row)}
                    >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm text-cyan-50">{destinationLabel(row)}</p>
                      <p className="font-mono text-sm tabular-nums text-cyan-200">{row.units}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-cyan-200/55">
                      {row.orders} {row.orders === 1 ? "order" : "orders"}
                      {row.skus[0] ? ` · ${row.skus[0].sku} × ${row.skus[0].qty}` : ""}
                    </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(data?.exceptions.length ?? 0) > 0 ? (
              <div className="px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-300/80">Exceptions</p>
                {data?.exceptions.map((row) => (
                  <p key={row.orderId} className="mt-1 text-xs text-amber-100/80">
                    <Link className="underline decoration-amber-100/40" to={`/outbound/orders/${row.orderId}`}>
                      {row.number}
                    </Link>{" "}
                    {row.reason === "tracker_exception"
                      ? "tracker failed or returned"
                      : row.reason === "unmapped_dest"
                        ? "needs a city/state"
                        : "warehouse has no origin city"}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
      {selected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-cyan-400/15 bg-[#071820] px-4 py-3">
          <div>
            <p className="font-mono text-sm text-emerald-200">{selected.trackingNumber || selected.number}</p>
            <p className="text-xs text-cyan-200/70">
              {flightStatusLabel(selected.status)} · {selected.dest.city || selected.dest.region || selected.dest.country} ·{" "}
              {selected.skus.map((line) => `${line.sku} × ${line.qty}`).join(", ")}
            </p>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link to={`/outbound/orders/${selected.orderId}`}>Open order</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={cn("rounded-md border px-2.5 py-1.5 backdrop-blur-sm", warn ? "border-amber-400/40 bg-amber-950/50" : "border-cyan-400/20 bg-[#061018]/80")}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-cyan-300/70">{label}</p>
      <p className="font-mono text-lg tabular-nums leading-none text-cyan-50">{value}</p>
    </div>
  );
}

function SkuFilter({
  items,
  skuIds,
  onChange,
  label,
}: {
  items: Item[];
  skuIds: string[];
  onChange: (ids: string[]) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(skuIds);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-cyan-400/30 bg-cyan-950/40 text-cyan-100">
          {label}
          <ChevronsUpDown className="ml-1 size-3.5 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="Filter SKU…" />
          <CommandList>
            <CommandEmpty>No SKU.</CommandEmpty>
            <CommandGroup>
              {items.map((item) => {
                const on = selected.has(item.id);
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.sku} ${item.name}`}
                    onSelect={() => {
                      if (on) onChange(skuIds.filter((id) => id !== item.id));
                      else onChange([...skuIds, item.id]);
                    }}
                  >
                    <Check className={cn("size-4", on ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono">{item.sku}</span>
                    <span className="text-muted-foreground">{item.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
