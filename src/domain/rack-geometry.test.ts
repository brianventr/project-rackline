import { describe, expect, it } from "vitest";
import { defaultRackSpec } from "./rack-builder";
import {
  BEAM_HEIGHT,
  COL_ACROSS,
  COL_ALONG,
  HOLE_PITCH,
  PALLET_LIFT,
  beamCenterY,
  buildRackParts,
  loadFootprint,
  rackHeight,
} from "../app/components/warehouse-scene/rack-geometry";

const northSouth = () =>
  defaultRackSpec({
    posX: 2,
    posY: 7,
    rotation: 0,
    bays: 3,
    levels: 2,
    bayWidth: 3,
    bayDepth: 4,
    bayPitch: 4,
    levelHeight: 2,
  });

function yawY(pose: { qx?: number; qy?: number; qz?: number; qw?: number }) {
  const x = pose.qx ?? 0;
  const y = pose.qy ?? 0;
  const z = pose.qz ?? 0;
  const w = pose.qw ?? 1;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

describe("rack geometry", () => {
  it("places one upright on each bay-pitch station, not stacked hole modules", () => {
    const spec = northSouth();
    const parts = buildRackParts(spec, false);
    expect(parts.columns).toHaveLength((spec.bays + 1) * 2);
    expect(parts.columns[0]!.sy).toBe(rackHeight(spec));
    const zs = [...new Set(parts.columns.map((c) => c.z))].sort((a, b) => a - b);
    expect(zs).toEqual([7, 11, 15, 19]);
    const xs = [...new Set(parts.columns.map((c) => Number(c.x.toFixed(4))))].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(2 + COL_ACROSS / 2, 4);
    expect(xs[1]).toBeCloseTo(2 + spec.bayDepth - COL_ACROSS / 2, 4);
  });

  it("spans load beams from upright to upright on the bay pitch", () => {
    const spec = northSouth();
    const parts = buildRackParts(spec, false);
    expect(parts.beams).toHaveLength(spec.bays * spec.levels * 2);
    const beam = parts.beams[0]!;
    expect(beam.sz).toBeCloseTo(spec.bayPitch - COL_ALONG, 4);
    expect(beam.sx).toBe(1);
    expect(beam.sy).toBe(1);
    expect(beam.z).toBeCloseTo(7 + spec.bayPitch / 2, 4);
    expect(beam.y).toBeCloseTo(beamCenterY(1, spec, false), 4);
  });

  it("turns C-channel openings and beam steps into the bay", () => {
    const spec = northSouth();
    const parts = buildRackParts(spec, false);
    const front = parts.columns.find((c) => Math.abs(c.x - (2 + COL_ACROSS / 2)) < 1e-6)!;
    const rear = parts.columns.find((c) => Math.abs(c.x - (2 + spec.bayDepth - COL_ACROSS / 2)) < 1e-6)!;
    expect(yawY(front)).toBeCloseTo(0, 5);
    expect(Math.abs(yawY(rear))).toBeCloseTo(Math.PI, 5);
    const frontBeam = parts.beams.find((b) => Math.abs(b.x - (2 + COL_ACROSS / 2)) < 1e-6)!;
    expect(yawY(frontBeam)).toBeCloseTo(0, 5);
  });

  it("keeps uprights and punches fixed when levels explode and only lifts beams", () => {
    const spec = defaultRackSpec({ bays: 2, levels: 4, bayPitch: 4, levelHeight: 2 });
    const solid = buildRackParts(spec, false);
    const exploded = buildRackParts(spec, true);
    expect(exploded.columns).toHaveLength(solid.columns.length);
    expect(exploded.columns[0]!.sy).toBe(solid.columns[0]!.sy);
    expect(exploded.beams).toHaveLength(solid.beams.length);
    expect(exploded.holes).toHaveLength(solid.holes.length);
    expect(exploded.decks).toHaveLength(solid.decks.length);
    expect(exploded.waterfalls).toHaveLength(solid.waterfalls.length);
    expect(Math.max(...exploded.beams.map((b) => b.y))).toBeGreaterThan(Math.max(...solid.beams.map((b) => b.y)));
    expect(exploded.beams[0]!.y).toBeCloseTo(solid.beams[0]!.y, 4);
    expect(exploded.holes[0]!.y).toBeCloseTo(solid.holes[0]!.y, 4);
  });

  it("punches teardrops on both along-faces of each upright", () => {
    const spec = northSouth();
    const parts = buildRackParts(spec, false);
    const holeCount = Math.max(1, Math.floor((rackHeight(spec) - 0.1) / (HOLE_PITCH * 2)));
    expect(parts.holes).toHaveLength(parts.columns.length * 2 * holeCount);
    expect(parts.wires.length).toBeGreaterThan(0);
    expect(parts.decks).toHaveLength(spec.bays * spec.levels);
    expect(parts.waterfalls).toHaveLength(parts.beams.length);
  });

  it("orients a 90° run so pitch is along X", () => {
    const spec = defaultRackSpec({
      posX: 5,
      posY: 5,
      rotation: 90,
      bays: 2,
      levels: 1,
      bayWidth: 3,
      bayDepth: 4,
      bayPitch: 3,
    });
    const parts = buildRackParts(spec, false);
    const xs = [...new Set(parts.columns.map((c) => c.x))].sort((a, b) => a - b);
    expect(xs).toEqual([5, 8, 11]);
    const beam = parts.beams[0]!;
    expect(beam.sz).toBeCloseTo(spec.bayPitch - COL_ALONG, 4);
    expect(beam.sx).toBe(1);
    expect(beam.x).toBeCloseTo(5 + spec.bayPitch / 2, 4);
    expect(Math.abs(yawY(beam))).toBeCloseTo(Math.PI / 2, 5);
  });

  it("sizes pallet loads inside the bay instead of filling it", () => {
    const pad = loadFootprint(4, 3);
    expect(pad.sx).toBeCloseTo(1.22);
    expect(pad.sz).toBeCloseTo(1.02);
    expect(PALLET_LIFT).toBeGreaterThan(BEAM_HEIGHT);
  });
});
