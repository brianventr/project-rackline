export type BayMatch = {
  id: string;
  code: string;
  name: string;
  barcode?: string | null;
  aisle?: string | null;
  rack?: string | null;
  bay?: string | null;
};

export function bayLabel(location: Pick<BayMatch, "code" | "name">): string {
  return `${location.code} — ${location.name}`;
}

function baySearchText(location: BayMatch): string {
  const slot = [location.aisle, location.rack, location.bay].filter(Boolean).join("-");
  return [location.code, location.name, location.barcode, slot].filter(Boolean).join(" ").toLowerCase();
}

export function matchBays<T extends BayMatch>(locations: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return locations;
  return locations.filter((location) => baySearchText(location).includes(needle));
}

export function showCreateBay(query: string, matches: readonly unknown[]): boolean {
  return query.trim().length > 0 && matches.length === 0;
}
