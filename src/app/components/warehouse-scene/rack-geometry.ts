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
export const BEAM_WIDTH = 0.05;
export const BEAM_HEIGHT = 0.12;
/** Beam centre above the floor of that level. */
export const BEAM_LIFT = 0.08;
export const DECK_THICK = 0.02;
export const PALLET_HEIGHT = 0.14;
export const PALLET_LIFT = BEAM_LIFT + BEAM_HEIGHT + DECK_THICK;

const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

function alongX(spec: RackSpec) {
  return spec.rotation === 90 || spec.rotation === 270;
}

/** Location AABB uses bayWidth along the run; uprights sit on bayPitch. */
export function alongAcrossToWorld(spec: RackSpec, along: number, across: number) {
  if (spec.rotation === 90) return { x: spec.posX + along, z: spec.posY + across };
  if (spec.rotation === 180) return { x: spec.posX + spec.bayDepth - across, z: spec.posY - along };
  if (spec.rotation === 270) return { x: spec.posX - along, z: spec.posY + spec.bayDepth - across };
  return { x: spec.posX + across, z: spec.posY + along };
}

function worldSize(spec: RackSpec, alongSize: number, acrossSize: number) {
  return alongX(spec) ? { sx: alongSize, sz: acrossSize } : { sx: acrossSize, sz: alongSize };
}

function poseAt(x: number, y: number, z: number, sx: number, sy: number, sz: number): Pose {
  return { x, y, z, sx, sy, sz, qx: 0, qy: 0, qz: 0, qw: 1 };
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

function makePalletGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(x, y, z);
    parts.push(g);
  };
  for (const x of [-0.385, 0, 0.385]) {
    box(x, 0.055, 0, 0.12, 0.09, 0.98);
  }
  for (let i = 0; i < 5; i += 1) {
    box(0, 0.118, -0.4 + i * 0.2, 0.98, 0.028, 0.14);
  }
  box(0, 0.014, -0.4, 0.98, 0.02, 0.12);
  box(0, 0.014, 0.4, 0.98, 0.02, 0.12);
  return mergeParts(parts);
}

export const GEOS = {
  box: new THREE.BoxGeometry(1, 1, 1),
  pallet: makePalletGeometry(),
  carton: new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
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
  braces: Pose[];
  beams: Pose[];
  decks: Pose[];
};

export function buildRackParts(spec: RackSpec, explode: boolean): RackParts {
  const height = rackHeight(spec);
  const post = COL_ACROSS / 2;
  const beamLen = Math.max(0.35, spec.bayPitch - COL_ALONG);
  const acrossSpan = Math.max(0.3, spec.bayDepth - COL_ACROSS - BEAM_WIDTH);
  const parts: RackParts = {
    columns: [],
    footplates: [],
    caps: [],
    braces: [],
    beams: [],
    decks: [],
  };

  for (let i = 0; i <= spec.bays; i += 1) {
    const along = i * spec.bayPitch;
    for (const across of [post, spec.bayDepth - post]) {
      const p = alongAcrossToWorld(spec, along, across);
      const col = worldSize(spec, COL_ALONG, COL_ACROSS);
      const foot = worldSize(spec, 0.2, 0.2);
      const cap = worldSize(spec, COL_ALONG + 0.02, COL_ACROSS + 0.02);
      parts.columns.push(poseAt(p.x, height / 2, p.z, col.sx, height, col.sz));
      parts.footplates.push(poseAt(p.x, 0.012, p.z, foot.sx, 0.024, foot.sz));
      parts.caps.push(poseAt(p.x, height - 0.012, p.z, cap.sx, 0.024, cap.sz));
    }

    const front = alongAcrossToWorld(spec, along, post);
    const rear = alongAcrossToWorld(spec, along, spec.bayDepth - post);
    const yLow = 0.38;
    const yHigh = Math.max(yLow + 0.4, height - 0.32);
    parts.braces.push(poseBetween(front.x, yLow, front.z, rear.x, yLow, rear.z, 0.032));
    parts.braces.push(poseBetween(front.x, yHigh, front.z, rear.x, yHigh, rear.z, 0.032));
    parts.braces.push(poseBetween(front.x, yLow, front.z, rear.x, yHigh, rear.z, 0.028));
  }

  for (let level = 1; level <= spec.levels; level += 1) {
    const y = beamCenterY(level, spec, explode);
    const deckY = y + BEAM_HEIGHT / 2 + DECK_THICK / 2;
    for (let i = 0; i < spec.bays; i += 1) {
      const alongMid = i * spec.bayPitch + spec.bayPitch / 2;
      const beam = worldSize(spec, beamLen, BEAM_WIDTH);
      for (const across of [post, spec.bayDepth - post]) {
        const p = alongAcrossToWorld(spec, alongMid, across);
        parts.beams.push(poseAt(p.x, y, p.z, beam.sx, BEAM_HEIGHT, beam.sz));
      }

      const slatCount = Math.max(4, Math.round(beamLen / 0.38));
      const slat = worldSize(spec, 0.045, acrossSpan);
      const along0 = i * spec.bayPitch + COL_ALONG / 2 + 0.03;
      const along1 = (i + 1) * spec.bayPitch - COL_ALONG / 2 - 0.03;
      for (let s = 0; s < slatCount; s += 1) {
        const along = along0 + ((along1 - along0) * (s + 0.5)) / slatCount;
        const p = alongAcrossToWorld(spec, along, spec.bayDepth / 2);
        parts.decks.push(poseAt(p.x, deckY, p.z, slat.sx, DECK_THICK, slat.sz));
      }
    }
  }

  return parts;
}
