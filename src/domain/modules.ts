/**
 * The goods-flow. The office sidebar, the Garage menu, and the floor tiles
 * read this order, so a unit of stock moves the same way in every menu.
 * Now and Building sit outside the five stages. Settings stays a single entry.
 */
export const MODULES = [
  { id: "now", label: "Now" },
  { id: "inbound", label: "Inbound" },
  { id: "inventory", label: "Inventory" },
  { id: "make", label: "Make" },
  { id: "outbound", label: "Outbound" },
  { id: "returns", label: "Returns" },
  { id: "building", label: "Building" },
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

export function moduleLabel(id: ModuleId): string {
  const row = MODULES.find((module) => module.id === id);
  if (!row) throw new Error(`Unknown module ${id}`);
  return row.label;
}

/** Floor stages, in pipe order. Tools is the handheld leftover, not a stage of stock. */
export const FLOOR_MODULE_IDS = ["inbound", "inventory", "make", "outbound", "returns"] as const satisfies readonly ModuleId[];
