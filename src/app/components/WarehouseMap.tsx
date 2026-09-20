import { lazy, Suspense, useMemo, useRef, useState, type PointerEvent } from "react";
import type { MapLocation, WarehouseMapInfo } from "../api";
import { groupFloorObjects } from "@/domain/rack-builder";
import type { PickMapMarker } from "@/domain/pick-map";
import { cn } from "@/lib/utils";

const WarehouseScene = lazy(() =>
  import("./warehouse-scene/WarehouseScene").then((mod) => ({ default: mod.WarehouseScene })),
);

export type MapView = "floor" | "iso" | "build";

type Props = {
  warehouse: WarehouseMapInfo;
  locations: MapLocation[];
  selectedId?: string | null;
  fromId?: string | null;
  toId?: string | null;
  pickIds?: string[];
  pickMarkers?: PickMapMarker[];
  view: MapView;
  levelFilter: "all" | number;
  canDrag?: boolean;
  className?: string;
  onSelect: (location: MapLocation) => void;
  onReposition?: (locationId: string, posX: number, posY: number) => void;
};

function floorCells(locations: MapLocation[]) {
  const grouped = new Map<string, MapLocation[]>();
  for (const location of locations) {
    const key = `${location.posX}:${location.posY}`;
    const list = grouped.get(key) ?? [];
    list.push(location);
    grouped.set(key, list);
  }
  return [...grouped.entries()].map(([key, rows]) => {
    const sorted = rows.slice().sort((a, b) => a.level - b.level);
    const base = sorted[0]!;
    const levels = [...new Set(sorted.map((row) => row.level))];
    const label =
      base.aisle && base.rack && base.bay ? `${base.aisle}-${base.rack}-${base.bay}` : base.code;
    return {
      key,
      posX: base.posX,
      posY: base.posY,
      sizeX: base.sizeX,
      sizeY: base.sizeY,
      locations: sorted,
      label,
      units: sorted.reduce((sum, row) => sum + row.unitsOnHand, 0),
      levels,
    };
  });
}

function locationFill(
  location: Pick<MapLocation, "type" | "unitsOnHand">,
  selected: boolean,
  from: boolean,
  to: boolean,
  pick = false,
) {
  if (from) return "#2d6a4f";
  if (to) return "#e2b146";
  if (selected) return "#df6035";
  if (pick) return "#3d8b6e";
  if (location.unitsOnHand > 0) return "#e16f41";
  if (location.type === "receiving") return "#d6e4f0";
  if (location.type === "production") return "#cfe0d2";
  if (location.type === "shipping") return "#e8d3ae";
  return "#f4f0ea";
}

