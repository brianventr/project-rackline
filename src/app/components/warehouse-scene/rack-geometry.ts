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
  rx?: number;
  ry?: number;
  rz?: number;
};

/** 3 in teardrop centers — one punched module per hole. */
export const COLUMN_MODULE = 0.0762;

/** Beam ledge height from the bay floor of that level. */
export const BEAM_LIFT = 0.14;

/** Pallet local origin sits on the wire deck. */
export const PALLET_LIFT = 0.205;

export const PALLET_HEIGHT = 0.148;

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

function poseAlong(ax: number, ay: number, az: number, bx: number, by: number, bz: number): Pose {
  return { ...poseBetween(ax, ay, az, bx, by, bz, 1), sx: 1, sz: 1 };
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
    const rr = Math.min(radius, l1 * 0.42, l2 * 0.42);
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

function teardropHole(cx: number, cy: number) {
  const hole = new THREE.Path();
  const r = 0.0154;
  hole.absarc(cx, cy - 0.005, r, Math.PI * 0.16, Math.PI * 0.84, false);
  hole.lineTo(cx, cy + 0.026);
  hole.closePath();
  return hole;
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
  if (!merged) return new THREE.BoxGeometry(0.08, 0.08, 0.08);
  merged.computeVertexNormals();
  return merged;
}

function finish(geo: THREE.BufferGeometry) {
  geo.computeVertexNormals();
  return geo;
}

function makeColumnModule() {
  const w = 0.15;
  const d = 0.128;
  const h = COLUMN_MODULE;
  const t = 0.007;
  const parts: THREE.BufferGeometry[] = [];

  const face = new THREE.Shape();
  face.moveTo(-w / 2, -h / 2);
  face.lineTo(w / 2, -h / 2);
  face.lineTo(w / 2, h / 2);
  face.lineTo(-w / 2, h / 2);
  face.closePath();
  face.holes.push(teardropHole(0, -0.004));
  const web = new THREE.ExtrudeGeometry(face, {
    depth: t,
    bevelEnabled: true,
    bevelThickness: 0.0009,
    bevelSize: 0.0007,
    bevelSegments: 2,
    curveSegments: 20,
    steps: 1,
  });
  web.rotateY(Math.PI / 2);
  web.translate(-d / 2, 0, 0);
  parts.push(web);

  const back = new THREE.BoxGeometry(t, h, w, 1, 3, 3);
  back.translate(d / 2 - t / 2, 0, 0);
  parts.push(back);

  const left = new THREE.BoxGeometry(d, h, t, 3, 3, 1);
  left.translate(0, 0, -w / 2 + t / 2);
  parts.push(left);

  const right = new THREE.BoxGeometry(d, h, t, 3, 3, 1);
  right.translate(0, 0, w / 2 - t / 2);
  parts.push(right);

  return mergeParts(parts);
}

function makeBraceChannel() {
  const w = 0.048;
  const d = 0.036;
  const t = 0.0038;
  const lip = 0.01;
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
    0.0016,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.0008,
    bevelSize: 0.0006,
    bevelSegments: 2,
    curveSegments: 6,
    steps: 2,
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  return finish(geo);
}

function makeStepBeamGeometry() {
  const w = 0.11;
  const h = 0.175;
  const stepW = 0.048;
  const stepH = 0.052;
  const t = 0.004;
  const outer: Array<[number, number]> = [
    [0, 0],
    [w, 0],
    [w, h - stepH],
    [w - stepW, h - stepH],
    [w - stepW, h],
    [0, h],
  ];
  const inner: Array<[number, number]> = [
    [t, t],
    [t, h - t],
    [w - stepW - t, h - t],
    [w - stepW - t, h - stepH - t],
    [w - t, h - stepH - t],
    [w - t, t],
  ];
  const shape = new THREE.Shape();
  filletedPolygon(shape, outer, 0.004);
  const hole = new THREE.Path();
  filletedPolygon(hole, inner, 0.0028);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 10,
    steps: 2,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  return finish(geo);
}

function makeUChannelGeometry() {
  const w = 0.046;
  const d = 0.03;
  const t = 0.0028;
  const shape = new THREE.Shape();
  filletedPolygon(
    shape,
    [
      [0, 0],
      [w, 0],
      [w, t],
      [t, t],
      [t, d],
      [0, d],
    ],
    0.0012,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.0006,
    bevelSize: 0.0005,
    bevelSegments: 2,
    curveSegments: 5,
    steps: 2,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  return finish(geo);
}

function makeFootplateGeometry() {
  const half = 0.5;
  const r = 0.12;
  const shape = new THREE.Shape();
  filletedPolygon(
    shape,
    [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ],
    r,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.035,
    bevelSegments: 3,
    curveSegments: 6,
    steps: 1,
  });
  geo.center();
  geo.rotateX(-Math.PI / 2);
  return finish(geo);
}

function makeCapGeometry() {
  const geo = new THREE.CylinderGeometry(0.48, 0.56, 1, 8, 2, false);
  return finish(geo);
}

function makeHexGeometry() {
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
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.045,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 1,
  });
  geo.center();
  geo.rotateX(-Math.PI / 2);
  return finish(geo);
}

