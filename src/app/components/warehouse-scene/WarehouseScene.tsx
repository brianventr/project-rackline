import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { MapLocation, WarehouseMapInfo } from "@/app/api";
import {
  expandArea,
  expandRack,
  footprint,
  snap,
  worldCenter,
  type AreaSpec,
  type FloorObject,
  type LocationDraft,
  type LocationLike,
  type RackSpec,
} from "@/domain/rack-builder";
import type { PickMapMarker } from "@/domain/pick-map";
import { cn } from "@/lib/utils";
import { readSceneTheme, type SceneTheme } from "./theme";
import { cartonGeometry, PALLET_HEIGHT, PALLET_LIFT, RackFrames, RackPallets, loadFootprint } from "./rack-meshes";

export type CameraMode = "top" | "orbit";
export type Ghost =
  | { kind: "rack"; spec: RackSpec; valid: boolean; message?: string | null }
  | { kind: "area"; spec: AreaSpec; valid: boolean; message?: string | null };

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
  className?: string;
  mode: "view" | "build";
  cameraMode: CameraMode;
  placing?: boolean;
  translating?: boolean;
  explode?: boolean;
  levelFilter?: "all" | number;
  hiddenObjectId?: string | null;
  ghost?: Ghost | null;
  cursor?: { x: number; y: number } | null;
  onSelectLocation: (location: MapLocation | null) => void;
  onSelectObject: (id: string | null) => void;
  onFloorMove?: (x: number, y: number) => void;
  onFloorClick?: (x: number, y: number) => void;
  onTranslateBegin?: (objectId: string, x: number, y: number) => void;
  onTranslateMove?: (x: number, y: number) => void;
  onTranslateEnd?: () => void;
};

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
) {
  if (from) return theme.from;
  if (to) return theme.to;
  if (selected) return theme.selected;
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
        Boolean(highlightBay && row.bay === highlightBay)
      );
    });
  }, [source, levelFilter, ghost, selectedLocationId, hoveredId, fromId, toId, pickIds, highlightBay]);
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
          ),
        );
      }
      inst.setColorAt(i, color);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }, [rows, theme, selectedLocationId, hoveredId, fromId, toId, pickIds, highlightBay, ghost, dummy, color, explode]);

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

