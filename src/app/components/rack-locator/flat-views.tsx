import { useMemo } from "react";
import type { MapLocation, WarehouseMapInfo } from "../../api";
import { footprint, groupFloorObjects, objectForLocation } from "@/domain/rack-builder";
import type { RackFace } from "@/domain/rack-targets";
import { cn } from "@/lib/utils";
import { ReticleMark, TONE_STROKE, type TargetTone } from "./reticle";

/** Drawing width the rack face aims for, so text stays near 1:1 in the card whatever the bay count. */
const FACE_W = 460;
const CELL_H = 36;
const LABEL_W = 26;
const HEADER_H = 18;
const POST = 4;
const BEAM = 3;
const BASE_H = 6;

/**
 * Front of one rack: bays left to right, level 1 at the floor. Targeted bins carry the crosshair;
 * the rest show their unit count so the picker can recognise the face when they get there.
 */
export function RackElevation({
  face,
  tones,
  focusId,
  onFocus,
}: {
  face: RackFace;
  tones: ReadonlyMap<string, TargetTone>;
  focusId: string | null;
  onFocus: (locationId: string) => void;
}) {
  const cellW = Math.min(150, Math.max(40, (FACE_W - LABEL_W - POST) / face.bays.length));
  const width = LABEL_W + face.bays.length * cellW + POST;
  const height = HEADER_H + face.levels.length * CELL_H + BASE_H;
  const cells = new Map(face.cells.map((cell) => [`${cell.bay}:${cell.level}`, cell]));
  const top = face.levels.length - 1;
  const focusCell = face.cells.find((cell) => cell.locationId === focusId) ?? null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mx-auto block h-auto max-h-64 w-full"
      style={{ maxWidth: width * 1.15 }}
      role="img"
      aria-label={`Aisle ${face.aisle} rack ${face.rack}, front view${focusCell ? `, target ${focusCell.code}` : ""}`}
    >
      {face.bays.map((bay, index) => (
        <text
          key={`bay-${bay}`}
          x={LABEL_W + index * cellW + (cellW + POST) / 2}
          y={HEADER_H - 6}
          textAnchor="middle"
          fontSize="10"
          fontFamily="ui-monospace, monospace"
          fill="var(--muted-foreground)"
          fontWeight={focusCell?.bay === bay ? 700 : 400}
        >
          {bay}
        </text>
      ))}
      {face.levels.map((level, index) => (
        <text
          key={`level-${level}`}
          x={LABEL_W - 7}
          y={HEADER_H + (top - index) * CELL_H + CELL_H / 2 + 3}
          textAnchor="end"
          fontSize="10"
          fontFamily="ui-monospace, monospace"
          fill="var(--muted-foreground)"
          fontWeight={focusCell?.level === level ? 700 : 400}
        >
          L{level}
        </text>
      ))}
      {face.bays.map((_, index) => (
        <rect
          key={`post-${index}`}
          x={LABEL_W + index * cellW}
          y={HEADER_H - 2}
          width={POST}
          height={face.levels.length * CELL_H + 2}
          rx="1"
          fill="var(--muted-foreground)"
          opacity="0.45"
        />
      ))}
      <rect
        x={LABEL_W + face.bays.length * cellW}
        y={HEADER_H - 2}
        width={POST}
        height={face.levels.length * CELL_H + 2}
        rx="1"
        fill="var(--muted-foreground)"
        opacity="0.45"
      />
      {face.levels.map((_, index) => (
        <rect
          key={`beam-${index}`}
          x={LABEL_W}
          y={HEADER_H + (index + 1) * CELL_H - BEAM}
          width={face.bays.length * cellW + POST}
          height={BEAM}
          fill="var(--primary)"
          opacity="0.35"
        />
      ))}
      <rect
        x={LABEL_W - 4}
        y={HEADER_H + face.levels.length * CELL_H}
        width={face.bays.length * cellW + POST + 8}
        height={BASE_H - 2}
        rx="1"
        fill="var(--border)"
      />
      {face.bays.flatMap((bay, bayIndex) =>
        face.levels.map((level, levelIndex) => {
          const cell = cells.get(`${bay}:${level}`);
          if (!cell) return null;
          const x = LABEL_W + bayIndex * cellW + POST + 3;
          const y = HEADER_H + (top - levelIndex) * CELL_H + 4;
          const w = cellW - POST - 6;
          const h = CELL_H - BEAM - 7;
          const tone = tones.get(cell.locationId) ?? null;
          const focused = cell.locationId === focusId;
          return (
            <g
              key={cell.locationId}
              className={cn(tone && "cursor-pointer")}
              onClick={tone ? () => onFocus(cell.locationId) : undefined}
            >
              <title>{`${cell.code} · ${cell.units ? `${cell.units} units` : "empty"}`}</title>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx="3"
                fill={tone ? TONE_STROKE[tone] : cell.units > 0 ? "var(--muted-foreground)" : "transparent"}
                fillOpacity={tone ? (focused ? 0.24 : 0.14) : cell.units > 0 ? 0.16 : 0}
                stroke={tone ? TONE_STROKE[tone] : "var(--border)"}
                strokeWidth={tone ? (focused ? 2 : 1.25) : 1}
                strokeDasharray={tone || cell.units > 0 ? undefined : "3 2"}
              />
              {tone ? (
                <g transform={`translate(${x + w / 2} ${y + h / 2})`}>
                  <ReticleMark tone={tone} focused={focused} scale={tone === "target" ? 0.62 : 0.5} />
                </g>
              ) : cell.units > 0 ? (
                <text
                  x={x + w / 2}
                  y={y + h / 2 + 3.5}
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                  fill="var(--muted-foreground)"
                  pointerEvents="none"
                >
                  {cell.units}
                </text>
              ) : null}
            </g>
          );
        }),
      )}
    </svg>
  );
}

