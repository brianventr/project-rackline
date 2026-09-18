import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { MapLocation, WarehouseMapInfo } from "../api";

export type MapView = "floor" | "iso";

type Props = {
  warehouse: WarehouseMapInfo;
  locations: MapLocation[];
  selectedId?: string | null;
  fromId?: string | null;
  toId?: string | null;
  view: MapView;
  levelFilter: "all" | number;
  canDrag?: boolean;
  onSelect: (location: MapLocation) => void;
  onReposition?: (locationId: string, posX: number, posY: number) => void;
};

function iso(x: number, y: number, z: number) {
  return {
    x: (x - y) * 16,
    y: (x + y) * 8 - z * 14,
  };
}

function poly(points: Array<{ x: number; y: number }>) {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

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

function typePalette(type: string, occupied: boolean) {
  if (type === "receiving") {
    return { top: "#e8d3ae", left: "#d3bb91", right: "#c4a97d", stroke: "#8a7048" };
  }
  if (type === "production") {
    return { top: "#cfe0d2", left: "#b4c9b8", right: "#9bb5a0", stroke: "#4d6a55" };
  }
  if (type === "shipping") {
    return { top: "#ddd4cc", left: "#c6bbb2", right: "#b1a59b", stroke: "#6d635b" };
  }
  if (occupied) {
    return { top: "#f0c14b", left: "#d7a62e", right: "#c49216", stroke: "#8a6408" };
  }
  return { top: "#f7edd8", left: "#e6d7b8", right: "#d5c4a0", stroke: "#a38b63" };
}

function locationFill(location: Pick<MapLocation, "type" | "unitsOnHand">, selected: boolean, from: boolean, to: boolean) {
  if (from) return "#2f6f4e";
  if (to) return "#b45309";
  if (selected) return "#e3a008";
  if (location.unitsOnHand > 0) return "#e3a008";
  if (location.type === "receiving") return "#d7c4a3";
  if (location.type === "production") return "#c9d7c4";
  if (location.type === "shipping") return "#d3c7bc";
  return "#efe4cf";
}

export function WarehouseMap({
  warehouse,
  locations,
  selectedId,
  fromId,
  toId,
  view,
  levelFilter,
  canDrag,
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
    return <IsoMap warehouse={warehouse} locations={visible} selectedId={selectedId} fromId={fromId} toId={toId} onSelect={onSelect} />;
  }

  const pad = 1.5;
  return (
    <svg
      ref={svgRef}
      viewBox={`${-pad} ${-pad} ${warehouse.mapWidth + pad * 2} ${warehouse.mapDepth + pad * 2}`}
      className="h-[min(72vh,760px)] w-full touch-none rounded-xl bg-[#cbb892]"
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
          const x = ghost?.id && cell.locations.some((l) => l.id === ghost.id) ? ghost.x : cell.posX;
          const y = ghost?.id && cell.locations.some((l) => l.id === ghost.id) ? ghost.y : cell.posY;
          const primary =
            cell.locations.find((location) => location.id === selectedId) ??
            cell.locations.find((location) => location.unitsOnHand > 0) ??
            cell.locations[0]!;
          return (
            <g key={cell.key} className="cursor-pointer" onClick={() => onSelect(primary)}>
              <rect
                x={x}
                y={y}
                width={cell.sizeX}
                height={cell.sizeY}
                rx="0.18"
                fill={locationFill({ ...primary, unitsOnHand: cell.units }, selected, from, to)}
                stroke={selected || from || to ? "#1b1712" : "#6b542e"}
                strokeWidth={selected || from || to ? 0.18 : 0.08}
                onPointerDown={(event) => onPointerDown(event, primary)}
              />
              <text
                x={x + cell.sizeX / 2}
                y={y + cell.sizeY / 2 - (cell.levels.length > 1 ? 0.35 : 0.15)}
                textAnchor="middle"
                fontSize={Math.min(0.85, cell.sizeX / 5)}
                fontFamily="ui-monospace, monospace"
                fill="#1b1712"
                pointerEvents="none"
              >
                {cell.label}
              </text>
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
            </g>
          );
        })}
    </svg>
  );
}

