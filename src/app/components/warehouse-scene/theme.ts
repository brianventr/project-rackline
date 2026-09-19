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
  ghost: string;
  invalid: string;
  bayHighlight: string;
  outline: string;
  areaRecv: string;
  areaProd: string;
  areaShip: string;
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
  ghost: "#7399bf",
  invalid: "#ef4444",
  bayHighlight: "#f3c4ae",
  outline: "#e05d38",
  areaRecv: "#d6e4f0",
  areaProd: "#cfe0d2",
  areaShip: "#e8d3ae",
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
  ghost: "#85a6c7",
  invalid: "#ef4444",
  bayHighlight: "#8a4630",
  outline: "#e05d38",
  areaRecv: "#2a3656",
  areaProd: "#1f3a2c",
  areaShip: "#3a3228",
  text: "#e5e5e5",
};

export function readSceneTheme(): SceneTheme {
  if (typeof document === "undefined") return light;
  return document.documentElement.classList.contains("dark") ? dark : light;
}
