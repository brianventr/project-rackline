import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Html, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
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
import { readSceneTheme, type SceneTheme } from "./theme";

export type CameraMode = "top" | "orbit";
export type Ghost =
  | { kind: "rack"; spec: RackSpec; valid: boolean }
  | { kind: "area"; spec: AreaSpec; valid: boolean };

type Props = {
  warehouse: WarehouseMapInfo;
  locations: MapLocation[];
  objects: FloorObject[];
  selectedLocationId?: string | null;
  selectedObjectId?: string | null;
  fromId?: string | null;
  toId?: string | null;
  mode: "view" | "build";
  cameraMode: CameraMode;
  placing?: boolean;
  ghost?: Ghost | null;
  cursor?: { x: number; y: number } | null;
  onSelectLocation: (location: MapLocation | null) => void;
  onSelectObject: (id: string | null) => void;
  onFloorMove?: (x: number, y: number) => void;
  onFloorClick?: (x: number, y: number) => void;
};

function binColor(
  location: LocationLike,
  theme: SceneTheme,
  selected: boolean,
  hovered: boolean,
  from: boolean,
  to: boolean,
) {
  if (from) return theme.from;
  if (to) return theme.to;
  if (selected) return theme.selected;
  if (hovered) return theme.hover;
  if ((location.unitsOnHand ?? 0) > 0) return theme.occupied;
  if (location.type === "receiving") return theme.areaRecv;
  if (location.type === "production") return theme.areaProd;
  if (location.type === "shipping") return theme.areaShip;
  return theme.empty;
}

function alongAcrossToWorld(spec: RackSpec, along: number, across: number) {
  if (spec.rotation === 90) return { x: spec.posX + along, z: spec.posY + across };
  if (spec.rotation === 180) return { x: spec.posX + spec.bayDepth - across, z: spec.posY - along };
  if (spec.rotation === 270) return { x: spec.posX - along, z: spec.posY + spec.bayDepth - across };
  return { x: spec.posX + across, z: spec.posY + along };
}

function RackFrames({ spec, theme, ghost }: { spec: RackSpec; theme: SceneTheme; ghost?: boolean }) {
  const height = spec.levels * spec.levelHeight;
  const uprights: Array<[number, number, number, number, number, number]> = [];
  const beams: Array<[number, number, number, number, number, number]> = [];
  const post = 0.16;
  for (let i = 0; i <= spec.bays; i += 1) {
    const along = i * spec.bayPitch;
    for (const across of [post / 2, spec.bayDepth - post / 2]) {
      const p = alongAcrossToWorld(spec, along, across);
      uprights.push([p.x, height / 2, p.z, post, height, post]);
    }
  }
  for (let level = 1; level <= spec.levels; level += 1) {
    const y = (level - 1) * spec.levelHeight + 0.12;
    for (let i = 0; i < spec.bays; i += 1) {
      const along = i * spec.bayPitch + spec.bayWidth / 2;
      for (const across of [post / 2, spec.bayDepth - post / 2]) {
        const p = alongAcrossToWorld(spec, along, across);
        const alongX = spec.rotation === 90 || spec.rotation === 270;
        beams.push(
          alongX
            ? [p.x, y, p.z, spec.bayWidth - 0.08, 0.12, post]
            : [p.x, y, p.z, post, 0.12, spec.bayWidth - 0.08],
        );
      }
    }
  }
  const opacity = ghost ? 0.35 : 1;
  return (
    <group>
      {uprights.map(([x, y, z, sx, sy, sz], i) => (
        <mesh key={`u-${i}`} position={[x, y, z]} castShadow={false}>
          <boxGeometry args={[sx, sy, sz]} />
          <meshStandardMaterial
            color={theme.steel}
            metalness={0.72}
            roughness={0.32}
            transparent={ghost}
            opacity={opacity}
          />
        </mesh>
      ))}
      {beams.map(([x, y, z, sx, sy, sz], i) => (
        <mesh key={`b-${i}`} position={[x, y, z]}>
          <boxGeometry args={[sx, sy, sz]} />
          <meshStandardMaterial
            color={theme.beam}
            metalness={0.55}
            roughness={0.4}
            transparent={ghost}
            opacity={opacity}
          />
        </mesh>
      ))}
    </group>
  );
}

