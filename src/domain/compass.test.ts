import { describe, expect, it } from "vitest";
import { compassPoint, describeNorth, edgeLabels, isHeading, needleRotation, normalizeHeading } from "./compass";

describe("compass orientation", () => {
  it("keeps headings to whole degrees in 0–359", () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(359.6)).toBe(0);
    expect(normalizeHeading(-90)).toBe(270);
    expect(normalizeHeading(450)).toBe(90);
    expect(normalizeHeading("45")).toBe(45);
    expect(normalizeHeading(Number.NaN)).toBe(0);
    expect(isHeading(0)).toBe(true);
    expect(isHeading(359)).toBe(true);
    expect(isHeading(360)).toBe(false);
    expect(isHeading(12.5)).toBe(false);
  });

  it("names the nearest of eight points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(22)).toBe("N");
    expect(compassPoint(23)).toBe("NE");
    expect(compassPoint(90)).toBe("E");
    expect(compassPoint(180)).toBe("S");
    expect(compassPoint(270)).toBe("W");
    expect(compassPoint(320)).toBe("NW");
    expect(compassPoint(350)).toBe("N");
  });

  it("labels the map edges from where north points", () => {
    // North up: the usual drawing.
    expect(edgeLabels(0)).toEqual({ top: "N", right: "E", bottom: "S", left: "W" });
    // North is the right edge: the top edge now faces west.
    expect(edgeLabels(90)).toEqual({ top: "W", right: "N", bottom: "E", left: "S" });
    expect(edgeLabels(180)).toEqual({ top: "S", right: "W", bottom: "N", left: "E" });
    expect(edgeLabels(270)).toEqual({ top: "E", right: "S", bottom: "W", left: "N" });
    // A building set 45° off the grid gets ordinal walls.
    expect(edgeLabels(45)).toEqual({ top: "NW", right: "NE", bottom: "SE", left: "SW" });
  });

  it("turns the needle by the map's north minus what the camera calls up", () => {
    expect(needleRotation(0)).toBe(0);
    expect(needleRotation(90)).toBe(90);
    // Orbit camera looking along +X (screen-up is the map's right edge): north-up map shows N turned left.
    expect(needleRotation(0, 90)).toBe(270);
    expect(needleRotation(90, 90)).toBe(0);
  });

  it("describes the setting in one line", () => {
    expect(describeNorth(0)).toBe("North is the top edge of the map");
    expect(describeNorth(270)).toBe("North is the left edge of the map");
    expect(describeNorth(35)).toBe("North is 35° clockwise from the top edge");
  });
});
