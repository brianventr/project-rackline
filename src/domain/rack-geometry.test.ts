import { describe, expect, it } from "vitest";
import { defaultRackSpec } from "./rack-builder";
import { buildRackParts, COLUMN_MODULE, columnModuleCount } from "../app/components/warehouse-scene/rack-geometry";

describe("rack geometry", () => {
  it("stacks a punched column module on every upright", () => {
    const spec = defaultRackSpec({
      bays: 3,
      levels: 2,
      bayWidth: 3,
      bayDepth: 4,
      bayPitch: 4,
      levelHeight: 2,
    });
    const parts = buildRackParts(spec, false);
    const posts = (spec.bays + 1) * 2;
    const height = spec.levels * spec.levelHeight;
    expect(parts.columns).toHaveLength(posts * columnModuleCount(height));
    expect(columnModuleCount(height)).toBe(Math.floor(height / COLUMN_MODULE));
    expect(parts.columns.length).toBeGreaterThan(100);
  });

  it("places front and rear step beams and decking on every bay and level", () => {
    const spec = defaultRackSpec({ bays: 4, levels: 3, bayPitch: 4, bayWidth: 3, bayDepth: 4, levelHeight: 2 });
    const parts = buildRackParts(spec, false);
    expect(parts.beams).toHaveLength(spec.bays * spec.levels * 2);
    expect(parts.connectors).toHaveLength(spec.bays * spec.levels * 4);
    expect(parts.clips).toHaveLength(parts.connectors.length);
    expect(parts.waterfalls).toHaveLength(spec.bays * spec.levels * 2);
    expect(parts.deckWires.length).toBeGreaterThan(spec.bays * spec.levels * 8);
    expect(parts.deckBars.length).toBeGreaterThan(spec.bays * spec.levels * 5);
  });

  it("keeps exploded frames taller without dropping beam count", () => {
    const spec = defaultRackSpec({ bays: 2, levels: 4, bayPitch: 4, levelHeight: 2 });
    const solid = buildRackParts(spec, false);
    const exploded = buildRackParts(spec, true);
    expect(exploded.columns.length).toBeGreaterThan(solid.columns.length);
    expect(exploded.beams).toHaveLength(solid.beams.length);
    expect(exploded.braces.length).toBeGreaterThan(solid.braces.length);
  });
});
