export type SortValue = string | number | boolean | null | undefined;

export type ListSort = { id: string; desc: boolean };

/**
 * Ascending comparison for mixed cell values. Numbers compare numerically, strings compare
 * naturally (`ORD-2` before `ORD-10`), and blanks sort after values. The table flips the
 * result for descending order, so it also maps blanks to `undefined` with `sortUndefined: "last"`.
 */
export function compareSortValues(a: SortValue, b: SortValue): number {
  const aBlank = a == null || a === "";
  const bBlank = b == null || b === "";
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** `number.desc` → { id: "number", desc: true }. Unknown columns are dropped. */
export function parseSortParam(raw: string | null, allowed: readonly string[]): ListSort | null {
  if (!raw) return null;
  const [id, dir] = raw.split(".");
  if (!id || !allowed.includes(id)) return null;
  return { id, desc: dir === "desc" };
}

export function sortParam(sort: ListSort | null): string | null {
  if (!sort) return null;
  return `${sort.id}.${sort.desc ? "desc" : "asc"}`;
}

/** Comma list in the URL → set of selected facet values. */
export function parseFacetParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function matchesSearch(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const text = haystack.toLowerCase();
  return q.split(/\s+/).every((term) => text.includes(term));
}

export type TabDef<T> = { id: string; label: string; match: (row: T) => boolean };
export type FacetDef<T> = {
  id: string;
  label: string;
  value: (row: T) => string | null | undefined;
  format?: (value: string) => string;
};

export type ListFilter<T> = {
  tab?: TabDef<T> | null;
  facets?: { def: FacetDef<T>; selected: string[] }[];
  search?: { text: (row: T) => string; query: string } | null;
};

export function filterRows<T>(rows: readonly T[], filter: ListFilter<T>): T[] {
  const activeFacets = (filter.facets ?? []).filter((facet) => facet.selected.length > 0);
  return rows.filter((row) => {
    if (filter.tab && !filter.tab.match(row)) return false;
    for (const facet of activeFacets) {
      const value = facet.def.value(row) ?? "";
      if (!facet.selected.includes(value)) return false;
    }
    if (filter.search && !matchesSearch(filter.search.text(row), filter.search.query)) return false;
    return true;
  });
}

/** Counts per tab over rows that already pass search and facets, so the badges match what a click shows. */
export function countTabs<T>(rows: readonly T[], tabs: readonly TabDef<T>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tab of tabs) counts[tab.id] = 0;
  for (const row of rows) {
    for (const tab of tabs) {
      if (tab.match(row)) counts[tab.id] += 1;
    }
  }
  return counts;
}

/** Distinct facet values with counts, most common first, blanks excluded. */
export function facetOptions<T>(rows: readonly T[], facet: FacetDef<T>): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = facet.value(row);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (value: string | number | null | undefined) => {
    const text = value == null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [header, ...rows].map((line) => line.map(escape).join(",")).join("\r\n");
}
