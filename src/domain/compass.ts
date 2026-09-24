/**
 * Compass orientation for the floor maps. A warehouse stores `mapNorth`: where north points on its map, in
 * degrees clockwise from the top edge (map-up). 0 means the top edge faces north, 90 the right edge, and so on.
 * Crews say "the north wall" and "the east dock", so every map view labels its edges from this one number.
 */

export type CompassPoint = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type MapEdge = "top" | "right" | "bottom" | "left";

const POINTS: CompassPoint[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const POINT_NAMES: Record<CompassPoint, string> = {
  N: "North",
  NE: "Northeast",
  E: "East",
  SE: "Southeast",
  S: "South",
  SW: "Southwest",
  W: "West",
  NW: "Northwest",
};

export const NORTH_PRESETS: ReadonlyArray<{ deg: number; edge: MapEdge; label: string }> = [
  { deg: 0, edge: "top", label: "Top edge" },
  { deg: 90, edge: "right", label: "Right edge" },
  { deg: 180, edge: "bottom", label: "Bottom edge" },
  { deg: 270, edge: "left", label: "Left edge" },
];

/** Whole degrees in 0–359; anything unusable becomes 0. */
export function normalizeHeading(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

export function isHeading(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 359;
}

/** The nearest of eight points for a bearing in degrees. */
export function compassPoint(bearing: number): CompassPoint {
  const index = Math.round(normalizeHeading(bearing) / 45) % 8;
  return POINTS[index]!;
}

export function compassName(point: CompassPoint): string {
  return POINT_NAMES[point];
}

/** Compass bearing each map edge faces outward, for a map whose north sits `mapNorth` degrees clockwise of the top. */
export function edgeBearings(mapNorth: number): Record<MapEdge, number> {
  const north = normalizeHeading(mapNorth);
  return {
    top: normalizeHeading(0 - north),
    right: normalizeHeading(90 - north),
    bottom: normalizeHeading(180 - north),
    left: normalizeHeading(270 - north),
  };
}

export function edgeLabels(mapNorth: number): Record<MapEdge, CompassPoint> {
  const bearings = edgeBearings(mapNorth);
  return {
    top: compassPoint(bearings.top),
    right: compassPoint(bearings.right),
    bottom: compassPoint(bearings.bottom),
    left: compassPoint(bearings.left),
  };
}

/**
 * How far to turn a compass rose so its N points the right way on screen. `screenUpMapAngle` is the map
 * direction that currently reads as screen-up (0 in a plan view, the camera's heading in an orbit view).
 */
export function needleRotation(mapNorth: number, screenUpMapAngle = 0): number {
  return normalizeHeading(mapNorth - screenUpMapAngle);
}

/** One line for settings and tooltips: "North is the top edge of the map" or "North is 35° clockwise from the top edge". */
export function describeNorth(mapNorth: number): string {
  const north = normalizeHeading(mapNorth);
  const preset = NORTH_PRESETS.find((row) => row.deg === north);
  if (preset) return `North is the ${preset.label.toLowerCase()} of the map`;
  return `North is ${north}° clockwise from the top edge`;
}
