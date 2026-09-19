import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RackSpec } from "@/domain/rack-builder";
import type { SceneTheme } from "./theme";

export type Pose = {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rx?: number;
  ry?: number;
  rz?: number;
};

const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

function poseBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number, thickness: number): Pose {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 0.001;
  _dir.set(dx, dy, dz).multiplyScalar(1 / len);
  _quat.setFromUnitVectors(_up, _dir);
  _euler.setFromQuaternion(_quat);
  return {
    x: (ax + bx) / 2,
    y: (ay + by) / 2,
    z: (az + bz) / 2,
    sx: thickness,
    sy: len,
    sz: thickness,
    rx: _euler.x,
    ry: _euler.y,
    rz: _euler.z,
  };
}

function alongAcrossToWorld(spec: RackSpec, along: number, across: number) {
  if (spec.rotation === 90) return { x: spec.posX + along, z: spec.posY + across };
  if (spec.rotation === 180) return { x: spec.posX + spec.bayDepth - across, z: spec.posY - along };
  if (spec.rotation === 270) return { x: spec.posX - along, z: spec.posY + spec.bayDepth - across };
  return { x: spec.posX + across, z: spec.posY + along };
}

function yawForAlong(spec: RackSpec) {
  if (spec.rotation === 90) return Math.PI / 2;
  if (spec.rotation === 180) return Math.PI;
  if (spec.rotation === 270) return -Math.PI / 2;
  return 0;
}

function makeChannelGeometry() {
  const w = 0.17;
  const d = 0.15;
  const t = 0.028;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(w, 0);
  shape.lineTo(w, t);
  shape.lineTo(t, t);
  shape.lineTo(t, d - t);
  shape.lineTo(w, d - t);
  shape.lineTo(w, d);
  shape.lineTo(0, d);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.0025,
    bevelSegments: 2,
    steps: 12,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  geo.computeVertexNormals();
  return geo;
}

function makeStepBeamGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.03, 0);
  shape.lineTo(0.03, 0.095);
  shape.lineTo(0.082, 0.095);
  shape.lineTo(0.082, 0.132);
  shape.lineTo(0, 0.132);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.003,
    bevelSegments: 2,
    steps: 10,
    curveSegments: 1,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  geo.computeVertexNormals();
  return geo;
}

function makeTeardropGeometry() {
  const shape = new THREE.Shape();
  shape.absarc(0, -0.01, 0.015, Math.PI * 0.15, Math.PI * 0.85, false);
  shape.lineTo(0, 0.03);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.0015,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 10,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

function makePalletGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const pushBox = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz, 1, 1, 1);
    g.translate(x, y, z);
    parts.push(g);
  };
  for (const x of [-0.39, 0, 0.39]) {
    pushBox(x, 0.05, 0, 0.1, 0.1, 0.98);
  }
  for (let i = 0; i < 7; i += 1) {
    const z = -0.45 + i * 0.15;
    pushBox(0, 0.118, z, 0.98, 0.036, 0.118);
  }
  for (const z of [-0.44, 0, 0.44]) {
    pushBox(0, 0.012, z, 0.98, 0.024, 0.11);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) return new THREE.BoxGeometry(1, 0.14, 1);
  merged.computeVertexNormals();
  return merged;
}

const GEOS = {
  channel: makeChannelGeometry(),
  beam: makeStepBeamGeometry(),
  teardrop: makeTeardropGeometry(),
  pallet: makePalletGeometry(),
  box: new THREE.BoxGeometry(1, 1, 1, 2, 2, 2),
  bolt: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  wire: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  rounded: new RoundedBoxGeometry(1, 1, 1, 4, 0.08),
};

export type RackParts = {
  channels: Pose[];
  footplates: Pose[];
  bolts: Pose[];
  caps: Pose[];
  braces: Pose[];
  beams: Pose[];
  connectors: Pose[];
  pins: Pose[];
  holes: Pose[];
  deckWires: Pose[];
  deckBars: Pose[];
};

