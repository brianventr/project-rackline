import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RackSpec } from "@/domain/rack-builder";

export type Pose = {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  qx?: number;
  qy?: number;
  qz?: number;
  qw?: number;
};

/** Upright cross-section in metres (along-aisle × into-bay). */
export const COL_ALONG = 0.08;
export const COL_ACROSS = 0.09;
export const BEAM_WIDTH = 0.055;
export const BEAM_HEIGHT = 0.12;
export const BEAM_LIFT = 0.08;
export const DECK_THICK = 0.016;
export const PALLET_HEIGHT = 0.14;
export const PALLET_LIFT = BEAM_LIFT + BEAM_HEIGHT + DECK_THICK;
export const HOLE_PITCH = 0.0762;

const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

function alongX(spec: RackSpec) {
  return spec.rotation === 90 || spec.rotation === 270;
}

export function alongAcrossToWorld(spec: RackSpec, along: number, across: number) {
  if (spec.rotation === 90) return { x: spec.posX + along, z: spec.posY + across };
  if (spec.rotation === 180) return { x: spec.posX + spec.bayDepth - across, z: spec.posY - along };
  if (spec.rotation === 270) return { x: spec.posX - along, z: spec.posY + spec.bayDepth - across };
  return { x: spec.posX + across, z: spec.posY + along };
}

function worldSize(spec: RackSpec, alongSize: number, acrossSize: number) {
  return alongX(spec) ? { sx: alongSize, sz: acrossSize } : { sx: acrossSize, sz: alongSize };
}

function axisDirs(spec: RackSpec) {
  const origin = alongAcrossToWorld(spec, 0, 0);
  const along = alongAcrossToWorld(spec, 1, 0);
  const across = alongAcrossToWorld(spec, 0, 1);
  return {
    along: { x: along.x - origin.x, z: along.z - origin.z },
    across: { x: across.x - origin.x, z: across.z - origin.z },
  };
}

function inwardYaw(spec: RackSpec, rear: boolean) {
  const { across } = axisDirs(spec);
  const ix = rear ? -across.x : across.x;
  const iz = rear ? -across.z : across.z;
  return Math.atan2(ix, iz) - Math.PI / 2;
}

function faceYaw(dx: number, dz: number) {
  return Math.atan2(dx, dz);
}

function poseAt(x: number, y: number, z: number, sx: number, sy: number, sz: number): Pose {
  return { x, y, z, sx, sy, sz, qx: 0, qy: 0, qz: 0, qw: 1 };
}

function poseYaw(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number): Pose {
  _quat.setFromAxisAngle(_up, yaw);
  return { x, y, z, sx, sy, sz, qx: _quat.x, qy: _quat.y, qz: _quat.z, qw: _quat.w };
}

function poseBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number, thickness: number): Pose {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 0.001;
  _dir.set(dx, dy, dz).multiplyScalar(1 / len);
  _quat.setFromUnitVectors(_up, _dir);
  return {
    x: (ax + bx) / 2,
    y: (ay + by) / 2,
    z: (az + bz) / 2,
    sx: thickness,
    sy: len,
    sz: thickness,
    qx: _quat.x,
    qy: _quat.y,
    qz: _quat.z,
    qw: _quat.w,
  };
}

function poseAlong(ax: number, ay: number, az: number, bx: number, by: number, bz: number): Pose {
  return { ...poseBetween(ax, ay, az, bx, by, bz, 1), sx: 1, sz: 1 };
}

export function rackHeight(spec: RackSpec) {
  return spec.levels * spec.levelHeight;
}

export function levelFloorY(level: number, spec: RackSpec, explode: boolean) {
  const extra = explode ? spec.levelHeight * 0.55 : 0;
  return (level - 1) * spec.levelHeight + (level - 1) * extra;
}

export function beamCenterY(level: number, spec: RackSpec, explode: boolean) {
  return levelFloorY(level, spec, explode) + BEAM_LIFT + BEAM_HEIGHT / 2;
}

export function deckTopY(level: number, spec: RackSpec, explode: boolean) {
  return beamCenterY(level, spec, explode) + BEAM_HEIGHT / 2 + DECK_THICK;
}

