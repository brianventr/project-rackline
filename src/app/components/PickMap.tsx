import { useEffect, useMemo, useState } from "react";
import { api, type Location, type OrderLine, type WarehouseMapData } from "../api";
import { WarehouseMap, type MapView } from "./WarehouseMap";
import { Button, Card } from "./ui";
import { buildPickMapStops, pickMapLocationIds, pickMapMarkers, type PickMapLine } from "@/domain/pick-map";
import { useWarehouse } from "../warehouse";

const COMPACT_MAP = "h-[min(42vh,420px)]";

function asPickMapLines(lines: OrderLine[]): PickMapLine[] {
  return lines.map((line) => ({
    lineId: line.id,
    sku: line.sku,
    remaining: line.remaining ?? Math.max(0, line.qty - (line.qtyPicked ?? 0)),
    suggestedLocation: line.suggestedLocation
      ? { locationId: line.suggestedLocation.locationId, locationCode: line.suggestedLocation.locationCode }
      : null,
    allocations: line.allocations,
  }));
}

export function PickMap({
  lines,
  locations,
  selectedLocationId,
  onSelectLocation,
}: {
  lines: OrderLine[];
  locations: Location[];
  selectedLocationId?: string | null;
  onSelectLocation: (locationId: string) => void;
}) {
  const { warehouseId } = useWarehouse();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Extract<MapView, "floor" | "iso">>("floor");
  const [map, setMap] = useState<WarehouseMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const plan = useMemo(
    () => buildPickMapStops(asPickMapLines(lines), map?.locations ?? locations),
    [lines, map, locations],
  );
  const pickIds = useMemo(() => pickMapLocationIds(plan.stops), [plan.stops]);
  const pickMarkers = useMemo(() => pickMapMarkers(plan.stops), [plan.stops]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
    api<WarehouseMapData>(`/api/map${query}`)
      .then((next) => {
        if (!cancelled) setMap(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, warehouseId]);

  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Pick map</p>
          <p className="text-sm text-muted-foreground">
            Optional floor plan of remaining grabs{plan.stops.length ? ` · ${plan.stops.length} stop${plan.stops.length === 1 ? "" : "s"}` : ""}.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Show pick map
        </Button>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Pick map</p>
          <p className="text-xs text-muted-foreground">
            Green bays are remaining grabs. Orange is the bay you will pick from.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={view === "floor" ? "primary" : "ghost"} onClick={() => setView("floor")}>
            Floor plan
          </Button>
          <Button variant={view === "iso" ? "primary" : "ghost"} onClick={() => setView("iso")}>
            3D racks
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Hide
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading && !map ? <p className="text-sm text-muted-foreground">Loading floor…</p> : null}
      {map ? (
        <WarehouseMap
          warehouse={map.warehouse}
          locations={map.locations}
          selectedId={selectedLocationId}
          pickIds={pickIds}
          pickMarkers={pickMarkers}
          view={view}
          levelFilter="all"
          className={COMPACT_MAP}
          onSelect={(location) => onSelectLocation(location.id)}
        />
      ) : null}
      {plan.stops.length ? (
        <ol className="space-y-1 text-sm">
          {plan.stops.map((stop) => {
            const active = stop.locationId === selectedLocationId;
            return (
              <li key={stop.locationId}>
                <button
                  type="button"
                  className={`flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left ${
                    active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted"
                  }`}
                  onClick={() => onSelectLocation(stop.locationId)}
                >
                  <span>
                    <span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-[#3d8b6e] text-[11px] font-semibold text-white">
                      {stop.step}
                    </span>
                    <span className="font-mono">{stop.locationCode}</span>
                    <span className="text-muted-foreground"> · {stop.label}</span>
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">×{stop.qty}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing left to grab on the map.</p>
      )}
      {plan.unlocated.length ? (
        <p className="text-sm text-muted-foreground">
          No stock: {plan.unlocated.map((row) => `${row.sku} ×${row.remaining}`).join(", ")}
        </p>
      ) : null}
    </Card>
  );
}
