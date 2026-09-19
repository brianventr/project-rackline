import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { RackSpec } from "@/domain/rack-builder";
import type { SceneTheme } from "./theme";
import { GEOS, PALLET_LIFT, buildRackParts, loadFootprint, type Pose } from "./rack-geometry";

export { cartonGeometry, PALLET_HEIGHT, PALLET_LIFT, buildRackParts, loadFootprint } from "./rack-geometry";
export type { Pose, RackParts } from "./rack-geometry";

function InstancedParts({
  poses,
  geometry,
  color,
  metalness,
  roughness,
  ghost,
  polygonOffset,
  envMapIntensity = 1.15,
}: {
  poses: Pose[];
  geometry: THREE.BufferGeometry;
  color: string;
  metalness: number;
  roughness: number;
  ghost?: boolean;
  polygonOffset?: boolean;
  envMapIntensity?: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    const inst = mesh.current;
    if (!inst) return;
    poses.forEach((pose, i) => {
      dummy.position.set(pose.x, pose.y, pose.z);
      dummy.quaternion.set(pose.qx ?? 0, pose.qy ?? 0, pose.qz ?? 0, pose.qw ?? 1);
      dummy.scale.set(pose.sx, pose.sy, pose.sz);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
  }, [poses, dummy]);
  if (poses.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, poses.length]} frustumCulled={false} raycast={() => undefined}>
      <meshStandardMaterial
        color={color}
        metalness={metalness}
        roughness={roughness}
        transparent={ghost}
        opacity={ghost ? 0.4 : 1}
        envMapIntensity={envMapIntensity}
        polygonOffset={polygonOffset}
        polygonOffsetFactor={polygonOffset ? -2 : 0}
        polygonOffsetUnits={polygonOffset ? -2 : 0}
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
      <InstancedParts poses={parts.columns} geometry={GEOS.column} color={theme.steel} metalness={0.84} roughness={0.26} ghost={ghost} />
      <InstancedParts poses={parts.footplates} geometry={GEOS.footplate} color={theme.steel} metalness={0.76} roughness={0.34} ghost={ghost} />
      <InstancedParts poses={parts.caps} geometry={GEOS.box} color={theme.steel} metalness={0.82} roughness={0.28} ghost={ghost} />
      <InstancedParts poses={parts.braces} geometry={GEOS.brace} color={theme.steel} metalness={0.8} roughness={0.3} ghost={ghost} />
      <InstancedParts poses={parts.beams} geometry={GEOS.beam} color={theme.beam} metalness={0.74} roughness={0.3} ghost={ghost} />
      <InstancedParts poses={parts.connectors} geometry={GEOS.box} color={theme.steel} metalness={0.7} roughness={0.36} ghost={ghost} />
      <InstancedParts poses={parts.decks} geometry={GEOS.box} color={theme.galvanized} metalness={0.58} roughness={0.4} ghost={ghost} />
      <InstancedParts poses={parts.waterfalls} geometry={GEOS.waterfall} color={theme.galvanized} metalness={0.62} roughness={0.38} ghost={ghost} />
      {ghost ? null : (
        <>
          <InstancedParts poses={parts.bolts} geometry={GEOS.hex} color={theme.punch} metalness={0.88} roughness={0.22} />
          <InstancedParts
            poses={parts.holes}
            geometry={GEOS.teardrop}
            color={theme.punch}
            metalness={0.18}
            roughness={0.52}
            polygonOffset
            envMapIntensity={0.4}
          />
          <InstancedParts poses={parts.wires} geometry={GEOS.wire} color={theme.galvanized} metalness={0.86} roughness={0.22} />
        </>
      )}
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
          qx: 0,
          qy: 0,
          qz: 0,
          qw: 1,
        };
      }),
    [occupied, explode],
  );
  if (ghost || pallets.length === 0) return null;
  return (
    <group>
      <InstancedParts poses={pallets} geometry={GEOS.palletFrame} color={theme.woodDark} metalness={0.04} roughness={0.86} envMapIntensity={0.2} />
      <InstancedParts poses={pallets} geometry={GEOS.palletDeck} color={theme.wood} metalness={0.03} roughness={0.78} envMapIntensity={0.2} />
    </group>
  );
}