export function buildRackParts(spec: RackSpec, explode: boolean, holes: boolean): RackParts {
  const extra = explode ? spec.levelHeight * 0.55 : 0;
  const height = spec.levels * spec.levelHeight + (spec.levels - 1) * extra;
  const alongX = spec.rotation === 90 || spec.rotation === 270;
  const beamYaw = alongX ? Math.PI / 2 : 0;
  const post = 0.085;
  const yaw = yawForAlong(spec);
  const parts: RackParts = {
    channels: [],
    footplates: [],
    bolts: [],
    caps: [],
    braces: [],
    beams: [],
    connectors: [],
    pins: [],
    holes: [],
    deckWires: [],
    deckBars: [],
  };

  for (let i = 0; i <= spec.bays; i += 1) {
    const along = i * spec.bayPitch;
    for (const [across, rear] of [
      [post, false],
      [spec.bayDepth - post, true],
    ] as const) {
      const p = alongAcrossToWorld(spec, along, across);
      const channelYaw = yaw + (rear ? Math.PI : 0);
      parts.channels.push({
        x: p.x,
        y: height / 2,
        z: p.z,
        sx: 1,
        sy: height,
        sz: 1,
        ry: channelYaw,
      });
      parts.footplates.push({ x: p.x, y: 0.025, z: p.z, sx: 0.34, sy: 0.05, sz: 0.34, ry: channelYaw });
      parts.caps.push({ x: p.x, y: height - 0.02, z: p.z, sx: 0.22, sy: 0.04, sz: 0.2, ry: channelYaw });
      const boltSpread = 0.11;
      for (const dx of [-boltSpread, boltSpread]) {
        for (const dz of [-boltSpread, boltSpread]) {
          parts.bolts.push({ x: p.x + dx, y: 0.055, z: p.z + dz, sx: 0.028, sy: 0.03, sz: 0.028 });
        }
      }
      if (holes) {
        const holeStep = 0.152;
        for (let y = 0.22; y < height - 0.18; y += holeStep) {
          const outward = alongAcrossToWorld(spec, along, across + (rear ? 0.072 : -0.072));
          parts.holes.push({
            x: outward.x,
            y,
            z: outward.z,
            sx: 1,
            sy: 1,
            sz: 1,
            ry: channelYaw,
            rz: Math.PI / 2,
          });
        }
      }
    }
  }

  for (let i = 0; i <= spec.bays; i += 1) {
    const along = i * spec.bayPitch;
    const front = alongAcrossToWorld(spec, along, post);
    const rear = alongAcrossToWorld(spec, along, spec.bayDepth - post);
    const braceY = [0.38, height * 0.36, height * 0.68, height - 0.28];
    for (const y of braceY) {
      parts.braces.push(poseBetween(front.x, y, front.z, rear.x, y, rear.z, 0.038));
    }
    parts.braces.push(poseBetween(front.x, 0.38, front.z, rear.x, height * 0.52, rear.z, 0.032));
    parts.braces.push(poseBetween(rear.x, height * 0.52, rear.z, front.x, height - 0.32, front.z, 0.032));
  }

  for (let level = 1; level <= spec.levels; level += 1) {
    const y = (level - 1) * spec.levelHeight + extra * (level - 1) + 0.14;
    for (let i = 0; i < spec.bays; i += 1) {
      const along = i * spec.bayPitch + spec.bayWidth / 2;
      const beamLen = Math.max(0.4, spec.bayWidth - 0.1);
      for (const across of [post, spec.bayDepth - post]) {
        const p = alongAcrossToWorld(spec, along, across);
        parts.beams.push({
          x: p.x,
          y,
          z: p.z,
          sx: 1,
          sy: 1,
          sz: beamLen,
          ry: beamYaw,
        });
        const endA = alongAcrossToWorld(spec, i * spec.bayPitch + 0.05, across);
        const endB = alongAcrossToWorld(spec, i * spec.bayPitch + spec.bayWidth - 0.05, across);
        parts.connectors.push({ x: endA.x, y, z: endA.z, sx: 0.07, sy: 0.1, sz: 0.07 });
        parts.connectors.push({ x: endB.x, y, z: endB.z, sx: 0.07, sy: 0.1, sz: 0.07 });
        parts.pins.push({ x: endA.x, y: y + 0.08, z: endA.z, sx: 0.03, sy: 0.07, sz: 0.03 });
        parts.pins.push({ x: endB.x, y: y + 0.08, z: endB.z, sx: 0.03, sy: 0.07, sz: 0.03 });
      }

      const deckY = y + 0.055;
      const along0 = i * spec.bayPitch + 0.08;
      const along1 = i * spec.bayPitch + spec.bayWidth - 0.08;
      const across0 = post + 0.05;
      const across1 = spec.bayDepth - post - 0.05;
      const wireCount = Math.max(7, Math.round((spec.bayDepth - 0.3) / 0.16));
      for (let w = 0; w <= wireCount; w += 1) {
        const across = across0 + ((across1 - across0) * w) / wireCount;
        const a = alongAcrossToWorld(spec, along0, across);
        const b = alongAcrossToWorld(spec, along1, across);
        parts.deckWires.push(poseBetween(a.x, deckY, a.z, b.x, deckY, b.z, 0.018));
      }
      const barCount = 3;
      for (let b = 0; b < barCount; b += 1) {
        const alongBar = along0 + ((along1 - along0) * (b + 0.5)) / barCount;
        const a = alongAcrossToWorld(spec, alongBar, across0);
        const c = alongAcrossToWorld(spec, alongBar, across1);
        parts.deckBars.push(poseBetween(a.x, deckY - 0.012, a.z, c.x, deckY - 0.012, c.z, 0.028));
      }
    }
  }

  return parts;
}

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
        envMapIntensity={1.15}
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
  const parts = useMemo(() => buildRackParts(spec, explode, !ghost), [spec, explode, ghost]);
  return (
    <group>
      <InstancedParts poses={parts.channels} geometry={GEOS.channel} color={theme.steel} metalness={0.86} roughness={0.26} ghost={ghost} />
      <InstancedParts poses={parts.footplates} geometry={GEOS.box} color={theme.steel} metalness={0.8} roughness={0.34} ghost={ghost} />
      <InstancedParts poses={parts.caps} geometry={GEOS.box} color={theme.steel} metalness={0.82} roughness={0.3} ghost={ghost} />
      <InstancedParts poses={parts.bolts} geometry={GEOS.bolt} color={theme.punch} metalness={0.7} roughness={0.35} ghost={ghost} />
      <InstancedParts poses={parts.braces} geometry={GEOS.box} color={theme.steel} metalness={0.78} roughness={0.32} ghost={ghost} />
      <InstancedParts poses={parts.beams} geometry={GEOS.beam} color={theme.beam} metalness={0.8} roughness={0.3} ghost={ghost} />
      <InstancedParts poses={parts.connectors} geometry={GEOS.box} color={theme.beam} metalness={0.72} roughness={0.36} ghost={ghost} />
      <InstancedParts poses={parts.pins} geometry={GEOS.bolt} color={theme.punch} metalness={0.55} roughness={0.4} ghost={ghost} />
      {!ghost ? <InstancedParts poses={parts.holes} geometry={GEOS.teardrop} color={theme.punch} metalness={0.4} roughness={0.55} /> : null}
      <InstancedParts poses={parts.deckWires} geometry={GEOS.wire} color={theme.galvanized} metalness={0.7} roughness={0.38} ghost={ghost} />
      <InstancedParts poses={parts.deckBars} geometry={GEOS.box} color={theme.galvanized} metalness={0.62} roughness={0.42} ghost={ghost} />
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
        return {
          x: row.posX + row.sizeX / 2,
          y: row.posZ + 0.13 + lift,
          z: row.posY + row.sizeY / 2,
          sx: Math.max(0.5, row.sizeX - 0.42),
          sy: 1,
          sz: Math.max(0.5, row.sizeY - 0.42),
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
      const y = row.posZ + 0.13 + lift + 0.55 * Math.max(0.3, row.sizeZ - 0.4);
      const sx = Math.max(0.4, row.sizeX - 0.5);
      const sz = Math.max(0.4, row.sizeY - 0.5);
      next.push({ x, y, z, sx: sx + 0.02, sy: 0.045, sz: sz * 0.18 });
      next.push({ x, y, z, sx: sx * 0.18, sy: 0.045, sz: sz + 0.02 });
    }
    return next;
  }, [occupied, explode]);
  if (ghost || pallets.length === 0) return null;
  return (
    <group>
      <InstancedParts poses={pallets} geometry={GEOS.pallet} color={theme.wood} metalness={0.04} roughness={0.78} />
      <InstancedParts poses={straps} geometry={GEOS.box} color={theme.strap} metalness={0.08} roughness={0.62} />
    </group>
  );
}

export const cartonGeometry = GEOS.rounded;
