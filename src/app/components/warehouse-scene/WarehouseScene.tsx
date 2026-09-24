import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { MapLocation, WarehouseMapInfo } from "@/app/api";
import {
  expandArea,
  expandRack,
  footprint,
  objectFootprint,
  objectForLocation,
  snap,
  worldCenter,
  type AreaSpec,
  type Box3,
  type FloorObject,
  type LocationDraft,
  type LocationLike,
  type RackSpec,
} from "@/domain/rack-builder";
import { countZoneBays, hasFootprint, type ZoneFootprint, type ZoneRect } from "@/domain/zones";
import type { PickMapMarker } from "@/domain/pick-map";
import { cn } from "@/lib/utils";
import { Reticle, type TargetTone } from "../rack-locator/reticle";
import { readSceneTheme, zoneColor, type SceneTheme } from "./theme";
import { cartonGeometry, PALLET_HEIGHT, PALLET_LIFT, RackFrames, RackPallets, loadFootprint } from "./rack-meshes";

export type CameraMode = "top" | "orbit";
/** A bay the current work points at: `target` gets the crosshair, `origin` is where stock comes from. */
export type SceneTarget = { locationId: string; tone: TargetTone; label: string };
export type Ghost =
  | { kind: "rack"; spec: RackSpec; valid: boolean; message?: string | null; zoneLabel?: string | null }
  | { kind: "area"; spec: AreaSpec; valid: boolean; message?: string | null; zoneLabel?: string | null }
  | { kind: "zone"; spec: ZoneRect & { code?: string | null }; valid: boolean; message?: string | null };

type Props = {
  warehouse: WarehouseMapInfo;
  locations: MapLocation[];
  objects: FloorObject[];
  selectedLocationId?: string | null;
  selectedObjectId?: string | null;
  highlightBay?: string | null;
  fromId?: string | null;
  toId?: string | null;
  pickIds?: string[];
  pickMarkers?: PickMapMarker[];
  targets?: SceneTarget[];
  /** Fly the orbit camera to this bay instead of framing the whole building. */
  focusLocationId?: string | null;
  /** Small embeds drop the orbit gizmo and the camera status chip. */
  compact?: boolean;
  className?: string;
  mode: "view" | "build";
  cameraMode: CameraMode;
  /** A rack or area ghost follows the cursor; objects are not pickable. */
  placing?: boolean;
  /** An object is being dragged (pointer or arrow keys). */
  translating?: boolean;
  /** The zone tool is active: objects are not pickable and a pointer-down on the floor starts a rectangle. */
  drawing?: boolean;
  /** A zone rectangle is being dragged out right now. */
  sketching?: boolean;
  explode?: boolean;
  levelFilter?: "all" | number;
  hiddenObjectId?: string | null;
  ghost?: Ghost | null;
  cursor?: { x: number; y: number } | null;
  /** Zones drawn on this floor, in code order; tag-only zones are skipped. */
  zones?: ZoneFootprint[];
  selectedZoneId?: string | null;
  onSelectLocation: (location: MapLocation | null) => void;
  onSelectObject: (id: string | null) => void;
  onSelectZone?: (id: string | null) => void;
  onFloorMove?: (x: number, y: number) => void;
  /** A left button went down on bare floor (used to start a zone rectangle). */
  onFloorDown?: (x: number, y: number) => void;
  /** A clean click (no drag) that began on bare floor, not on an object or zone. */
  onFloorClick?: (x: number, y: number) => void;
  onTranslateBegin?: (objectId: string, x: number, y: number) => void;
  onTranslateMove?: (x: number, y: number) => void;
  onTranslateEnd?: () => void;
  onDrawEnd?: () => void;
};

/** How far (px) a pointer may travel between down and up and still count as a click. */
const CLICK_SLOP = 3;
type Ring = [number, number, number][];

function ring(box: { posX: number; posY: number; sizeX: number; sizeY: number }, y: number): Ring {
  const x0 = box.posX;
  const z0 = box.posY;
  const x1 = box.posX + box.sizeX;
  const z1 = box.posY + box.sizeY;
  return [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
    [x0, y, z0],
  ];
}

/** Where a dock / bench / staging box sits and how tall it is drawn, so labels and outlines can find its top. */
function areaBoxDims(location: { posZ: number; sizeZ: number }) {
  const h = Math.max(0.4, location.sizeZ * 0.45);
  const y = Math.max(0.08, location.posZ + location.sizeZ / 2);
  return { y, h, top: y + h / 2 };
}

const PLAN_TILT = 0.05;
const EMPTY_ROWS: Array<LocationLike & { id?: string }> = [];

function explodeLift(level: number, spec: { levelHeight: number }, explode: boolean) {
  if (!explode) return 0;
  return Math.max(0, (level - 1) * spec.levelHeight * 0.55);
}

function binColor(
  location: LocationLike,
  theme: SceneTheme,
  selected: boolean,
  hovered: boolean,
  from: boolean,
  to: boolean,
  baySection: boolean,
  pick = false,
  tone: TargetTone | null = null,
) {
  if (from) return theme.from;
  if (to) return theme.to;
  if (selected) return theme.selected;
  if (tone === "target") return theme.selected;
  if (tone === "origin") return theme.from;
  if (hovered) return theme.hover;
  if (pick) return theme.pick;
  if (baySection) return theme.bayHighlight;
  if ((location.unitsOnHand ?? 0) > 0) return theme.occupied;
  if (location.type === "receiving") return theme.areaRecv;
  if (location.type === "production") return theme.areaProd;
  if (location.type === "shipping") return theme.areaShip;
  return theme.empty;
}