function filletedPolygon(target: THREE.Shape | THREE.Path, pts: Array<[number, number]>, radius: number) {
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - 1 + n) % n]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const v1x = curr[0] - prev[0];
    const v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0];
    const v2y = next[1] - curr[1];
    const l1 = Math.hypot(v1x, v1y) || 1;
    const l2 = Math.hypot(v2x, v2y) || 1;
    const rr = Math.min(radius, l1 * 0.4, l2 * 0.4);
    const ax = curr[0] - (v1x / l1) * rr;
    const ay = curr[1] - (v1y / l1) * rr;
    const bx = curr[0] + (v2x / l2) * rr;
    const by = curr[1] + (v2y / l2) * rr;
    if (i === 0) target.moveTo(ax, ay);
    else target.lineTo(ax, ay);
    target.quadraticCurveTo(curr[0], curr[1], bx, by);
  }
  target.closePath();
}

function finish(geo: THREE.BufferGeometry) {
  geo.computeVertexNormals();
  return geo;
}

function centerGeo(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  return finish(geo);
}

function mergeParts(parts: THREE.BufferGeometry[]) {
  const prepared = parts.map((geo) => {
    const next = geo.index ? geo.toNonIndexed() : geo;
    next.computeVertexNormals();
    return next;
  });
  const merged = mergeGeometries(prepared, false);
  prepared.forEach((geo) => {
    if (!parts.includes(geo)) geo.dispose();
  });
  parts.forEach((geo) => geo.dispose());
  if (!merged) return new THREE.BoxGeometry(1, PALLET_HEIGHT, 1);
  merged.computeVertexNormals();
  return merged;
}

function makeColumnChannel() {
  const across = COL_ACROSS;
  const along = COL_ALONG;
  const t = 0.006;
  const lip = 0.014;
  const a = along / 2;
  const shape = new THREE.Shape();
  filletedPolygon(
    shape,
    [
      [0, -a],
      [across, -a],
      [across, -a + lip],
      [across - t, -a + lip],
      [across - t, -a + t],
      [t, -a + t],
      [t, a - t],
      [across - t, a - t],
      [across - t, a - lip],
      [across, a - lip],
      [across, a],
      [0, a],
    ],
    0.0028,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 6,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return centerGeo(geo);
}

function makeStepBeam() {
  const w = BEAM_WIDTH;
  const h = BEAM_HEIGHT;
  const stepW = 0.028;
  const stepH = 0.038;
  const shape = new THREE.Shape();
  filletedPolygon(
    shape,
    [
      [0, 0],
      [w, 0],
      [w, h - stepH],
      [w - stepW, h - stepH],
      [w - stepW, h],
      [0, h],
    ],
    0.0035,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 6,
    steps: 1,
  });
  return centerGeo(geo);
}

function makeBraceChannel() {
  const w = 0.036;
  const d = 0.028;
  const t = 0.0032;
  const lip = 0.008;
  const shape = new THREE.Shape();
  filletedPolygon(
    shape,
    [
      [0, 0],
      [w, 0],
      [w, lip],
      [w - t, lip],
      [w - t, t],
      [t, t],
      [t, d - t],
      [w - t, d - t],
      [w - t, d - lip],
      [w, d - lip],
      [w, d],
      [0, d],
    ],
    0.0014,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 4,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return centerGeo(geo);
}

function makeUChannel() {
  const w = 0.04;
  const d = 0.026;
  const t = 0.0026;
  const shape = new THREE.Shape();
  filletedPolygon(
    shape,
    [
      [0, d],
      [0, 0],
      [w, 0],
      [w, d],
      [w - t, d],
      [w - t, t],
      [t, t],
      [t, d],
    ],
    0.0012,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 4,
    steps: 1,
  });
  return centerGeo(geo);
}

function makeTeardrop() {
  const shape = new THREE.Shape();
  shape.absarc(0, -0.004, 0.013, Math.PI * 0.16, Math.PI * 0.84, false);
  shape.lineTo(0, 0.022);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.001,
    bevelSize: 0.0008,
    bevelSegments: 1,
    curveSegments: 14,
    steps: 1,
  });
  return centerGeo(geo);
}