function InstancedBins({
  drafts,
  locations,
  theme,
  selectedLocationId,
  hoveredId,
  fromId,
  toId,
  ghost,
  pickable,
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
  ghost?: { valid: boolean };
  pickable: boolean;
  onHover?: (id: string | null) => void;
  onPointerDown?: (event: ThreeEvent<PointerEvent>, location: MapLocation) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const rows = (locations ?? drafts ?? []) as Array<LocationLike & { id?: string }>;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    const inst = mesh.current;
    if (!inst) return;
    rows.forEach((row, i) => {
      const center = worldCenter(row);
      dummy.position.set(center.x, center.y + 0.04, center.z);
      dummy.scale.set(Math.max(0.2, row.sizeX - 0.28), Math.max(0.2, row.sizeZ - 0.28), Math.max(0.2, row.sizeY - 0.28));
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
          ),
        );
      }
      inst.setColorAt(i, color);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }, [rows, theme, selectedLocationId, hoveredId, fromId, toId, ghost, dummy, color]);

  if (rows.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, rows.length]}
      raycast={pickable ? undefined : () => undefined}
      onPointerMove={
        pickable && locations
          ? (event) => {
              event.stopPropagation();
              const index = event.instanceId ?? 0;
              const loc = locations[index];
              if (loc) onHover?.(loc.id);
            }
          : undefined
      }
      onPointerOut={pickable ? () => onHover?.(null) : undefined}
      onPointerDown={
        pickable && locations
          ? (event) => {
              event.stopPropagation();
              const loc = locations[event.instanceId ?? 0];
              if (loc) onPointerDown?.(event, loc);
            }
          : undefined
      }
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        metalness={0.08}
        roughness={0.46}
        transparent={Boolean(ghost)}
        opacity={ghost ? 0.42 : 1}
        emissive={ghost ? (ghost.valid ? theme.ghost : theme.invalid) : "#000000"}
        emissiveIntensity={ghost ? 0.15 : 0}
      />
    </instancedMesh>
  );
}

function AreaBox({
  location,
  theme,
  selected,
  hovered,
  pickable,
  ghost,
  onHover,
  onPointerDown,
}: {
  location: LocationLike & { id?: string };
  theme: SceneTheme;
  selected: boolean;
  hovered: boolean;
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
        color={binColor(location, theme, selected, hovered, false, false)}
        roughness={0.7}
        metalness={0.04}
        transparent={ghost}
        opacity={ghost ? 0.4 : 0.92}
      />
    </mesh>
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
        <meshStandardMaterial color={theme.floor} roughness={0.92} metalness={0.02} />
      </mesh>
      <gridHelper
        args={[Math.max(w, d), Math.max(w, d), theme.gridSection, theme.grid]}
        position={[w / 2, 0.015, d / 2]}
      />
      <mesh position={[w / 2, 0.45, -0.12]}>
        <boxGeometry args={[w + 0.24, 0.9, 0.24]} />
        <meshStandardMaterial color={theme.steel} metalness={0.4} roughness={0.5} />
      </mesh>
    </group>
  );
}