function InstancedBins({
  drafts,
  locations,
  theme,
  selectedLocationId,
  hoveredId,
  fromId,
  toId,
  pickIds,
  targetTones,
  highlightBay,
  ghost,
  pickable,
  explode,
  levelFilter,
  onHover,
  onPointerDown,
}: {
  drafts?: LocationDraft[];
  locations?: MapLocation[];
  theme: SceneTheme;
  selectedLocationId?: string | null;
  hoveredId?: string | null;
  fromId?: string | null;
  toId?: string | null;
  pickIds?: ReadonlySet<string>;
  targetTones?: ReadonlyMap<string, TargetTone>;
  highlightBay?: string | null;
  ghost?: { valid: boolean };
  pickable: boolean;
  explode: boolean;
  levelFilter: "all" | number;
  onHover?: (id: string | null) => void;
  onPointerDown?: (event: ThreeEvent<PointerEvent>, location: MapLocation) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const source = locations ?? drafts ?? EMPTY_ROWS;
  const rows = useMemo(() => {
    const list = levelFilter === "all" ? source : source.filter((row) => (row.level ?? 1) === levelFilter);
    if (ghost) return list;
    return list.filter((row) => {
      if ((row.unitsOnHand ?? 0) > 0) return true;
      return (
        row.id === selectedLocationId ||
        row.id === hoveredId ||
        row.id === fromId ||
        row.id === toId ||
        Boolean(row.id && pickIds?.has(row.id)) ||
        Boolean(row.id && targetTones?.has(row.id)) ||
        Boolean(highlightBay && row.bay === highlightBay)
      );
    });
  }, [source, levelFilter, ghost, selectedLocationId, hoveredId, fromId, toId, pickIds, targetTones, highlightBay]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const inst = mesh.current;
    if (!inst) return;
    rows.forEach((row, i) => {
      const center = worldCenter(row);
      const lift = explodeLift(row.level ?? 1, { levelHeight: Math.max(1, row.sizeZ) }, explode);
      const occupied = (row.unitsOnHand ?? 0) > 0;
      const pad = loadFootprint(row.sizeX, row.sizeY);
      const cartonH = ghost
        ? Math.max(0.28, Math.min(1.15, row.sizeZ - 0.22))
        : occupied
          ? Math.max(0.42, Math.min(1.08, row.sizeZ - 0.72))
          : Math.max(0.2, Math.min(0.42, row.sizeZ - 0.5));
      const cartonY = ghost
        ? row.posZ + 0.22 + lift + cartonH / 2
        : occupied
          ? row.posZ + PALLET_LIFT + lift + PALLET_HEIGHT + cartonH / 2
          : center.y + 0.02 + lift;
      dummy.position.set(center.x, cartonY, center.z);
      dummy.scale.set(ghost ? Math.max(0.4, row.sizeX - 0.28) : pad.sx - (occupied ? 0.06 : 0.12), cartonH, ghost ? Math.max(0.4, row.sizeY - 0.28) : pad.sz - (occupied ? 0.06 : 0.12));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      if (ghost) {
        color.set(ghost.valid ? theme.ghost : theme.invalid);
      } else {
        color.set(
          binColor(
            row,
            theme,
            row.id === selectedLocationId,
            row.id === hoveredId,
            row.id === fromId,
            row.id === toId,
            Boolean(highlightBay) && row.bay === highlightBay,
            Boolean(row.id && pickIds?.has(row.id)),
            (row.id && targetTones?.get(row.id)) || null,
          ),
        );
      }
      inst.setColorAt(i, color);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }, [rows, theme, selectedLocationId, hoveredId, fromId, toId, pickIds, targetTones, highlightBay, ghost, dummy, color, explode]);

  if (rows.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[cartonGeometry, undefined, rows.length]}
      frustumCulled={false}
      raycast={pickable ? undefined : () => undefined}
      onPointerMove={
        pickable && locations
          ? (event) => {
              event.stopPropagation();
              const loc = rows[event.instanceId ?? 0];
              if (loc?.id) onHover?.(loc.id);
            }
          : undefined
      }
      onPointerOut={pickable ? () => onHover?.(null) : undefined}
      onPointerDown={
        pickable && locations
          ? (event) => {
              event.stopPropagation();
              const loc = rows[event.instanceId ?? 0];
              if (loc && "id" in loc && loc.id) onPointerDown?.(event, loc as MapLocation);
            }
          : undefined
      }
    >
      <meshStandardMaterial
        metalness={0.06}
        roughness={0.58}
        transparent={Boolean(ghost)}
        opacity={ghost ? 0.42 : 1}
        emissive={ghost ? (ghost.valid ? theme.ghost : theme.invalid) : "#000000"}
        emissiveIntensity={ghost ? 0.18 : 0}
      />
    </instancedMesh>
  );
}

/**
 * A dock, bench, or staging area: a solid slab in its type colour with a dark edge and a label, so it reads
 * against the floor from straight above. Selection and hover glow rather than recolour, since orange means stock.
 */
function AreaBox({
  location,
  theme,
  selected,
  hovered,
  pick,
  tone,
  pickable,
  ghost,
  label,
  onHover,
  onPointerDown,
}: {
  location: LocationLike & { id?: string };
  theme: SceneTheme;
  selected: boolean;
  hovered: boolean;
  pick?: boolean;
  tone?: TargetTone | null;
  pickable: boolean;
  ghost?: boolean;
  label?: string | null;
  onHover?: (id: string | null) => void;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const center = worldCenter(location);
  const dims = areaBoxDims(location);
  const glow = selected ? theme.selected : hovered ? theme.hover : null;
  return (
    <group>
      <mesh
        position={[center.x, dims.y, center.z]}
        raycast={pickable ? undefined : () => undefined}
        onPointerMove={
          pickable
            ? (event) => {
                event.stopPropagation();
                onHover?.(location.id ?? null);
              }
            : undefined
        }
        onPointerOut={pickable ? () => onHover?.(null) : undefined}
        onPointerDown={
          pickable
            ? (event) => {
                event.stopPropagation();
                onPointerDown?.(event);
              }
            : undefined
        }
      >
        <boxGeometry args={[location.sizeX, dims.h, location.sizeY]} />
        <meshStandardMaterial
          color={binColor(location, theme, false, false, false, false, false, pick, tone)}
          roughness={0.62}
          metalness={0.05}
          transparent={Boolean(ghost)}
          opacity={ghost ? 0.4 : 1}
          emissive={glow ?? "#000000"}
          emissiveIntensity={glow ? (selected ? 0.32 : 0.18) : 0}
        />
      </mesh>
      {ghost ? null : (
        <Line points={ring(location, dims.top + 0.01)} color={theme.areaEdge} lineWidth={1.2} transparent opacity={0.85} />
      )}
      {label ? (
        <Html position={[center.x, dims.top + 0.05, center.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="max-w-[12rem] truncate rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-foreground shadow-sm ring-1 ring-border">
            {label}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/** Selection and hover feedback: a ring on the floor, a ring on top, and the four corner posts between them. */
function ObjectOutline({
  box,
  top,
  color,
  lineWidth,
  opacity = 1,
  posts = true,
}: {
  box: Box3;
  top: number;
  color: string;
  lineWidth: number;
  opacity?: number;
  posts?: boolean;
}) {
  const floor = 0.06;
  const corners: [number, number][] = [
    [box.posX, box.posY],
    [box.posX + box.sizeX, box.posY],
    [box.posX + box.sizeX, box.posY + box.sizeY],
    [box.posX, box.posY + box.sizeY],
  ];
  return (
    <group>
      <Line points={ring(box, floor)} color={color} lineWidth={lineWidth} transparent opacity={opacity} />
      <Line points={ring(box, top)} color={color} lineWidth={lineWidth} transparent opacity={opacity} />
      {posts
        ? corners.map(([x, z], index) => (
            <Line
              key={index}
              points={[
                [x, floor, z],
                [x, top, z],
              ]}
              color={color}
              lineWidth={Math.max(1, lineWidth * 0.7)}
              transparent
              opacity={opacity * 0.8}
            />
          ))
        : null}
    </group>
  );
}

/** A drawn zone: a tinted patch on the floor under everything else, its outline, and a corner label. */
function ZoneFloor({
  zone,
  color,
  selected,
  pickable,
  bays,
  compact,
  onPointerDown,
}: {
  zone: ZoneFootprint;
  color: string;
  selected: boolean;
  pickable: boolean;
  bays: number;
  compact?: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const cx = zone.posX + zone.sizeX / 2;
  const cz = zone.posY + zone.sizeY / 2;
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cx, 0.03, cz]}
        raycast={pickable ? undefined : () => undefined}
        onPointerDown={
          pickable
            ? (event) => {
                event.stopPropagation();
                onPointerDown?.(event);
              }
            : undefined
        }
      >
        <planeGeometry args={[zone.sizeX, zone.sizeY]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.34 : 0.18} depthWrite={false} />
      </mesh>
      <Line points={ring(zone, 0.05)} color={color} lineWidth={selected ? 2.6 : 1.4} transparent opacity={selected ? 1 : 0.85} />
      {compact ? null : (
        <Html position={[zone.posX + 0.3, 0.06, zone.posY + 0.3]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div
            className="flex items-center gap-1 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-foreground shadow-sm ring-1 ring-border"
            style={{ borderLeft: `3px solid ${color}` }}
          >
            <span className="font-mono">Zone {zone.code}</span>
            <span className="text-muted-foreground">
              · {zone.name} · {bays} {bays === 1 ? "bay" : "bays"}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}

/** The rectangle being dragged out (or waiting to be named) by the zone tool. */
function ZoneGhost({ rect, color, label }: { rect: ZoneRect; color: string; label: string }) {
  if (rect.sizeX <= 0 || rect.sizeY <= 0) {
    return (
      <Html position={[rect.posX, 0.1, rect.posY]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        <div className="rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border">drag to size</div>
      </Html>
    );
  }
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rect.posX + rect.sizeX / 2, 0.04, rect.posY + rect.sizeY / 2]} raycast={() => undefined}>
        <planeGeometry args={[rect.sizeX, rect.sizeY]} />
        <meshBasicMaterial color={color} transparent opacity={0.24} depthWrite={false} />
      </mesh>
      <Line points={ring(rect, 0.07)} color={color} lineWidth={2.2} />
      <Html position={[rect.posX + rect.sizeX / 2, 0.1, rect.posY + rect.sizeY / 2]} center zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        <div className="rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground shadow-sm ring-1 ring-border">{label}</div>
      </Html>
    </group>
  );
}

function nearestLocation(locations: MapLocation[], point: THREE.Vector3) {
  let best: MapLocation | null = null;
  let bestDist = Infinity;
  for (const loc of locations) {
    const center = worldCenter(loc);
    const dx = center.x - point.x;
    const dy = center.y - point.y;
    const dz = center.z - point.z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < bestDist) {
      best = loc;
      bestDist = dist;
    }
  }
  return best;
}

function RackHitVolume({
  spec,
  explode,
  pickable,
  onHover,
  onPointerDown,
}: {
  spec: RackSpec;
  explode: boolean;
  pickable: boolean;
  onHover?: (over: boolean) => void;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const extra = explode ? spec.levelHeight * 0.55 * Math.max(0, spec.levels - 1) : 0;
  const fp = footprint(expandRack(spec));
  if (!fp) return null;
  const center = worldCenter({ ...fp, sizeZ: fp.sizeZ + extra });
  return (
    <mesh
      position={[center.x, center.y, center.z]}
      visible={false}
      raycast={pickable ? undefined : () => undefined}
      onPointerMove={pickable ? () => onHover?.(true) : undefined}
      onPointerOut={pickable ? () => onHover?.(false) : undefined}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown(event);
      }}
    >
      <boxGeometry args={[Math.max(0.4, fp.sizeX), Math.max(0.4, fp.sizeZ + extra), Math.max(0.4, fp.sizeY)]} />
    </mesh>
  );
}

function FootprintLine({ box, color }: { box: { posX: number; posY: number; sizeX: number; sizeY: number }; color: string }) {
  const y = 0.06;
  const x0 = box.posX;
  const z0 = box.posY;
  const x1 = box.posX + box.sizeX;
  const z1 = box.posY + box.sizeY;
  return <Line points={[[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]]} color={color} lineWidth={1.6} />;
}

function PickMarkers({
  locations,
  markers,
  explode,
  levelFilter,
}: {
  locations: MapLocation[];
  markers?: PickMapMarker[];
  explode: boolean;
  levelFilter: "all" | number;
}) {
  if (!markers?.length) return null;
  const byId = new Map(locations.map((row) => [row.id, row]));
  return (
    <>
      {markers.map((marker) => {
        const loc = byId.get(marker.locationId);
        if (!loc) return null;
        if (levelFilter !== "all" && loc.level !== levelFilter) return null;
        const center = worldCenter(loc);
        const lift = explodeLift(loc.level ?? 1, { levelHeight: Math.max(1, loc.sizeZ) }, explode);
        return (
          <Html
            key={marker.locationId}
            position={[center.x, loc.posZ + loc.sizeZ + lift + 0.35, center.z]}
            center
            zIndexRange={[40, 0]}
            style={{ pointerEvents: "none" }}
          >
            <div className="flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-foreground shadow-sm ring-1 ring-border">
              <span className="grid size-4 place-items-center rounded-full bg-[#3d8b6e] text-[9px] font-semibold text-white">
                {marker.step}
              </span>
              <span className="max-w-[8rem] truncate font-mono">{marker.label}</span>
            </div>
          </Html>
        );
      })}
    </>
  );
}

/** Crosshair on each targeted bay, with a beam up past the top of its rack to a label you can spot from across the floor. */
function TargetMarkers({
  locations,
  objects,
  targets,
  focusLocationId,
  theme,
  explode,
  levelFilter,
}: {
  locations: MapLocation[];
  objects: FloorObject[];
  targets?: SceneTarget[];
  focusLocationId?: string | null;
  theme: SceneTheme;
  explode: boolean;
  levelFilter: "all" | number;
}) {
  if (!targets?.length) return null;
  const byId = new Map(locations.map((row) => [row.id, row]));
  return (
    <>
      {targets.map((target) => {
        const loc = byId.get(target.locationId);
        if (!loc) return null;
        if (levelFilter !== "all" && loc.level !== levelFilter) return null;
        const center = worldCenter(loc);
        const lift = explodeLift(loc.level ?? 1, { levelHeight: Math.max(1, loc.sizeZ) }, explode);
        const object = objectForLocation(objects, loc.id);
        const rackTop =
          object?.kind === "rack"
            ? object.spec.levels * object.spec.levelHeight + explodeLift(object.spec.levels, object.spec, explode)
            : loc.posZ + loc.sizeZ;
        const binTop = loc.posZ + loc.sizeZ + lift;
        const beamTop = Math.max(binTop + 1.1, rackTop + (target.tone === "target" ? 0.7 : 0.4));
        const focused = target.locationId === focusLocationId;
        const color = target.tone === "target" ? theme.selected : theme.from;
        return (
          <group key={`${target.locationId}:${target.tone}`}>
            <Line
              points={[
                [center.x, binTop, center.z],
                [center.x, beamTop, center.z],
              ]}
              color={color}
              lineWidth={focused ? 2.6 : 1.4}
              transparent
              opacity={target.tone === "target" ? 0.95 : 0.7}
            />
            <Html
              position={[center.x, center.y + lift, center.z]}
              center
              zIndexRange={[focused ? 60 : 50, 0]}
              style={{ pointerEvents: "none" }}
            >
              <Reticle tone={target.tone} focused={focused} />
            </Html>
            <Html
              position={[center.x, beamTop, center.z]}
              center
              zIndexRange={[focused ? 60 : 45, 0]}
              style={{ pointerEvents: "none" }}
            >
              <div
                className={cn(
                  "flex items-center gap-1 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-foreground shadow-sm ring-1",
                  focused ? "ring-primary" : "ring-border",
                )}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
                <span className="max-w-[9rem] truncate font-mono">{target.label}</span>
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

function WarehouseCurb({ warehouse, theme }: { warehouse: WarehouseMapInfo; theme: SceneTheme }) {
  const w = warehouse.mapWidth;
  const d = warehouse.mapDepth;
  const t = 0.22;
  const h = 0.7;
  return (
    <group>
      <mesh position={[w / 2, h / 2, -t / 2]}>
        <boxGeometry args={[w + t * 2, h, t]} />
        <meshStandardMaterial color={theme.steel} metalness={0.35} roughness={0.55} />
      </mesh>
      <mesh position={[w / 2, h / 2, d + t / 2]}>
        <boxGeometry args={[w + t * 2, h, t]} />
        <meshStandardMaterial color={theme.steel} metalness={0.35} roughness={0.55} />
      </mesh>
      <mesh position={[-t / 2, h / 2, d / 2]}>
        <boxGeometry args={[t, h, d]} />
        <meshStandardMaterial color={theme.steel} metalness={0.35} roughness={0.55} />
      </mesh>
      <mesh position={[w + t / 2, h / 2, d / 2]}>
        <boxGeometry args={[t, h, d]} />
        <meshStandardMaterial color={theme.steel} metalness={0.35} roughness={0.55} />
      </mesh>
    </group>
  );
}

/** What the last pointer press landed on. Objects stop pointer-down propagation, so the floor only sees its own presses. */
type PressTarget = "floor" | "object" | null;

function Ground({
  warehouse,
  theme,
  press,
  onMove,
  onDown,
  onClick,
}: {
  warehouse: WarehouseMapInfo;
  theme: SceneTheme;
  press: React.MutableRefObject<PressTarget>;
  onMove?: (x: number, y: number) => void;
  onDown?: (x: number, y: number) => void;
  /** Fires for a clean click that began on the floor itself; clicks that began on an object never reach it. */
  onClick?: (x: number, y: number) => void;
}) {
  const { invalidate } = useThree();
  const w = warehouse.mapWidth;
  const d = warehouse.mapDepth;
  function toCell(event: { point: THREE.Vector3 }) {
    return { x: snap(event.point.x), y: snap(event.point.z) };
  }
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[w / 2, 0, d / 2]}
        onPointerDown={(event) => {
          press.current = event.button === 0 ? "floor" : null;
          if (event.button !== 0) return;
          const cell = toCell(event);
          onDown?.(cell.x, cell.y);
        }}
        onPointerMove={(event) => {
          const cell = toCell(event);
          onMove?.(cell.x, cell.y);
          invalidate();
        }}
        onClick={(event) => {
          event.stopPropagation();
          const pressed = press.current;
          press.current = null;
          if (pressed !== "floor" || event.delta > CLICK_SLOP) return;
          const cell = toCell(event);
          onClick?.(cell.x, cell.y);
        }}
      >
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={theme.floor} roughness={0.94} metalness={0.02} />
      </mesh>
      <Grid
        position={[w / 2, 0.02, d / 2]}
        args={[w, d]}
        cellSize={1}
        cellThickness={0.55}
        cellColor={theme.grid}
        sectionSize={5}
        sectionThickness={1.05}
        sectionColor={theme.gridSection}
        fadeDistance={120}
        fadeStrength={0.35}
        infiniteGrid={false}
        raycast={() => undefined}
      />
      <WarehouseCurb warehouse={warehouse} theme={theme} />
    </group>
  );
}

function DragPlane({
  warehouse,
  enabled,
  onMove,
}: {
  warehouse: WarehouseMapInfo;
  enabled: boolean;
  onMove?: (x: number, y: number) => void;
}) {
  const w = warehouse.mapWidth;
  const d = warehouse.mapDepth;
  if (!enabled) return null;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[w / 2, 0.08, d / 2]}
      onPointerMove={(event) => {
        event.stopPropagation();
        onMove?.(snap(event.point.x), snap(event.point.z));
      }}
    >
      <planeGeometry args={[w * 2, d * 2]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** The top of an object as drawn, so an outline can sit just above it. */
function objectTop(object: FloorObject, explode: boolean): number {
  if (object.kind === "rack") {
    return object.spec.levels * object.spec.levelHeight + explodeLift(object.spec.levels, object.spec, explode) + 0.12;
  }
  return areaBoxDims(object.location).top + 0.08;
}

function SceneContents(
  props: Props & {
    theme: SceneTheme;
    hoveredId: string | null;
    setHoveredId: (id: string | null) => void;
    hoveredObjectId: string | null;
    setHoveredObjectId: (id: string | null) => void;
    pickIdSet?: ReadonlySet<string>;
    targetTones?: ReadonlyMap<string, TargetTone>;
  },
) {
  const w = props.warehouse.mapWidth;
  const d = props.warehouse.mapDepth;
  const build = props.mode === "build";
  const drawing = Boolean(props.drawing);
  const pickable = !props.placing && !props.translating && !drawing;
  const zonesPickable = pickable && build && Boolean(props.onSelectZone);
  const explode = Boolean(props.explode);
  const levelFilter = props.levelFilter ?? "all";
  const gl = useThree((state) => state.gl);
  const press = useRef<PressTarget>(null);
  const drawnZones = useMemo(() => (props.zones ?? []).filter(hasFootprint), [props.zones]);

  const selectedObject = useMemo(
    () => props.objects.find((row) => row.id === props.selectedObjectId) ?? null,
    [props.objects, props.selectedObjectId],
  );
  const hoveredObject = useMemo(() => {
    if (props.hoveredObjectId) return props.objects.find((row) => row.id === props.hoveredObjectId) ?? null;
    if (props.hoveredId) return objectForLocation(props.objects, props.hoveredId);
    return null;
  }, [props.objects, props.hoveredObjectId, props.hoveredId]);
  const selectedBox = selectedObject ? objectFootprint(selectedObject) : null;
  const hoveredBox = hoveredObject && hoveredObject.id !== props.selectedObjectId ? objectFootprint(hoveredObject) : null;

  // The pointer says what a press would do: grab an object, place or draw, or just point.
  useEffect(() => {
    const element = gl.domElement;
    element.style.cursor = props.translating
      ? "grabbing"
      : props.placing || drawing
        ? "crosshair"
        : build && hoveredObject && props.onTranslateBegin
          ? "grab"
          : hoveredObject
            ? "pointer"
            : "";
    return () => {
      element.style.cursor = "";
    };
  }, [gl, props.translating, props.placing, drawing, build, hoveredObject, props.onTranslateBegin]);

  function beginTranslate(objectId: string, event: ThreeEvent<PointerEvent>) {
    press.current = "object";
    if (!build || !props.onTranslateBegin || event.button !== 0) return;
    props.onTranslateBegin(objectId, snap(event.point.x), snap(event.point.z));
  }

  return (
    <>
      <hemisphereLight args={[props.theme.dark ? "#9aacbf" : "#f4f6f8", props.theme.dark ? "#101214" : "#7f8790", 0.82]} />
      <directionalLight position={[w * 0.18, 52, d * 0.08]} intensity={props.theme.dark ? 1.28 : 1.48} />
      <directionalLight position={[w * 0.55, 14, d + 22]} intensity={0.62} />
      <directionalLight position={[-16, 22, d * 0.45]} intensity={0.42} />
      <directionalLight position={[w + 14, 11, -10]} intensity={0.34} />
      <directionalLight position={[w * 0.5, 5.5, d * 0.55]} intensity={0.16} />
      <Ground
        warehouse={props.warehouse}
        theme={props.theme}
        press={press}
        onMove={props.onFloorMove}
        onDown={props.onFloorDown}
        onClick={props.onFloorClick}
      />
      <DragPlane
        warehouse={props.warehouse}
        enabled={Boolean(props.translating) || Boolean(props.sketching)}
        onMove={props.translating ? props.onTranslateMove : props.onFloorMove}
      />
      {drawnZones.map((zone, index) => (
        <ZoneFloor
          key={zone.id}
          zone={zone}
          color={zoneColor(props.theme, index)}
          selected={zone.id === props.selectedZoneId}
          pickable={zonesPickable}
          bays={countZoneBays(zone.id, props.locations)}
          compact={props.compact}
          onPointerDown={(event) => {
            press.current = "object";
            if (event.button !== 0) return;
            props.onSelectZone?.(zone.id);
          }}
        />
      ))}
      {props.objects.map((object) => {
        if (object.id === props.hiddenObjectId) return null;
        if (object.kind === "rack") {
          const locs = props.locations.filter((row) => object.locations.some((bin) => bin.id === row.id));
          const selected = object.id === props.selectedObjectId;
          return (
            <group key={object.id}>
              <RackFrames spec={object.spec} theme={props.theme} explode={explode} />
              <RackPallets locations={locs} explode={explode} theme={props.theme} />
              <InstancedBins
                locations={locs}
                theme={props.theme}
                selectedLocationId={props.selectedLocationId}
                hoveredId={props.hoveredId}
                fromId={props.fromId}
                toId={props.toId}
                pickIds={props.pickIdSet}
                targetTones={props.targetTones}
                highlightBay={selected ? props.highlightBay : null}
                pickable={pickable}
                explode={explode}
                levelFilter={levelFilter}
                onHover={props.setHoveredId}
                onPointerDown={(event, location) => {
                  props.onSelectObject(object.id);
                  props.onSelectLocation(location);
                  beginTranslate(object.id, event);
                }}
              />
              <RackHitVolume
                spec={object.spec}
                explode={explode}
                pickable={pickable}
                onHover={(over) => props.setHoveredObjectId(over ? object.id : null)}
                onPointerDown={(event) => {
                  const location = nearestLocation(locs, event.point);
                  if (!location) return;
                  props.onSelectObject(object.id);
                  props.onSelectLocation(location);
                  beginTranslate(object.id, event);
                }}
              />
              {selected ? (
                <Html
                  position={[
                    worldCenter(footprint(object.locations)!).x,
                    object.spec.levels * object.spec.levelHeight + explodeLift(object.spec.levels, object.spec, explode) + 0.9,
                    worldCenter(footprint(object.locations)!).z,
                  ]}
                  center
                  style={{ pointerEvents: "none" }}
                >
                  <div className="rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-foreground shadow-sm ring-1 ring-border">
                    Aisle {object.aisle} · rack {object.rack} · {object.spec.bays} bays · {object.spec.levels} levels
                  </div>
                </Html>
              ) : null}
            </group>
          );
        }
        const loc = props.locations.find((row) => row.id === object.location.id);
        if (!loc) return null;
        const label = props.compact
          ? null
          : [loc.code, loc.name && loc.name !== loc.code ? loc.name : null, loc.unitsOnHand > 0 ? `${loc.unitsOnHand} u` : null]
              .filter(Boolean)
              .join(" · ");
        return (
          <AreaBox
            key={object.id}
            location={loc}
            theme={props.theme}
            selected={object.id === props.selectedObjectId || loc.id === props.selectedLocationId}
            hovered={props.hoveredId === loc.id}
            pick={Boolean(props.pickIdSet?.has(loc.id))}
            tone={props.targetTones?.get(loc.id) ?? null}
            pickable={pickable}
            label={label}
            onHover={props.setHoveredId}
            onPointerDown={(event) => {
              props.onSelectObject(object.id);
              props.onSelectLocation(loc);
              beginTranslate(object.id, event);
            }}
          />
        );
      })}
      {hoveredBox && hoveredObject && pickable && hoveredObject.id !== props.hiddenObjectId ? (
        <ObjectOutline box={hoveredBox} top={objectTop(hoveredObject, explode)} color={props.theme.hover} lineWidth={1.4} opacity={0.75} posts={false} />
      ) : null}
      {selectedBox && selectedObject && selectedObject.id !== props.hiddenObjectId ? (
        <ObjectOutline box={selectedBox} top={objectTop(selectedObject, explode)} color={props.theme.outline} lineWidth={2.4} />
      ) : null}
      <PickMarkers
        locations={props.locations}
        markers={props.pickMarkers}
        explode={explode}
        levelFilter={levelFilter}
      />
      <TargetMarkers
        locations={props.locations}
        objects={props.objects}
        targets={props.targets}
        focusLocationId={props.focusLocationId}
        theme={props.theme}
        explode={explode}
        levelFilter={levelFilter}
      />
      {props.ghost?.kind === "rack" ? (
        <group>
          <RackFrames spec={props.ghost.spec} theme={props.theme} ghost explode={explode} />
          <InstancedBins
            drafts={expandRack(props.ghost.spec)}
            theme={props.theme}
            ghost={{ valid: props.ghost.valid }}
            pickable={false}
            explode={explode}
            levelFilter={levelFilter}
          />
          {footprint(expandRack(props.ghost.spec)) ? (
            <FootprintLine
              box={footprint(expandRack(props.ghost.spec))!}
              color={props.ghost.valid ? props.theme.ghost : props.theme.invalid}
            />
          ) : null}
        </group>
      ) : null}
      {props.ghost?.kind === "area" ? (
        <group>
          <AreaBox location={expandArea(props.ghost.spec)} theme={props.theme} selected={false} hovered={false} pickable={false} ghost />
          <FootprintLine box={props.ghost.spec} color={props.ghost.valid ? props.theme.ghost : props.theme.invalid} />
        </group>
      ) : null}
      {props.ghost?.kind === "zone" ? (
        <ZoneGhost
          rect={props.ghost.spec}
          color={props.ghost.valid ? props.theme.ghost : props.theme.invalid}
          label={`${props.ghost.spec.code ? `Zone ${props.ghost.spec.code} · ` : ""}${props.ghost.spec.sizeX} × ${props.ghost.spec.sizeY}`}
        />
      ) : null}
      {props.cameraMode === "top" ? (
        <Html position={[1.1, 0.2, 1.1]} center style={{ pointerEvents: "none" }}>
          <div className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border">N</div>
        </Html>
      ) : null}
    </>
  );
}

/** A bay's centre plus the horizontal direction its face looks out on, so the camera can stand in the aisle. */
type CameraFocus = { x: number; y: number; z: number; nx: number; nz: number };
type OrbitControlsLike = { target: THREE.Vector3; update: () => void; enabled: boolean };

const FLIGHT_MS = 650;

function focusPose(focus: CameraFocus) {
  // Aim a little above the bin so the crosshair sits low in frame and its beam label stays in view.
  const target = new THREE.Vector3(focus.x, focus.y + 1.1, focus.z);
  const along = focus.nx !== 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const position = target
    .clone()
    .add(new THREE.Vector3(focus.nx * 10, 4.2, focus.nz * 10))
    .addScaledVector(along, 3.6);
  return { target, position };
}

function CameraRig({
  warehouse,
  cameraMode,
  focus,
}: {
  warehouse: WarehouseMapInfo;
  cameraMode: CameraMode;
  focus?: CameraFocus | null;
}) {
  const { camera, invalidate } = useThree();
  const controls = useThree((state) => state.controls) as unknown as OrbitControlsLike | null;
  const placed = useRef(false);
  const flight = useRef<{
    fromPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    position: THREE.Vector3;
    target: THREE.Vector3;
    start: number;
  } | null>(null);
  const w = warehouse.mapWidth;
  const d = warehouse.mapDepth;
  useLayoutEffect(() => {
    placed.current = false;
    camera.up.set(0, 1, 0);
    const cx = w / 2;
    const cz = d / 2;
    if (cameraMode === "top") {
      const height = Math.max(40, Math.max(w, d) * 1.4);
      camera.position.set(cx, height, cz + height * Math.tan(PLAN_TILT));
    } else {
      camera.position.set(w * 0.72, 24, d * 1.14);
    }
    camera.lookAt(cx, 0, cz);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, cameraMode, w, d, invalidate]);

  const fx = focus?.x;
  const fy = focus?.y;
  const fz = focus?.z;
  const fnx = focus?.nx;
  const fnz = focus?.nz;
  useEffect(() => {
    if (fx == null || fy == null || fz == null || fnx == null || fnz == null) return;
    if (!controls || cameraMode !== "orbit") return;
    const pose = focusPose({ x: fx, y: fy, z: fz, nx: fnx, nz: fnz });
    if (!placed.current) {
      placed.current = true;
      flight.current = null;
      camera.position.copy(pose.position);
      controls.target.copy(pose.target);
      controls.update();
      invalidate();
      return;
    }
    flight.current = {
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      ...pose,
      start: performance.now(),
    };
  }, [fx, fy, fz, fnx, fnz, controls, camera, cameraMode, invalidate]);

  useFrame(() => {
    const current = flight.current;
    if (!current || !controls) return;
    const t = Math.min(1, (performance.now() - current.start) / FLIGHT_MS);
    const eased = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(current.fromPosition, current.position, eased);
    controls.target.lerpVectors(current.fromTarget, current.target, eased);
    controls.update();
    if (t >= 1) flight.current = null;
  });
  return null;
}

/** The chip under a valid ghost: what a click or key does next, and which zone the object would join. */
function ghostCaption(ghost: Ghost, translating: boolean): string {
  if (ghost.kind === "zone") {
    return ghost.spec.code
      ? `Zone ${ghost.spec.code} · ${ghost.spec.sizeX} × ${ghost.spec.sizeY} · Enter saves, Esc cancels`
      : `${ghost.spec.sizeX} × ${ghost.spec.sizeY} · release to finish`;
  }
  const zone = ghost.zoneLabel ? ` · joins zone ${ghost.zoneLabel}` : "";
  if (translating) return `Release to drop · R rotates · Esc cancels${zone}`;
  if (ghost.kind === "rack") return `Click to place ${ghost.spec.bays * ghost.spec.levels} bins · R rotates${zone}`;
  return `Click to place ${ghost.spec.name}${zone}`;
}

class WebGLBoundary extends Component<{ children: ReactNode; className?: string }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (this.state.message) {
      return (
        <div
          className={cn(
            "grid h-[min(74vh,820px)] place-items-center rounded-xl border bg-muted px-6 text-center text-sm text-muted-foreground",
            this.props.className,
          )}
        >
          WebGL could not start on this machine. Use Floor plan, or enable hardware/software WebGL in the browser.
        </div>
      );
    }
    return this.props.children;
  }
}

export function WarehouseScene(props: Props) {
  const [theme, setTheme] = useState<SceneTheme>(() => readSceneTheme());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const dragging = useRef(false);
  const sketching = useRef(false);
  // The camera controls are switched off for the length of a drag so orbit mode does not spin while an object moves.
  const controlsRef = useRef<OrbitControlsLike | null>(null);
  useEffect(() => {
    const sync = () => setTheme(readSceneTheme());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const { onTranslateEnd, onDrawEnd } = props;
  useEffect(() => {
    function onUp() {
      if (controlsRef.current) controlsRef.current.enabled = true;
      if (dragging.current) {
        dragging.current = false;
        onTranslateEnd?.();
      }
      if (sketching.current) {
        sketching.current = false;
        onDrawEnd?.();
      }
    }
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onTranslateEnd, onDrawEnd]);

  const hovered = props.locations.find((row) => row.id === hoveredId) ?? null;
  const w = props.warehouse.mapWidth;
  const d = props.warehouse.mapDepth;
  const status = props.cameraMode === "top" ? "Plan · orthographic" : "Orbit · perspective";
  const pickIdSet = useMemo(() => new Set(props.pickIds ?? []), [props.pickIds]);
  const targetTones = useMemo(() => {
    const tones = new Map<string, TargetTone>();
    for (const target of props.targets ?? []) {
      if (tones.get(target.locationId) !== "target") tones.set(target.locationId, target.tone);
    }
    return tones;
  }, [props.targets]);
  const focus = useMemo<CameraFocus | null>(() => {
    if (!props.focusLocationId) return null;
    const loc = props.locations.find((row) => row.id === props.focusLocationId);
    if (!loc) return null;
    const center = worldCenter(loc);
    const object = objectForLocation(props.objects, loc.id);
    if (object?.kind !== "rack") return { ...center, nx: 0.7, nz: 0.7 };
    // Bays run along one axis; face the rack from the aisle on the building's inner side.
    const alongX = object.spec.rotation === 90 || object.spec.rotation === 270;
    return alongX
      ? { ...center, nx: 0, nz: center.z < d / 2 ? 1 : -1 }
      : { ...center, nx: center.x < w / 2 ? 1 : -1, nz: 0 };
  }, [props.focusLocationId, props.locations, props.objects, w, d]);
  const frameClass = cn(
    "relative h-[min(74vh,820px)] w-full touch-none overflow-hidden rounded-xl border bg-bay",
    props.className,
  );

  return (
    <div className={frameClass} onContextMenu={(event) => event.preventDefault()}>
      <WebGLBoundary className={props.className}>
        <Canvas
          dpr={[1, 2]}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: "default",
            failIfMajorPerformanceCaveat: false,
            toneMapping: THREE.ACESFilmicToneMapping,
          }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.14;
          }}
          frameloop="always"
          onPointerMissed={() => {
            if (props.placing || props.translating || props.drawing) return;
            props.onSelectLocation(null);
            props.onSelectObject(null);
            props.onSelectZone?.(null);
          }}
        >
          <color attach="background" args={[theme.background]} />
          {props.cameraMode === "top" ? (
            <OrthographicCamera makeDefault near={0.1} far={500} zoom={16} />
          ) : (
            <PerspectiveCamera makeDefault fov={42} near={0.1} far={500} />
          )}
          <CameraRig warehouse={props.warehouse} cameraMode={props.cameraMode} focus={focus} />
          <OrbitControls
            ref={(instance) => {
              controlsRef.current = instance as unknown as OrbitControlsLike | null;
            }}
            makeDefault
            target={[w / 2, 0, d / 2]}
            enableRotate={props.cameraMode === "orbit" && !props.placing && !props.translating && !props.drawing}
            enableDamping
            dampingFactor={0.12}
            screenSpacePanning
            minPolarAngle={props.cameraMode === "top" ? PLAN_TILT : 0.18}
            maxPolarAngle={props.cameraMode === "top" ? PLAN_TILT : Math.PI / 2 - 0.06}
            minZoom={6}
            maxZoom={80}
            maxDistance={110}
            minDistance={2.4}
            mouseButtons={{
              LEFT:
                props.cameraMode === "orbit" && !props.placing && !props.drawing
                  ? THREE.MOUSE.ROTATE
                  : (undefined as unknown as THREE.MOUSE),
              MIDDLE: THREE.MOUSE.PAN,
              RIGHT: THREE.MOUSE.PAN,
            }}
          />
          <SceneContents
            {...props}
            theme={theme}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
            hoveredObjectId={hoveredObjectId}
            setHoveredObjectId={setHoveredObjectId}
            pickIdSet={pickIdSet}
            targetTones={targetTones}
            onTranslateBegin={
              props.onTranslateBegin
                ? (id, x, y) => {
                    dragging.current = true;
                    if (controlsRef.current) controlsRef.current.enabled = false;
                    props.onTranslateBegin?.(id, x, y);
                  }
                : undefined
            }
            onTranslateMove={(x, y) => {
              if (!dragging.current) return;
              props.onTranslateMove?.(x, y);
            }}
            onFloorDown={
              props.onFloorDown
                ? (x, y) => {
                    if (!props.drawing) return;
                    sketching.current = true;
                    if (controlsRef.current) controlsRef.current.enabled = false;
                    props.onFloorDown?.(x, y);
                  }
                : undefined
            }
          />
          {props.cameraMode === "orbit" && !props.compact ? (
            <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
              <GizmoViewport axisColors={[theme.selected, theme.steel, theme.ghost]} labelColor={theme.dark ? "#f4f4f4" : "#222"} />
            </GizmoHelper>
          ) : null}
        </Canvas>
      </WebGLBoundary>
      {props.compact ? null : (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/85 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur">
          {status}
          {props.cursor ? ` · ${props.cursor.x}, ${props.cursor.y}` : ""}
          {hovered ? ` · ${hovered.code}` : ""}
        </div>
      )}
      {props.ghost ? (
        <div
          className={`pointer-events-none absolute bottom-3 left-1/2 max-w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md px-3 py-1.5 text-center text-[11px] shadow-sm ring-1 backdrop-blur ${
            props.ghost.valid
              ? "bg-background/90 text-muted-foreground ring-border"
              : "bg-destructive/90 text-white ring-destructive"
          }`}
        >
          {props.ghost.valid ? ghostCaption(props.ghost, Boolean(props.translating)) : props.ghost.message || "That footprint overlaps another bay or leaves the warehouse."}
        </div>
      ) : null}
    </div>
  );
}