type FloorCell = {
  key: string;
  posX: number;
  posY: number;
  sizeX: number;
  sizeY: number;
  type: string;
  code: string;
  units: number;
  ids: string[];
};

function floorCells(locations: MapLocation[]): FloorCell[] {
  const grouped = new Map<string, MapLocation[]>();
  for (const location of locations) {
    const key = `${location.posX}:${location.posY}`;
    grouped.set(key, [...(grouped.get(key) ?? []), location]);
  }
  return [...grouped.entries()].map(([key, rows]) => {
    const base = rows.slice().sort((a, b) => a.level - b.level)[0]!;
    return {
      key,
      posX: base.posX,
      posY: base.posY,
      sizeX: base.sizeX,
      sizeY: base.sizeY,
      type: base.type,
      code: base.code,
      units: rows.reduce((sum, row) => sum + row.unitsOnHand, 0),
      ids: rows.map((row) => row.id),
    };
  });
}

const AREA_FILL: Record<string, string> = {
  receiving: "var(--tone-info-bg)",
  shipping: "var(--tone-warning-bg)",
  production: "var(--tone-success-bg)",
};

/** Top-down building plan: where the targeted rack stands, with the focused bay's code called out. */
export function FloorLocator({
  warehouse,
  locations,
  tones,
  focusId,
  onFocus,
}: {
  warehouse: WarehouseMapInfo;
  locations: MapLocation[];
  tones: ReadonlyMap<string, TargetTone>;
  focusId: string | null;
  onFocus: (locationId: string) => void;
}) {
  const cells = useMemo(() => floorCells(locations), [locations]);
  const rackBox = useMemo(() => {
    if (!focusId) return null;
    const object = objectForLocation(groupFloorObjects(locations), focusId);
    return object?.kind === "rack" ? footprint(object.locations) : null;
  }, [locations, focusId]);
  const pad = 1;
  const focusCode = locations.find((row) => row.id === focusId)?.code ?? null;
  const marked = cells
    .map((cell) => {
      const ids = cell.ids.filter((id) => tones.has(id));
      if (!ids.length) return null;
      const tone: TargetTone = ids.some((id) => tones.get(id) === "target") ? "target" : "origin";
      return { cell, ids, tone, focused: Boolean(focusId && ids.includes(focusId)) };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    // Draw the focused crosshair last so it sits on top.
    .sort((a, b) => Number(a.focused) - Number(b.focused));

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${warehouse.mapWidth + pad * 2} ${warehouse.mapDepth + pad * 2}`}
      className="h-auto max-h-72 w-full"
      role="img"
      aria-label={`${warehouse.name} floor plan${focusCode ? `, target ${focusCode}` : ""}`}
    >
      <rect
        x="0"
        y="0"
        width={warehouse.mapWidth}
        height={warehouse.mapDepth}
        rx="0.4"
        fill="var(--muted)"
        stroke="var(--border)"
        strokeWidth="0.12"
      />
      {cells.map((cell) => {
        const area = AREA_FILL[cell.type];
        return (
          <g key={cell.key}>
            <rect
              x={cell.posX}
              y={cell.posY}
              width={cell.sizeX}
              height={cell.sizeY}
              rx="0.12"
              fill={area ?? (cell.units > 0 ? "var(--muted-foreground)" : "var(--card)")}
              fillOpacity={area ? 1 : cell.units > 0 ? 0.3 : 1}
              stroke="var(--border)"
              strokeWidth="0.06"
            />
            {area && cell.sizeX >= 3 ? (
              <text
                x={cell.posX + cell.sizeX / 2}
                y={cell.posY + cell.sizeY / 2 + 0.3}
                textAnchor="middle"
                fontSize="0.85"
                fontFamily="ui-monospace, monospace"
                fill="var(--muted-foreground)"
                pointerEvents="none"
              >
                {cell.code}
              </text>
            ) : null}
          </g>
        );
      })}
      {rackBox ? (
        <rect
          x={rackBox.posX - 0.25}
          y={rackBox.posY - 0.25}
          width={rackBox.sizeX + 0.5}
          height={rackBox.sizeY + 0.5}
          rx="0.25"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="0.14"
          strokeDasharray="0.45 0.3"
        />
      ) : null}
      {marked.map(({ cell, ids, tone, focused }) => {
        const cx = cell.posX + cell.sizeX / 2;
        const cy = cell.posY + cell.sizeY / 2;
        const scale = (focused ? 1.25 : tone === "target" ? 0.95 : 0.7) / 12;
        return (
          <g
            key={cell.key}
            className="cursor-pointer"
            onClick={() => onFocus(focusId && ids.includes(focusId) ? focusId : ids[0]!)}
          >
            <rect
              x={cell.posX}
              y={cell.posY}
              width={cell.sizeX}
              height={cell.sizeY}
              rx="0.12"
              fill={TONE_STROKE[tone]}
              fillOpacity={focused ? 0.9 : 0.6}
            />
            <g transform={`translate(${cx} ${cy})`}>
              <ReticleMark tone={tone} focused={focused} scale={scale} />
            </g>
          </g>
        );
      })}
      {focusCode
        ? marked
            .filter((row) => row.focused)
            .map(({ cell }) => {
              const above = cell.posY > 2.2;
              return (
                <text
                  key={`label-${cell.key}`}
                  x={cell.posX + cell.sizeX / 2}
                  y={above ? cell.posY - 1.2 : cell.posY + cell.sizeY + 2.2}
                  textAnchor="middle"
                  fontSize="1.35"
                  fontWeight="600"
                  fontFamily="ui-monospace, monospace"
                  fill="var(--foreground)"
                  stroke="var(--background)"
                  strokeWidth="0.45"
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {focusCode}
                </text>
              );
            })
        : null}
    </svg>
  );
}