function SceneContents(props: Props & { theme: SceneTheme; hoveredId: string | null; setHoveredId: (id: string | null) => void }) {
  const w = props.warehouse.mapWidth;
  const d = props.warehouse.mapDepth;
  const pickable = !props.placing;

  return (
    <>
      <hemisphereLight args={[props.theme.dark ? "#6b7c93" : "#f3f6f8", props.theme.dark ? "#1a1a1a" : "#8b939c", 0.9]} />
      <directionalLight position={[w * 0.4, 48, d * 0.2]} intensity={props.theme.dark ? 1.05 : 1.25} />
      <directionalLight position={[-12, 18, d]} intensity={0.28} />
      <Ground warehouse={props.warehouse} theme={props.theme} onMove={props.onFloorMove} onClick={props.onFloorClick} />
      {props.objects.map((object) => {
        if (object.kind === "rack") {
          const locs = props.locations.filter((row) => object.locations.some((bin) => bin.id === row.id));
          const selected = object.id === props.selectedObjectId;
          return (
            <group key={object.id}>
              <RackFrames spec={object.spec} theme={props.theme} />
              <InstancedBins
                locations={locs}
                theme={props.theme}
                selectedLocationId={props.selectedLocationId}
                hoveredId={props.hoveredId}
                fromId={props.fromId}
                toId={props.toId}
                pickable={pickable}
                onHover={props.setHoveredId}
                onPointerDown={(_event, location) => {
                  props.onSelectObject(object.id);
                  props.onSelectLocation(location);
                }}
              />
                  {selected && footprint(object.locations) && (props.mode === "view" || props.mode === "build") ? (
                <Html
                  position={[
                    worldCenter(footprint(object.locations)!).x,
                    object.spec.levels * object.spec.levelHeight + 0.9,
                    worldCenter(footprint(object.locations)!).z,
                  ]}
                  center
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
            pickable={pickable}
            onHover={props.setHoveredId}
            onPointerDown={() => {
              props.onSelectObject(object.id);
              props.onSelectLocation(loc);
            }}
          />
        );
      })}
      {props.ghost?.kind === "rack" ? (
        <group>
          <RackFrames spec={props.ghost.spec} theme={props.theme} ghost />
          <InstancedBins drafts={expandRack(props.ghost.spec)} theme={props.theme} ghost={{ valid: props.ghost.valid }} pickable={false} />
        </group>
      ) : null}
      {props.ghost?.kind === "area" ? (
        <AreaBox location={expandArea(props.ghost.spec)} theme={props.theme} selected={false} hovered={false} pickable={false} ghost />
      ) : null}
    </>
  );
}

function Cameras({ warehouse, cameraMode }: { warehouse: WarehouseMapInfo; cameraMode: CameraMode }) {
  const w = warehouse.mapWidth;
  const d = warehouse.mapDepth;
  if (cameraMode === "top") {
    return <OrthographicCamera makeDefault position={[w / 2, 70, d / 2]} zoom={18} near={0.1} far={400} />;
  }
  return <PerspectiveCamera makeDefault position={[w * 0.72, 26, d * 1.12]} fov={42} near={0.1} far={400} />;
}

export function WarehouseScene(props: Props) {
  const [theme, setTheme] = useState<SceneTheme>(() => readSceneTheme());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setTheme(readSceneTheme());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const hovered = props.locations.find((row) => row.id === hoveredId) ?? null;
  const w = props.warehouse.mapWidth;
  const d = props.warehouse.mapDepth;

  return (
    <div className="relative h-[min(74vh,820px)] w-full overflow-hidden rounded-xl border bg-bay">
      <Canvas
        key={props.cameraMode}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        frameloop="always"
        onPointerMissed={() => {
          if (props.placing) return;
          props.onSelectLocation(null);
          props.onSelectObject(null);
        }}
      >
        <color attach="background" args={[theme.background]} />
        <Cameras warehouse={props.warehouse} cameraMode={props.cameraMode} />
        <OrbitControls
          makeDefault
          target={[w / 2, 0, d / 2]}
          enableRotate={props.cameraMode === "orbit"}
          enableDamping
          dampingFactor={0.12}
          minPolarAngle={props.cameraMode === "top" ? 0 : 0.18}
          maxPolarAngle={props.cameraMode === "top" ? 0 : Math.PI / 2 - 0.05}
          minZoom={8}
          maxZoom={48}
          maxDistance={90}
          minDistance={8}
        />
        <SceneContents {...props} theme={theme} hoveredId={hoveredId} setHoveredId={setHoveredId} />
        <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
          <GizmoViewport axisColors={[theme.selected, theme.steel, theme.ghost]} labelColor={theme.dark ? "#f4f4f4" : "#222"} />
        </GizmoHelper>
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/85 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur">
        {props.cameraMode === "top" ? "Top · orthographic" : "Orbit · perspective"}
        {props.cursor ? ` · ${props.cursor.x}, ${props.cursor.y}` : ""}
        {hovered ? ` · ${hovered.code}` : ""}
      </div>
    </div>
  );
}