function makeHex() {
  const shape = new THREE.Shape();
  const r = 0.5;
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  geo.center();
  geo.rotateX(-Math.PI / 2);
  return finish(geo);
}

function makeFootplate() {
  const shape = new THREE.Shape();
  filletedPolygon(
    shape,
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
    0.12,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 5,
    steps: 1,
  });
  geo.center();
  geo.rotateX(-Math.PI / 2);
  return finish(geo);
}

function board(sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const g = new RoundedBoxGeometry(sx, sy, sz, 1, Math.min(0.01, sy * 0.35));
  g.translate(x, y, z);
  return g;
}

function makePalletFrame() {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.39, 0, 0.39]) {
    parts.push(board(0.115, 0.026, 0.98, x, 0.118, 0));
    parts.push(board(0.115, 0.018, 0.98, x, 0.014, 0));
    for (const z of [-0.4, 0, 0.4]) {
      parts.push(board(0.115, 0.078, 0.12, x, 0.055, z));
    }
  }
  return mergeParts(parts);
}

function makePalletDeck() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i += 1) {
    parts.push(board(0.98, 0.028, 0.11, 0, 0.138, -0.45 + i * 0.15));
  }
  for (const z of [-0.42, 0, 0.42]) {
    parts.push(board(0.98, 0.02, 0.1, 0, 0.012, z));
  }
  return mergeParts(parts);
}

export const GEOS = {
  box: finish(new THREE.BoxGeometry(1, 1, 1)),
  column: makeColumnChannel(),
  beam: makeStepBeam(),
  brace: makeBraceChannel(),
  waterfall: makeUChannel(),
  teardrop: makeTeardrop(),
  footplate: makeFootplate(),
  hex: makeHex(),
  wire: finish(new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1)),
  palletFrame: makePalletFrame(),
  palletDeck: makePalletDeck(),
  carton: finish(new RoundedBoxGeometry(1, 1, 1, 4, 0.1)),
};

export const cartonGeometry = GEOS.carton;

export function loadFootprint(sizeX: number, sizeY: number) {
  return {
    sx: Math.min(1.22, Math.max(0.7, sizeX - 0.55)),
    sz: Math.min(1.02, Math.max(0.7, sizeY - 0.55)),
  };
}

export type RackParts = {
  columns: Pose[];
  footplates: Pose[];
  caps: Pose[];
  bolts: Pose[];
  braces: Pose[];
  beams: Pose[];
  connectors: Pose[];
  holes: Pose[];
  wires: Pose[];
  waterfalls: Pose[];
};

