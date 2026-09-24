export type SceneTheme = {
  dark: boolean;
  background: string;
  floor: string;
  grid: string;
  gridSection: string;
  steel: string;
  beam: string;
  galvanized: string;
  punch: string;
  wood: string;
  woodDark: string;
  strap: string;
  empty: string;
  occupied: string;
  selected: string;
  hover: string;
  from: string;
  to: string;
  pick: string;
  ghost: string;
  invalid: string;
  bayHighlight: string;
  outline: string;
  areaRecv: string;
  areaProd: string;
  areaShip: string;
  /** Dark edge drawn round a dock / bench / staging box so it reads against the floor from above. */
  areaEdge: string;
  /** Fills for drawn zones, picked by the zone's position in code order. */
  zonePalette: string[];
  text: string;
};

const light: SceneTheme = {
  dark: false,
  background: "#cfd6dc",
  floor: "#d9dee3",
  grid: "#b7c0c8",
  gridSection: "#8b9aa8",
  steel: "#2f4b79",
  beam: "#3a4a6e",
  galvanized: "#8b96a3",
  punch: "#1b2433",
  wood: "#c4a06a",
  woodDark: "#8a6238",
  strap: "#5c4630",
  empty: "#f4f0ea",
  occupied: "#df6035",
  selected: "#e05d38",
  hover: "#e16f41",
  from: "#2d6a4f",
  to: "#e2b146",
  pick: "#3d8b6e",
  ghost: "#7399bf",
  invalid: "#ef4444",
  bayHighlight: "#f3c4ae",
  outline: "#e05d38",
  areaRecv: "#4f86c6",
  areaProd: "#3f9a6a",
  areaShip: "#d29a3a",
  areaEdge: "#1b2433",
  zonePalette: ["#7c5cbf", "#2a9d8f", "#c2557a", "#5b7fb8", "#8a9a2b", "#c97b3b"],
  text: "#333333",
};

const dark: SceneTheme = {
  dark: true,
  background: "#141414",
  floor: "#1f1f1f",
  grid: "#353535",
  gridSection: "#4a4a4a",
  steel: "#8eadd0",
  beam: "#6a7ea8",
  galvanized: "#9aa6b4",
  punch: "#0f141c",
  wood: "#c4a06a",
  woodDark: "#8a6238",
  strap: "#6b5340",
  empty: "#2a2a2a",
  occupied: "#df6035",
  selected: "#e05d38",
  hover: "#e16f41",
  from: "#4ade80",
  to: "#e2b146",
  pick: "#34d399",
  ghost: "#85a6c7",
  invalid: "#ef4444",
  bayHighlight: "#8a4630",
  outline: "#e05d38",
  areaRecv: "#3d6fb3",
  areaProd: "#2f7f57",
  areaShip: "#b98430",
  areaEdge: "#e6ebf2",
  zonePalette: ["#a78bfa", "#5eead4", "#f0abfc", "#93c5fd", "#bef264", "#fdba74"],
  text: "#e5e5e5",
};

/** A stable colour per zone: zones sorted by code share the palette in order, wrapping when there are many. */
export function zoneColor(theme: SceneTheme, index: number): string {
  return theme.zonePalette[((index % theme.zonePalette.length) + theme.zonePalette.length) % theme.zonePalette.length]!;
}

export function readSceneTheme(): SceneTheme {
  if (typeof document === "undefined") return light;
  return document.documentElement.classList.contains("dark") ? dark : light;
}