function makeClipGeometry() {
  const stem = new THREE.BoxGeometry(0.012, 0.055, 0.02, 1, 2, 1);
  stem.translate(0, 0.008, 0);
  const hook = new THREE.BoxGeometry(0.034, 0.01, 0.02, 2, 1, 1);
  hook.translate(0.011, -0.024, 0);
  const pin = new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 10);
  pin.rotateZ(Math.PI / 2);
  pin.translate(0.028, -0.018, 0);
  return mergeParts([stem, hook, pin]);
}

function makeConnectorGeometry() {
  const plate = new THREE.BoxGeometry(0.02, 0.16, 0.086, 1, 3, 2);
  const parts: THREE.BufferGeometry[] = [plate];
  for (const y of [-0.05, 0, 0.05]) {
    const stud = new THREE.CylinderGeometry(0.0072, 0.0078, 0.03, 12);
    stud.rotateZ(Math.PI / 2);
    stud.translate(0.024, y, 0);
    parts.push(stud);
    const collar = new THREE.CylinderGeometry(0.011, 0.011, 0.006, 12);
    collar.rotateZ(Math.PI / 2);
    collar.translate(0.01, y, 0);
    parts.push(collar);
  }
  return mergeParts(parts);
}

function roundedBoard(sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const radius = Math.min(0.011, sy * 0.38, sx * 0.08, sz * 0.08);
  const g = new RoundedBoxGeometry(sx, sy, sz, 2, radius);
  g.translate(x, y, z);
  return g;
}

function makePalletFrameGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.385, 0, 0.385]) {
    parts.push(roundedBoard(0.118, 0.026, 0.98, x, 0.118, 0));
    parts.push(roundedBoard(0.118, 0.018, 0.98, x, 0.014, 0));
    for (const z of [-0.39, 0, 0.39]) {
      parts.push(roundedBoard(0.118, 0.078, 0.13, x, 0.055, z));
    }
  }
  return mergeParts(parts);
}

function makePalletDeckGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i += 1) {
    const z = -0.455 + i * 0.152;
    parts.push(roundedBoard(0.98, 0.03, 0.112, 0, 0.138, z));
  }
  for (const z of [-0.42, 0, 0.42]) {
    parts.push(roundedBoard(0.98, 0.022, 0.1, 0, 0.012, z));
  }
  return mergeParts(parts);
}

export const GEOS = {
  column: makeColumnModule(),
  brace: makeBraceChannel(),
  beam: makeStepBeamGeometry(),
  waterfall: makeUChannelGeometry(),
  footplate: makeFootplateGeometry(),
  cap: makeCapGeometry(),
  hex: makeHexGeometry(),
  washer: finish(new THREE.CylinderGeometry(0.5, 0.5, 1, 18)),
  clip: makeClipGeometry(),
  connector: makeConnectorGeometry(),
  palletFrame: makePalletFrameGeometry(),
  palletDeck: makePalletDeckGeometry(),
  box: finish(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2)),
  wire: finish(new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1)),
  carton: finish(new RoundedBoxGeometry(1, 1, 1, 8, 0.1)),
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
  washers: Pose[];
  bolts: Pose[];
  caps: Pose[];
  braces: Pose[];
  beams: Pose[];
  connectors: Pose[];
  clips: Pose[];
  deckWires: Pose[];
  deckBars: Pose[];
  waterfalls: Pose[];
};

export function columnModuleCount(height: number) {
  return Math.max(1, Math.floor(height / COLUMN_MODULE));
}