export function buildRackParts(spec: RackSpec, explode: boolean): RackParts {
  const height = rackHeight(spec);
  const post = COL_ACROSS / 2;
  const beamLen = Math.max(0.35, spec.bayPitch - COL_ALONG);
  const holeCount = Math.max(1, Math.floor((height - 0.1) / HOLE_PITCH));
  const dirs = axisDirs(spec);
  const parts: RackParts = {
    columns: [],
    footplates: [],
    caps: [],
    bolts: [],
    braces: [],
    beams: [],
    connectors: [],
    holes: [],
    wires: [],
    waterfalls: [],
  };

  for (let i = 0; i <= spec.bays; i += 1) {
    const along = i * spec.bayPitch;
    for (const rear of [false, true]) {
      const across = rear ? spec.bayDepth - post : post;
      const p = alongAcrossToWorld(spec, along, across);
      const yaw = inwardYaw(spec, rear);
      parts.columns.push(poseYaw(p.x, height / 2, p.z, 1, height, 1, yaw));
      const foot = worldSize(spec, 0.2, 0.2);
      const cap = worldSize(spec, COL_ALONG + 0.016, COL_ACROSS + 0.016);
      parts.footplates.push(poseAt(p.x, 0.014, p.z, foot.sx, 0.028, foot.sz));
      parts.caps.push(poseAt(p.x, height - 0.012, p.z, cap.sx, 0.024, cap.sz));
      for (const alongS of [-1, 1]) {
        for (const acrossS of [-1, 1]) {
          parts.bolts.push(
            poseAt(
              p.x + dirs.along.x * alongS * 0.062 + dirs.across.x * acrossS * 0.062,
              0.032,
              p.z + dirs.along.z * alongS * 0.062 + dirs.across.z * acrossS * 0.062,
              0.016,
              0.012,
              0.016,
            ),
          );
        }
      }
      for (const side of [-1, 1] as const) {
        const nx = dirs.along.x * side;
        const nz = dirs.along.z * side;
        const yawFace = faceYaw(nx, nz);
        for (let m = 0; m < holeCount; m += 1) {
          parts.holes.push(
            poseYaw(
              p.x + nx * (COL_ALONG / 2 + 0.002),
              HOLE_PITCH * (m + 0.5),
              p.z + nz * (COL_ALONG / 2 + 0.002),
              1,
              1,
              1,
              yawFace,
            ),
          );
        }
      }
    }

    const front = alongAcrossToWorld(spec, along, post);
    const rear = alongAcrossToWorld(spec, along, spec.bayDepth - post);
    const ys = height >= 3.2 ? [0.34, height * 0.5, height - 0.28] : [0.34, height - 0.28];
    for (const y of ys) {
      parts.braces.push(poseAlong(front.x, y, front.z, rear.x, y, rear.z));
    }
    for (let b = 0; b < ys.length - 1; b += 1) {
      const y0 = ys[b]!;
      const y1 = ys[b + 1]!;
      if (b % 2 === 0) parts.braces.push(poseAlong(front.x, y0, front.z, rear.x, y1, rear.z));
      else parts.braces.push(poseAlong(rear.x, y0, rear.z, front.x, y1, front.z));
    }
  }

  for (let level = 1; level <= spec.levels; level += 1) {
    const y = beamCenterY(level, spec, explode);
    const deckY = deckTopY(level, spec, explode) - 0.008;
    for (let i = 0; i < spec.bays; i += 1) {
      const alongMid = i * spec.bayPitch + spec.bayPitch / 2;
      const along0 = i * spec.bayPitch + COL_ALONG / 2 + 0.02;
      const along1 = (i + 1) * spec.bayPitch - COL_ALONG / 2 - 0.02;
      for (const rear of [false, true]) {
        const across = rear ? spec.bayDepth - post : post;
        const inset = 0.02;
        const deckAcross = rear ? across - inset : across + inset;
        const p = alongAcrossToWorld(spec, alongMid, across);
        const deck = alongAcrossToWorld(spec, alongMid, deckAcross);
        const yaw = inwardYaw(spec, rear);
        parts.beams.push(poseYaw(p.x, y, p.z, 1, 1, beamLen, yaw));
        const endA = alongAcrossToWorld(spec, along0, across);
        const endB = alongAcrossToWorld(spec, along1, across);
        const plate = worldSize(spec, 0.028, 0.072);
        parts.connectors.push(poseAt(endA.x, y, endA.z, plate.sx, BEAM_HEIGHT * 0.92, plate.sz));
        parts.connectors.push(poseAt(endB.x, y, endB.z, plate.sx, BEAM_HEIGHT * 0.92, plate.sz));
        parts.waterfalls.push(poseYaw(deck.x, deckY, deck.z, 1, 1, beamLen, yaw));
      }

      const wireAcross0 = post + BEAM_WIDTH * 0.65;
      const wireAcross1 = spec.bayDepth - post - BEAM_WIDTH * 0.65;
      const wireCount = Math.max(8, Math.round(beamLen / 0.16));
      for (let w = 0; w <= wireCount; w += 1) {
        const along = along0 + ((along1 - along0) * w) / wireCount;
        const a = alongAcrossToWorld(spec, along, wireAcross0);
        const b = alongAcrossToWorld(spec, along, wireAcross1);
        parts.wires.push(poseBetween(a.x, deckY, a.z, b.x, deckY, b.z, 0.01));
      }
      for (const t of [0.14, 0.32, 0.5, 0.68, 0.86]) {
        const across = wireAcross0 + (wireAcross1 - wireAcross0) * t;
        const a = alongAcrossToWorld(spec, along0, across);
        const b = alongAcrossToWorld(spec, along1, across);
        parts.wires.push(poseBetween(a.x, deckY - 0.005, a.z, b.x, deckY - 0.005, b.z, 0.012));
      }
    }
  }

  return parts;
}
