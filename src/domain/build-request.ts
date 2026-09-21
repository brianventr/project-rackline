export type ReleaseKind = "kit" | "work_order";

export function releaseDocumentKind(itemType: string): ReleaseKind {
  if (itemType === "wip") return "work_order";
  if (itemType === "finished") return "kit";
  throw new Error("Only a finished or WIP recipe can be requested");
}

export type BayChoice = { id: string; type: string; slotRole?: string | null };

export function usualBays(locations: BayChoice[]): {
  sourceId: string;
  kitOutputId: string;
  workOrderOutputId: string;
} | null {
  if (locations.length === 0) return null;
  const source = locations.find((row) => row.type === "storage") ?? locations[0]!;
  const kitOutput = locations.find((row) => row.slotRole === "pick") ?? source;
  const workOrderOutput = locations.find((row) => row.type === "production") ?? source;
  return { sourceId: source.id, kitOutputId: kitOutput.id, workOrderOutputId: workOrderOutput.id };
}