export function buildRackParts(spec: RackSpec, explode: boolean): RackParts {
  const extra = explode ? spec.levelHeight * 0.55 : 0;
  const height = spec.levels * spec.levelHeight + (spec.levels - 1) * extra;
  const alongX = spec.rotation === 90 || spec.rotation === 270;
  const beamYaw = alongX ? Math.PI / 2 : 0;
  const post = 0.14;
  const yaw = yawForAlong(spec);
  const modules = columnModuleCount(height);
  const parts: RackParts = {
    columns: [],
    footplates: [],
    washers: [],
    bolts: [],
    caps: [],
    braces: [],
    beams: [],
    connectors: [],
    clips: [],
    deckWires: [],
    deckBars: [],
    waterfalls: [],
  };

  for (let i = 0; i <= spec.bays; i += 1) {
    const along = i * spec.bayPitch;
    for (const [across, rear] of [
      [post, false],
      [spec.bayDepth - post, true],
    ] as const) {
      const p = alongAcrossToWorld(spec, along, across);
      const channelYaw = yaw + (rear ? Math.PI : 0);
      for (let m = 0; m < modules; m += 1) {
        parts.columns.push({
          x: p.x,
          y: COLUMN_MODULE * (m + 0.5),
          z: p.z,
          sx: 1,
          sy: 1,
          sz: 1,
          ry: channelYaw,
        });
      }
      parts.footplates.push({ x: p.x, y: 0.02, z: p.z, sx: 0.46, sy: 0.04, sz: 0.46, ry: channelYaw });
      parts.caps.push({ x: p.x, y: height - 0.018, z: p.z, sx: 0.28, sy: 0.036, sz: 0.28, ry: channelYaw });
      const boltSpread = 0.115;
      for (const dx of [-boltSpread, boltSpread]) {
        for (const dz of [-boltSpread, boltSpread]) {
          parts.washers.push({ x: p.x + dx, y: 0.04, z: p.z + dz, sx: 0.038, sy: 0.006, sz: 0.038 });
          parts.bolts.push({ x: p.x + dx, y: 0.052, z: p.z + dz, sx: 0.022, sy: 0.016, sz: 0.022 });
        }
      }
    }
  }

  for (let i = 0; i <= spec.bays; i += 1) {
    const along = i * spec.bayPitch;
    const front = alongAcrossToWorld(spec, along, post);
    const rear = alongAcrossToWorld(spec, along, spec.bayDepth - post);
    const braceCount = Math.max(3, Math.round(height / 2.15));
    const y0 = 0.34;
    const y1 = height - 0.26;
    for (let b = 0; b < braceCount; b += 1) {
      const y = y0 + ((y1 - y0) * b) / Math.max(1, braceCount - 1);
      parts.braces.push(poseAlong(front.x, y, front.z, rear.x, y, rear.z));
    }
    for (let b = 0; b < braceCount - 1; b += 1) {
      const ya = y0 + ((y1 - y0) * b) / Math.max(1, braceCount - 1);
      const yb = y0 + ((y1 - y0) * (b + 1)) / Math.max(1, braceCount - 1);
      if (b % 2 === 0) {
        parts.braces.push(poseAlong(front.x, ya, front.z, rear.x, yb, rear.z));
      } else {
        parts.braces.push(poseAlong(rear.x, ya, rear.z, front.x, yb, front.z));
      }
    }
  }

  for (let level = 1; level <= spec.levels; level += 1) {
    const y = (level - 1) * spec.levelHeight + extra * (level - 1) + BEAM_LIFT;
    for (let i = 0; i < spec.bays; i += 1) {
      const along = i * spec.bayPitch + spec.bayWidth / 2;
      const beamLen = Math.max(0.45, spec.bayWidth - 0.08);
      for (const [across, rear] of [
        [post, false],
        [spec.bayDepth - post, true],
      ] as const) {
        const p = alongAcrossToWorld(spec, along, across);
        const faceYaw = beamYaw + (rear ? Math.PI : 0);
        parts.beams.push({
          x: p.x,
          y,
          z: p.z,
          sx: 1,
          sy: 1,
          sz: beamLen,
          ry: faceYaw,
        });
        const ends = [
          { p: alongAcrossToWorld(spec, i * spec.bayPitch + 0.04, across), towardStart: true },
          { p: alongAcrossToWorld(spec, i * spec.bayPitch + spec.bayWidth - 0.04, across), towardStart: false },
        ];
        for (const end of ends) {
          const connectorYaw = yaw + (end.towardStart ? Math.PI / 2 : -Math.PI / 2);
          parts.connectors.push({
            x: end.p.x,
            y,
            z: end.p.z,
            sx: 1,
            sy: 1,
            sz: 1,
            ry: connectorYaw,
          });
          parts.clips.push({
            x: end.p.x,
            y: y - 0.09,
            z: end.p.z,
            sx: 1,
            sy: 1,
            sz: 1,
            ry: connectorYaw,
          });
        }
      }

      const deckY = y + 0.062;
      const along0 = i * spec.bayPitch + 0.07;
      const along1 = i * spec.bayPitch + spec.bayWidth - 0.07;
      const across0 = post + 0.055;
      const across1 = spec.bayDepth - post - 0.055;
      const wireCount = Math.max(10, Math.round((spec.bayDepth - 0.28) / 0.1));
      for (let w = 0; w <= wireCount; w += 1) {
        const across = across0 + ((across1 - across0) * w) / wireCount;
        const a = alongAcrossToWorld(spec, along0, across);
        const b = alongAcrossToWorld(spec, along1, across);
        parts.deckWires.push(poseBetween(a.x, deckY, a.z, b.x, deckY, b.z, 0.014));
      }
      const barCount = Math.max(6, Math.round((spec.bayWidth - 0.18) / 0.18));
      for (let b = 0; b < barCount; b += 1) {
        const alongBar = along0 + ((along1 - along0) * (b + 0.5)) / barCount;
        const a = alongAcrossToWorld(spec, alongBar, across0);
        const c = alongAcrossToWorld(spec, alongBar, across1);
        parts.deckBars.push(poseBetween(a.x, deckY - 0.01, a.z, c.x, deckY - 0.01, c.z, 0.014));
      }
      for (const [across, rear] of [
        [across0, false],
        [across1, true],
      ] as const) {
        const p = alongAcrossToWorld(spec, along, across);
        parts.waterfalls.push({
          x: p.x,
          y: deckY + 0.004,
          z: p.z,
          sx: 1,
          sy: 1,
          sz: Math.max(0.4, spec.bayWidth - 0.14),
          ry: beamYaw + (rear ? Math.PI : 0),
        });
      }
    }
  }

  return parts;
}