function IsoMap({
  warehouse,
  locations,
  selectedId,
  fromId,
  toId,
  onSelect,
}: {
  warehouse: WarehouseMapInfo;
  locations: MapLocation[];
  selectedId?: string | null;
  fromId?: string | null;
  toId?: string | null;
  onSelect: (location: MapLocation) => void;
}) {
  const floor = [
    iso(0, 0, 0),
    iso(warehouse.mapWidth, 0, 0),
    iso(warehouse.mapWidth, warehouse.mapDepth, 0),
    iso(0, warehouse.mapDepth, 0),
  ];
  const xs = [
    ...floor.map((p) => p.x),
    ...locations.flatMap((loc) => [iso(loc.posX, loc.posY, loc.posZ + loc.sizeZ).x, iso(loc.posX + loc.sizeX, loc.posY + loc.sizeY, 0).x]),
  ];
  const ys = [
    ...floor.map((p) => p.y),
    ...locations.flatMap((loc) => [iso(loc.posX, loc.posY, loc.posZ + loc.sizeZ).y, iso(loc.posX + loc.sizeX, loc.posY + loc.sizeY, 0).y]),
  ];
  const minX = Math.min(...xs) - 40;
  const minY = Math.min(...ys) - 40;
  const maxX = Math.max(...xs) + 40;
  const maxY = Math.max(...ys) + 40;
  const ordered = locations.slice().sort((a, b) => a.posX + a.posY + a.posZ - (b.posX + b.posY + b.posZ));

  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      className="h-[min(72vh,760px)] w-full rounded-xl bg-[#1b1712]"
      role="img"
      aria-label="3D warehouse rack map"
    >
      <polygon points={poly(floor)} fill="#8d7349" stroke="#5c4a32" strokeWidth="2" />
      <polygon
        points={poly([iso(0, 0, 0), iso(warehouse.mapWidth, 0, 0), iso(warehouse.mapWidth, 0, 1.2), iso(0, 0, 1.2)])}
        fill="#7a6340"
      />
      {ordered.map((location) => {
        const occupied = location.unitsOnHand > 0;
        const selected = location.id === selectedId;
        const from = location.id === fromId;
        const to = location.id === toId;
        const palette = typePalette(location.type, occupied);
        const x1 = location.posX;
        const y1 = location.posY;
        const z1 = location.posZ;
        const x2 = location.posX + location.sizeX;
        const y2 = location.posY + location.sizeY;
        const z2 = location.posZ + location.sizeZ;
        const top = [iso(x1, y1, z2), iso(x2, y1, z2), iso(x2, y2, z2), iso(x1, y2, z2)];
        const left = [iso(x1, y2, z1), iso(x2, y2, z1), iso(x2, y2, z2), iso(x1, y2, z2)];
        const right = [iso(x2, y1, z1), iso(x2, y2, z1), iso(x2, y2, z2), iso(x2, y1, z2)];
        const label = iso(x1 + location.sizeX / 2, y1 + location.sizeY / 2, z2);
        const stroke = from ? "#7dffa6" : to ? "#ffb25c" : selected ? "#ffe08a" : palette.stroke;
        return (
          <g key={location.id} className="cursor-pointer" onClick={() => onSelect(location)}>
            <polygon points={poly(left)} fill={palette.left} stroke={stroke} strokeWidth={selected || from || to ? 2.2 : 1} />
            <polygon points={poly(right)} fill={palette.right} stroke={stroke} strokeWidth={selected || from || to ? 2.2 : 1} />
            <polygon points={poly(top)} fill={palette.top} stroke={stroke} strokeWidth={selected || from || to ? 2.2 : 1} />
            <text x={label.x} y={label.y + 3} textAnchor="middle" fontSize="11" fill="#1b1712" fontFamily="ui-monospace, monospace">
              {location.code}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
