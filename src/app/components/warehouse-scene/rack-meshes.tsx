import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { RackSpec } from "@/domain/rack-builder";
import type { SceneTheme } from "./theme";
import { GEOS, PALLET_HEIGHT, PALLET_LIFT, buildRackParts, loadFootprint, type Pose } from "./rack-geometry";

export { cartonGeometry, PALLET_HEIGHT, PALLET_LIFT, buildRackParts, loadFootprint } from "./rack-geometry";
export type { Pose, RackParts } from "./rack-geometry";

function InstancedParts({
  poses,
  geometry,
  color,
  metalness,
  roughness,
  ghost,
}: {
  poses: Pose[];
  geometry: THREE.BufferGeometry;
  color: string;
  metalness: number;
  roughness: number;
  ghost?: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    const inst = mesh.current;
    if (!inst) return;
    poses.forEach((pose, i) => {
      dummy.position.set(pose.x, pose.y, pose.z);
      dummy.rotation.set(pose.rx ?? 0, pose.ry ?? 0, pose.rz ?? 0);
      dummy.scale.set(pose.sx, pose.sy, pose.sz);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
  }, [poses, dummy]);
  if (poses.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, poses.length]} raycast={() => undefined}>
      <meshStandardMaterial
        color={color}
        metalness={metalness}
        roughness={roughness}
        transparent={ghost}
        opacity={ghost ? 0.4 : 1}
        envMapIntensity={1.2}
      />
    </instancedMesh>
  );
}

export function RackFrames({
  spec,
  theme,
  ghost,
  explode,
}: {
  spec: RackSpec;
  theme: SceneTheme;
  ghost?: boolean;
  explode: boolean;
}) {
  const parts = useMemo(() => buildRackParts(spec, explode), [spec, explode]);
  return (
    <group>
      <InstancedParts poses={parts.columns} geometry={GEOS.column} color={theme.steel} metalness={0.88} roughness={0.22} ghost={ghost} />
      <InstancedParts poses={parts.footplates} geometry={GEOS.footplate} color={theme.steel} metalness={0.8} roughness={0.32} ghost={ghost} />
      <InstancedParts poses={parts.caps} geometry={GEOS.cap} color={theme.steel} metalness={0.84} roughness={0.28} ghost={ghost} />
      <InstancedParts poses={parts.washers} geometry={GEOS.washer} color={theme.galvanized} metalness={0.72} roughness={0.38} ghost={ghost} />
      <InstancedParts poses={parts.bolts} geometry={GEOS.hex} color={theme.punch} metalness={0.7} roughness={0.34} ghost={ghost} />
      <InstancedParts poses={parts.braces} geometry={GEOS.brace} color={theme.steel} metalness={0.82} roughness={0.28} ghost={ghost} />
      <InstancedParts poses={parts.beams} geometry={GEOS.beam} color={theme.beam} metalness={0.8} roughness={0.28} ghost={ghost} />
      <InstancedParts poses={parts.connectors} geometry={GEOS.connector} color={theme.beam} metalness={0.74} roughness={0.34} ghost={ghost} />
      <InstancedParts poses={parts.clips} geometry={GEOS.clip} color={theme.punch} metalness={0.55} roughness={0.42} ghost={ghost} />
      <InstancedParts poses={parts.deckWires} geometry={GEOS.wire} color={theme.galvanized} metalness={0.7} roughness={0.36} ghost={ghost} />
      <InstancedParts poses={parts.deckBars} geometry={GEOS.wire} color={theme.galvanized} metalness={0.62} roughness={0.4} ghost={ghost} />
      <InstancedParts poses={parts.waterfalls} geometry={GEOS.waterfall} color={theme.galvanized} metalness={0.68} roughness={0.34} ghost={ghost} />
    </group>
  );
}

export function RackPallets({
  locations,
  explode,
  theme,
  ghost,
}: {
  locations: Array<{
    posX: number;
    posY: number;
    posZ: number;
    sizeX: number;
    sizeY: number;
    sizeZ: number;
    level?: number | null;
    unitsOnHand?: number;
  }>;
  explode: boolean;
  theme: SceneTheme;
  ghost?: boolean;
}) {
  const occupied = useMemo(() => locations.filter((row) => (row.unitsOnHand ?? 0) > 0), [locations]);
  const pallets = useMemo<Pose[]>(
    () =>
      occupied.map((row) => {
        const lift = explode ? Math.max(0, ((row.level ?? 1) - 1) * Math.max(1, row.sizeZ) * 0.55) : 0;
        const pad = loadFootprint(row.sizeX, row.sizeY);
        return {
          x: row.posX + row.sizeX / 2,
          y: row.posZ + PALLET_LIFT + lift,
          z: row.posY + row.sizeY / 2,
          sx: pad.sx,
          sy: 1,
          sz: pad.sz,
        };
      }),
    [occupied, explode],
  );
  const straps = useMemo<Pose[]>(() => {
    const next: Pose[] = [];
    for (const row of occupied) {
      const lift = explode ? Math.max(0, ((row.level ?? 1) - 1) * Math.max(1, row.sizeZ) * 0.55) : 0;
      const x = row.posX + row.sizeX / 2;
      const z = row.posY + row.sizeY / 2;
      const pad = loadFootprint(row.sizeX, row.sizeY);
      const y = row.posZ + PALLET_LIFT + lift + PALLET_HEIGHT + 0.48;
      next.push({ x, y, z, sx: pad.sx * 0.92, sy: 0.035, sz: pad.sz * 0.16 });
      next.push({ x, y, z, sx: pad.sx * 0.16, sy: 0.035, sz: pad.sz * 0.92 });
    }
    return next;
  }, [occupied, explode]);
  if (ghost || pallets.length === 0) return null;
  return (
    <group>
      <InstancedParts poses={pallets} geometry={GEOS.palletFrame} color={theme.woodDark} metalness={0.04} roughness={0.84} />
      <InstancedParts poses={pallets} geometry={GEOS.palletDeck} color={theme.wood} metalness={0.03} roughness={0.78} />
      <InstancedParts poses={straps} geometry={GEOS.box} color={theme.strap} metalness={0.08} roughness={0.62} />
    </group>
  );
}
