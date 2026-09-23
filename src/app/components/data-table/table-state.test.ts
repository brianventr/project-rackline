import { describe, expect, it } from "vitest";
import {
  compareSortValues,
  countTabs,
  facetOptions,
  filterRows,
  matchesSearch,
  parseFacetParam,
  parseSortParam,
  sortParam,
  toCsv,
  type FacetDef,
  type TabDef,
} from "./table-state";

type Row = { number: string; status: string; source: string | null; qty: number };

const rows: Row[] = [
  { number: "ORD-10", status: "open", source: "shopify", qty: 3 },
  { number: "ORD-2", status: "shipped", source: "floor", qty: 1 },
  { number: "ORD-3", status: "picking", source: "floor", qty: 5 },
  { number: "ORD-4", status: "open", source: null, qty: 2 },
];

const openTab: TabDef<Row> = { id: "open", label: "Open", match: (row) => row.status !== "shipped" };
const shippedTab: TabDef<Row> = { id: "shipped", label: "Shipped", match: (row) => row.status === "shipped" };
const channel: FacetDef<Row> = { id: "channel", label: "Channel", value: (row) => row.source };

describe("compareSortValues", () => {
  it("sorts document numbers naturally", () => {
    const sorted = ["ORD-10", "ORD-2", "ORD-3"].sort(compareSortValues);
    expect(sorted).toEqual(["ORD-2", "ORD-3", "ORD-10"]);
  });

  it("compares numbers numerically and puts blanks last", () => {
    expect([10, null, 2, undefined, 7].sort(compareSortValues)).toEqual([2, 7, 10, null, undefined]);
    expect(compareSortValues("", "a")).toBe(1);
  });
});

describe("sort param", () => {
  it("round-trips a column and direction", () => {
    const parsed = parseSortParam("number.desc", ["number"]);
    expect(parsed).toEqual({ id: "number", desc: true });
    expect(sortParam(parsed)).toBe("number.desc");
  });

  it("ignores columns the table does not sort", () => {
    expect(parseSortParam("secret.asc", ["number"])).toBeNull();
    expect(parseSortParam(null, ["number"])).toBeNull();
  });
});

describe("filterRows", () => {
  it("applies tab, facet, and search together", () => {
    const result = filterRows(rows, {
      tab: openTab,
      facets: [{ def: channel, selected: ["floor"] }],
      search: { text: (row) => row.number, query: "ord-3" },
    });
    expect(result.map((row) => row.number)).toEqual(["ORD-3"]);
  });

  it("treats an empty facet selection as no filter", () => {
    expect(filterRows(rows, { facets: [{ def: channel, selected: [] }] })).toHaveLength(4);
  });

  it("matches every search word", () => {
    expect(matchesSearch("ORD-3 Harbor Workshop", "harbor ord")).toBe(true);
    expect(matchesSearch("ORD-3 Harbor Workshop", "harbor acme")).toBe(false);
  });
});

describe("tab counts and facets", () => {
  it("counts rows per tab", () => {
    expect(countTabs(rows, [openTab, shippedTab])).toEqual({ open: 3, shipped: 1 });
  });

  it("lists facet values by frequency and skips blanks", () => {
    expect(facetOptions(rows, channel)).toEqual([
      { value: "floor", count: 2 },
      { value: "shopify", count: 1 },
    ]);
  });

  it("splits facet params", () => {
    expect(parseFacetParam("floor, shopify,")).toEqual(["floor", "shopify"]);
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes, and newlines", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], [1, null]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n1,');
  });
});