function AreaBox({
  location,
  theme,
  selected,
  hovered,
  pick,
  pickable,
  ghost,
  onHover,
  onPointerDown,
}: {
  location: LocationLike & { id?: string };
  theme: SceneTheme;
  selected: boolean;
  hovered: boolean;
  pick?: boolean;
  pickable: boolean;
  ghost?: boolean;
  onHover?: (id: string | null) => void;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const center = worldCenter(location);
  return (
    <mesh
      position={[center.x, Math.max(0.08, center.y), center.z]}
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
      <boxGeometry args={[location.sizeX, Math.max(0.4, location.sizeZ * 0.45), location.sizeY]} />
      <meshStandardMaterial
        color={binColor(location, theme, selected, hovered, false, false, false, pick)}
        roughness={0.7}
        metalness={0.04}
        transparent={ghost || !selected}
        opacity={ghost ? 0.4 : selected ? 1 : 0.92}
      />
    </mesh>
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
  onPointerDown,
}: {
  spec: RackSpec;
  explode: boolean;
  pickable: boolean;
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

function Ground({
  warehouse,
  theme,
  onMove,
  onClick,
}: {
  warehouse: WarehouseMapInfo;
  theme: SceneTheme;
  onMove?: (x: number, y: number) => void;
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
        onPointerMove={(event) => {
          const cell = toCell(event);
          onMove?.(cell.x, cell.y);
          invalidate();
        }}
        onClick={(event) => {
          event.stopPropagation();
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

function SceneContents(
  props: Props & {
    theme: SceneTheme;
    hoveredId: string | null;
    setHoveredId: (id: string | null) => void;
    pickIdSet?: ReadonlySet<string>;
  },
) {
  const w = props.warehouse.mapWidth;
  const d = props.warehouse.mapDepth;
  const pickable = !props.placing && !props.translating;
  const explode = Boolean(props.explode);
  const levelFilter = props.levelFilter ?? "all";
  const selectedFootprint = useMemo(() => {
    const object = props.objects.find((row) => row.id === props.selectedObjectId);
    if (!object) return null;
    if (object.kind === "rack") return footprint(object.locations);
    return footprint([object.location]);
  }, [props.objects, props.selectedObjectId]);

  return (
    <>
      <hemisphereLight args={[props.theme.dark ? "#9aacbf" : "#f4f6f8", props.theme.dark ? "#101214" : "#7f8790", 0.82]} />
      <directionalLight position={[w * 0.18, 52, d * 0.08]} intensity={props.theme.dark ? 1.28 : 1.48} />
      <directionalLight position={[w * 0.55, 14, d + 22]} intensity={0.62} />
      <directionalLight position={[-16, 22, d * 0.45]} intensity={0.42} />
      <directionalLight position={[w + 14, 11, -10]} intensity={0.34} />
      <directionalLight position={[w * 0.5, 5.5, d * 0.55]} intensity={0.16} />
      <Ground warehouse={props.warehouse} theme={props.theme} onMove={props.onFloorMove} onClick={props.onFloorClick} />
      <DragPlane warehouse={props.warehouse} enabled={Boolean(props.translating)} onMove={props.onTranslateMove} />
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
                highlightBay={selected ? props.highlightBay : null}
                pickable={pickable}
                explode={explode}
                levelFilter={levelFilter}
                onHover={props.setHoveredId}
                onPointerDown={(event, location) => {
                  props.onSelectObject(object.id);
                  props.onSelectLocation(location);
                  if (props.mode === "build" && props.cameraMode === "top" && props.onTranslateBegin) {
                    props.onTranslateBegin(object.id, snap(event.point.x), snap(event.point.z));
                  }
                }}
              />
              <RackHitVolume
                spec={object.spec}
                explode={explode}
                pickable={pickable}
                onPointerDown={(event) => {
                  const location = nearestLocation(locs, event.point);
                  if (!location) return;
                  props.onSelectObject(object.id);
                  props.onSelectLocation(location);
                  if (props.mode === "build" && props.cameraMode === "top" && props.onTranslateBegin) {
                    props.onTranslateBegin(object.id, snap(event.point.x), snap(event.point.z));
                  }
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
        return (
          <AreaBox
            key={object.id}
            location={loc}
            theme={props.theme}
            selected={object.id === props.selectedObjectId || loc.id === props.selectedLocationId}
            hovered={props.hoveredId === loc.id}
            pick={Boolean(props.pickIdSet?.has(loc.id))}
            pickable={pickable}
            onHover={props.setHoveredId}
            onPointerDown={() => {
              props.onSelectObject(object.id);
              props.onSelectLocation(loc);
            }}
          />
        );
      })}
      {selectedFootprint && !props.ghost ? <FootprintLine box={selectedFootprint} color={props.theme.outline} /> : null}
      <PickMarkers
        locations={props.locations}
        markers={props.pickMarkers}
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
      {props.cameraMode === "top" ? (
        <Html position={[1.1, 0.2, 1.1]} center>
          <div className="rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border">N</div>
        </Html>
      ) : null}
    </>
  );
}

function CameraRig({ warehouse, cameraMode }: { warehouse: WarehouseMapInfo; cameraMode: CameraMode }) {
  const { camera, invalidate } = useThree();
  const w = warehouse.mapWidth;
  const d = warehouse.mapDepth;
  useLayoutEffect(() => {
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
  return null;
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
  const dragging = useRef(false);
  useEffect(() => {
    const sync = () => setTheme(readSceneTheme());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      props.onTranslateEnd?.();
    }
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [props.onTranslateEnd]);

  const hovered = props.locations.find((row) => row.id === hoveredId) ?? null;
  const w = props.warehouse.mapWidth;
  const d = props.warehouse.mapDepth;
  const status = props.cameraMode === "top" ? "Plan · orthographic" : "Orbit · perspective";
  const pickIdSet = useMemo(() => new Set(props.pickIds ?? []), [props.pickIds]);
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
            if (props.placing || props.translating) return;
            props.onSelectLocation(null);
            props.onSelectObject(null);
          }}
        >
          <color attach="background" args={[theme.background]} />
          {props.cameraMode === "top" ? (
            <OrthographicCamera makeDefault near={0.1} far={500} zoom={16} />
          ) : (
            <PerspectiveCamera makeDefault fov={42} near={0.1} far={500} />
          )}
          <CameraRig warehouse={props.warehouse} cameraMode={props.cameraMode} />
          <OrbitControls
            makeDefault
            target={[w / 2, 0, d / 2]}
            enableRotate={props.cameraMode === "orbit" && !props.placing && !props.translating}
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
              LEFT: props.cameraMode === "orbit" && !props.placing ? THREE.MOUSE.ROTATE : (undefined as unknown as THREE.MOUSE),
              MIDDLE: THREE.MOUSE.PAN,
              RIGHT: THREE.MOUSE.PAN,
            }}
          />
          <SceneContents
            {...props}
            theme={theme}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
            pickIdSet={pickIdSet}
            onTranslateBegin={(id, x, y) => {
              dragging.current = true;
              props.onTranslateBegin?.(id, x, y);
            }}
            onTranslateMove={(x, y) => {
              if (!dragging.current) return;
              props.onTranslateMove?.(x, y);
            }}
          />
          {props.cameraMode === "orbit" ? (
            <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
              <GizmoViewport axisColors={[theme.selected, theme.steel, theme.ghost]} labelColor={theme.dark ? "#f4f4f4" : "#222"} />
            </GizmoHelper>
          ) : null}
        </Canvas>
      </WebGLBoundary>
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/85 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur">
        {status}
        {props.cursor ? ` · ${props.cursor.x}, ${props.cursor.y}` : ""}
        {hovered ? ` · ${hovered.code}` : ""}
      </div>
      {props.ghost ? (
        <div
          className={`pointer-events-none absolute bottom-3 left-1/2 max-w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md px-3 py-1.5 text-center text-[11px] shadow-sm ring-1 backdrop-blur ${
            props.ghost.valid
              ? "bg-background/90 text-muted-foreground ring-border"
              : "bg-destructive/90 text-white ring-destructive"
          }`}
        >
          {props.ghost.valid
            ? props.ghost.kind === "rack"
              ? `Click to place ${props.ghost.spec.bays * props.ghost.spec.levels} bins · R rotates`
              : `Click to place ${props.ghost.spec.name}`
            : props.ghost.message || "That footprint overlaps another bay or leaves the warehouse."}
        </div>
      ) : null}
    </div>
  );
}