export function WarehouseMap({
  warehouse,
  locations,
  selectedId,
  fromId,
  toId,
  pickIds,
  pickMarkers,
  view,
  levelFilter,
  canDrag,
  className,
  onSelect,
  onReposition,
}: Props) {
  const visible = locations.filter((location) => levelFilter === "all" || location.level === levelFilter);
  const drag = useRef<{ id: string; originX: number; originY: number; startX: number; startY: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const areas = useMemo(() => {
    const grouped = new Map<string, MapLocation[]>();
    for (const location of visible) {
      const list = grouped.get(location.area) ?? [];
      list.push(location);
      grouped.set(location.area, list);
    }
    return [...grouped.entries()].map(([name, rows]) => {
      const minX = Math.min(...rows.map((row) => row.posX)) - 0.6;
      const minY = Math.min(...rows.map((row) => row.posY)) - 0.6;
      const maxX = Math.max(...rows.map((row) => row.posX + row.sizeX)) + 0.6;
      const maxY = Math.max(...rows.map((row) => row.posY + row.sizeY)) + 0.6;
      return { name, minX, minY, width: maxX - minX, depth: maxY - minY };
    });
  }, [visible]);

  function clientToFloor(event: PointerEvent<SVGElement>) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const mapped = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: mapped.x, y: mapped.y };
  }

  function onPointerDown(event: PointerEvent<SVGRectElement>, location: MapLocation) {
    if (!canDrag || view !== "floor" || !onReposition) return;
    event.stopPropagation();
    (event.target as SVGRectElement).setPointerCapture(event.pointerId);
    drag.current = {
      id: location.id,
      originX: location.posX,
      originY: location.posY,
      startX: clientToFloor(event).x,
      startY: clientToFloor(event).y,
    };
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const point = clientToFloor(event);
    const x = Math.round(drag.current.originX + (point.x - drag.current.startX));
    const y = Math.round(drag.current.originY + (point.y - drag.current.startY));
    setGhost({ id: drag.current.id, x, y });
  }

  function onPointerUp() {
    if (drag.current && ghost && onReposition) {
      onReposition(drag.current.id, Math.max(0, ghost.x), Math.max(0, ghost.y));
    }
    drag.current = null;
    setGhost(null);
  }

  if (view === "iso") {
    const objects = groupFloorObjects(visible);
    const frameClass = cn("h-[min(72vh,760px)] w-full", className);
    return (
      <Suspense
        fallback={
          <div className={cn("grid place-items-center rounded-xl border bg-muted text-sm text-muted-foreground", frameClass)}>
            Loading 3D floor…
          </div>
        }
      >
        <WarehouseScene
          warehouse={warehouse}
          locations={visible}
          objects={objects}
          selectedLocationId={selectedId}
          fromId={fromId}
          toId={toId}
          pickIds={pickIds}
          pickMarkers={pickMarkers}
          className={frameClass}
          mode="view"
          cameraMode="orbit"
          onSelectLocation={(location) => {
            if (location) onSelect(location);
          }}
          onSelectObject={() => undefined}
        />
      </Suspense>
    );
  }

  const pad = 1.5;
  return (
    <svg
      ref={svgRef}
      viewBox={`${-pad} ${-pad} ${warehouse.mapWidth + pad * 2} ${warehouse.mapDepth + pad * 2}`}
      className={cn("h-[min(72vh,760px)] w-full touch-none rounded-xl bg-muted", className)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      role="img"
      aria-label="Warehouse floor plan"
    >
      <rect x="0" y="0" width={warehouse.mapWidth} height={warehouse.mapDepth} fill="#d8c49a" stroke="#8d7349" strokeWidth="0.12" />
      {Array.from({ length: warehouse.mapWidth + 1 }, (_, i) => (
        <line key={`vx-${i}`} x1={i} y1={0} x2={i} y2={warehouse.mapDepth} stroke="rgba(90,70,40,0.12)" strokeWidth="0.04" />
      ))}
      {Array.from({ length: warehouse.mapDepth + 1 }, (_, i) => (
        <line key={`hz-${i}`} x1={0} y1={i} x2={warehouse.mapWidth} y2={i} stroke="rgba(90,70,40,0.12)" strokeWidth="0.04" />
      ))}
      {areas.map((area) => (
        <g key={area.name}>
          <rect
            x={area.minX}
            y={area.minY}
            width={area.width}
            height={area.depth}
            fill="rgba(255,250,243,0.22)"
            stroke="rgba(27,23,18,0.18)"
            strokeDasharray="0.4 0.25"
            strokeWidth="0.08"
            rx="0.3"
          />
          <text x={area.minX + 0.4} y={area.minY + 0.9} fontSize="0.85" fill="#5c4a32" fontFamily="ui-monospace, monospace">
            {area.name}
          </text>
        </g>
      ))}
      {floorCells(visible).map((cell) => {
          const selected = cell.locations.some((location) => location.id === selectedId);
          const from = cell.locations.some((location) => location.id === fromId);
          const to = cell.locations.some((location) => location.id === toId);
          const cellMarkers = (pickMarkers ?? []).filter((marker) =>
            cell.locations.some((location) => location.id === marker.locationId),
          );
          const pick = cell.locations.some((location) => pickIds?.includes(location.id));
          const x = ghost?.id && cell.locations.some((l) => l.id === ghost.id) ? ghost.x : cell.posX;
          const y = ghost?.id && cell.locations.some((l) => l.id === ghost.id) ? ghost.y : cell.posY;
          const primary =
            cell.locations.find((location) => location.id === selectedId) ??
            (cellMarkers[0] ? cell.locations.find((location) => location.id === cellMarkers[0]!.locationId) : undefined) ??
            cell.locations.find((location) => location.unitsOnHand > 0) ??
            cell.locations[0]!;
          const emphasized = selected || from || to || pick;
          return (
            <g key={cell.key} className="cursor-pointer" onClick={() => onSelect(primary)}>
              <rect
                x={x}
                y={y}
                width={cell.sizeX}
                height={cell.sizeY}
                rx="0.18"
                fill={locationFill({ ...primary, unitsOnHand: cell.units }, selected, from, to, pick)}
                stroke={emphasized ? "#1b1712" : "#6b542e"}
                strokeWidth={emphasized ? 0.18 : 0.08}
                onPointerDown={(event) => onPointerDown(event, primary)}
              />
              <text
                x={x + cell.sizeX / 2}
                y={y + cell.sizeY / 2 - (cellMarkers.length || cell.levels.length > 1 ? 0.35 : 0.15)}
                textAnchor="middle"
                fontSize={Math.min(0.85, cell.sizeX / 5)}
                fontFamily="ui-monospace, monospace"
                fill="#1b1712"
                pointerEvents="none"
              >
                {cell.label}
              </text>
              {cellMarkers.length ? (
                <text
                  x={x + cell.sizeX / 2}
                  y={y + cell.sizeY / 2 + 0.55}
                  textAnchor="middle"
                  fontSize="0.48"
                  fill="#1b1712"
                  pointerEvents="none"
                >
                  {cellMarkers.map((marker) => `${marker.step} ${marker.label}`).join(" · ")}
                </text>
              ) : (
                <text
                  x={x + cell.sizeX / 2}
                  y={y + cell.sizeY / 2 + 0.55}
                  textAnchor="middle"
                  fontSize="0.5"
                  fill="#3f3426"
                  pointerEvents="none"
                >
                  {cell.levels.length > 1 ? `L${cell.levels[0]}–${cell.levels[cell.levels.length - 1]} · ` : ""}
                  {cell.units > 0 ? `${cell.units} u` : "empty"}
                </text>
              )}
              {cellMarkers.map((marker, index) => (
                <g key={marker.locationId} pointerEvents="none">
                  <circle cx={x + 0.42} cy={y + 0.42 + index * 0.72} r="0.3" fill="#1b1712" />
                  <text
                    x={x + 0.42}
                    y={y + 0.55 + index * 0.72}
                    textAnchor="middle"
                    fontSize="0.38"
                    fill="#f4f0ea"
                    fontFamily="ui-monospace, monospace"
                  >
                    {marker.step}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
    </svg>
  );
}

