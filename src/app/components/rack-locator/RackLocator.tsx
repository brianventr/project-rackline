import { lazy, Suspense, useMemo, useState } from "react";
import { MapPinOff } from "lucide-react";
import type { WarehouseMapData } from "../../api";
import { useApiQuery } from "../../query";
import { useWarehouse } from "../../warehouse";
import { groupFloorObjects } from "@/domain/rack-builder";
import { binAddress, formatTargetItems, rackFace, type RackTarget } from "@/domain/rack-targets";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FloorLocator, RackElevation } from "./flat-views";
import { locateDetailPath, planTargets, type Locate, type LocateDetail } from "./locate";
import { Reticle, type TargetTone } from "./reticle";

const WarehouseScene = lazy(() =>
  import("../warehouse-scene/WarehouseScene").then((mod) => ({ default: mod.WarehouseScene })),
);

type LocatorView = "flat" | "3d";

const NO_TARGETS: RackTarget[] = [];

const VIEW_KEY = "rackline-locator-view";
const SCENE_HEIGHT = "h-72";

function readView(): LocatorView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "3d" ? "3d" : "flat";
  } catch {
    return "flat";
  }
}

function storeView(view: LocatorView) {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* Private windows can refuse storage; the toggle still holds for this card. */
  }
}

function toneOf(target: RackTarget): TargetTone {
  return target.primary ? "target" : "origin";
}

/**
 * Where a Today row's stock is, or where it is going: a rack face and floor plan (Flat) or the 3D racks,
 * with a crosshair on every bay the work points at. Clicking a bay in the list, the plan, or the scene
 * swings the view to it.
 */
export function RackLocator({ locate }: { locate: Locate | null }) {
  const { warehouseId } = useWarehouse();
  const mapQuery = useApiQuery<WarehouseMapData>(
    `/api/map${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ""}`,
    { staleTime: 30_000 },
  );
  const detailPath = locateDetailPath(locate);
  const detailQuery = useApiQuery<LocateDetail>(detailPath);
  const map = mapQuery.data ?? null;
  const [view, setView] = useState<LocatorView>(readView);
  const [focusPick, setFocusPick] = useState<string | null>(null);

  const plan = useMemo(() => {
    if (!locate || !map) return null;
    if (detailPath && !detailQuery.data) return null;
    return planTargets(locate, detailQuery.data, map.locations);
  }, [locate, map, detailPath, detailQuery.data]);
  const targets = plan?.targets ?? NO_TARGETS;
  const byId = useMemo(() => new Map((map?.locations ?? []).map((row) => [row.id, row])), [map]);
  const tones = useMemo(() => {
    const next = new Map<string, TargetTone>();
    for (const target of targets) {
      if (next.get(target.locationId) !== "target") next.set(target.locationId, toneOf(target));
    }
    return next;
  }, [targets]);
  const focusId =
    (focusPick && targets.some((target) => target.locationId === focusPick) ? focusPick : null) ??
    targets.find((target) => target.primary)?.locationId ??
    null;
  const focusLocation = focusId ? byId.get(focusId) ?? null : null;
  const face = useMemo(() => (map && focusId ? rackFace(map.locations, focusId) : null), [map, focusId]);
  const objects = useMemo(() => (map ? groupFloorObjects(map.locations) : []), [map]);
  const sceneTargets = useMemo(
    () =>
      targets.map((target) => ({
        locationId: target.locationId,
        tone: toneOf(target),
        label: byId.get(target.locationId)?.code ?? "",
      })),
    [targets, byId],
  );

  const loading = Boolean(locate) && (mapQuery.isLoading || (Boolean(detailPath) && detailQuery.isLoading));
  const error = mapQuery.error?.message ?? detailQuery.error?.message ?? null;

  function choose(next: string) {
    if (next !== "flat" && next !== "3d") return;
    setView(next);
    storeView(next);
  }

  return (
    <section aria-label="Rack location" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Rack location</h3>
          <p className="truncate text-xs text-muted-foreground">
            {focusLocation ? (
              <>
                <span className="font-mono text-foreground">{focusLocation.code}</span> · {binAddress(focusLocation)}
              </>
            ) : (
              "Where this work sits in the building"
            )}
          </p>
        </div>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={choose}
          variant="outline"
          size="sm"
          aria-label="Rack view"
          className="shrink-0"
        >
          <ToggleGroupItem value="flat" className="px-3">
            Flat
          </ToggleGroupItem>
          <ToggleGroupItem value="3d" className="px-3">
            3D
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : loading ? (
        <Skeleton className={cn("w-full rounded-lg", SCENE_HEIGHT)} />
      ) : !targets.length || !map ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
          <MapPinOff className="size-4 shrink-0" />
          <span>{emptyMessage(locate, plan?.unlocated.length ?? 0)}</span>
        </div>
      ) : view === "3d" ? (
        <Suspense fallback={<Skeleton className={cn("w-full rounded-lg", SCENE_HEIGHT)} />}>
          <WarehouseScene
            warehouse={map.warehouse}
            locations={map.locations}
            objects={objects}
            targets={sceneTargets}
            focusLocationId={focusId}
            compact
            mode="view"
            cameraMode="orbit"
            className={cn(SCENE_HEIGHT, "rounded-lg")}
            onSelectLocation={(location) => {
              if (location && tones.has(location.id)) setFocusPick(location.id);
            }}
            onSelectObject={() => undefined}
          />
        </Suspense>
      ) : (
        <div className="space-y-3 rounded-lg border bg-background/60 p-3">
          {face ? (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Aisle {face.aisle} · Rack {face.rack} · front view
              </p>
              <RackElevation face={face} tones={tones} focusId={focusId} onFocus={setFocusPick} />
            </div>
          ) : focusLocation ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{focusLocation.code}</span> is a floor area, not a rack bin.
            </p>
          ) : null}
          <div>
            {face ? <p className="mb-1.5 text-xs font-medium text-muted-foreground">Floor plan</p> : null}
            <FloorLocator
              warehouse={map.warehouse}
              locations={map.locations}
              tones={tones}
              focusId={focusId}
              onFocus={setFocusPick}
            />
          </div>
        </div>
      )}

      {targets.length ? (
        <ol className="divide-y rounded-lg border" aria-label="Bays">
          {targets.map((target) => {
            const location = byId.get(target.locationId);
            if (!location) return null;
            const active = target.locationId === focusId;
            return (
              <li key={`${target.locationId}:${target.role}`}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFocusPick(target.locationId)}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                    active && "bg-muted/70",
                  )}
                >
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
                    <Reticle tone={toneOf(target)} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">
                        <span className="font-mono text-sm font-medium">{location.code}</span>
                        <span className="text-xs text-muted-foreground"> · {target.verb}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {formatTargetItems(target.items)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{binAddress(location)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
      {plan?.unlocated.length && targets.length ? (
        <p className="text-xs text-muted-foreground">No bay yet for {formatTargetItems(plan.unlocated)}.</p>
      ) : null}
    </section>
  );
}

function emptyMessage(locate: Locate | null, unlocated: number): string {
  if (!locate) return "This work does not touch a rack.";
  if (locate.kind === "onHand") return `No ${locate.sku} on hand in this building.`;
  if (locate.kind === "pick") return unlocated ? "No stock on a bay for the remaining lines." : "Every line is picked.";
  if (locate.kind === "receive") return "No receiving dock or putaway bay on this building's map yet.";
  return "Those bays are not on this building's map.";
}
