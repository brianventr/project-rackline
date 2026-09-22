import { describe, expect, it } from "vitest";
import { matchBays, showCreateBay, type BayMatch } from "./bay-match";

const bays: BayMatch[] = [
  { id: "1", code: "RECV", name: "Receiving dock", barcode: "RECV", aisle: null, rack: null, bay: null },
  { id: "2", code: "A-01-02", name: "Bulk lamp", barcode: "A-01-02", aisle: "A", rack: "01", bay: "02" },
  { id: "3", code: "B-03-01", name: "Shade pick", barcode: "BAY-SHADE", aisle: "B", rack: "03", bay: "01" },
];

describe("matchBays", () => {
  it("matches code, name, barcode, and aisle-rack-bay substrings", () => {
    expect(matchBays(bays, "rec").map((row) => row.code)).toEqual(["RECV"]);
    expect(matchBays(bays, "lamp").map((row) => row.code)).toEqual(["A-01-02"]);
    expect(matchBays(bays, "BAY-SH").map((row) => row.code)).toEqual(["B-03-01"]);
    expect(matchBays(bays, "b-03-01").map((row) => row.code)).toEqual(["B-03-01"]);
    expect(matchBays(bays, "a-01").map((row) => row.code)).toEqual(["A-01-02"]);
  });

  it("returns every bay when the query is blank", () => {
    expect(matchBays(bays, "")).toEqual(bays);
    expect(matchBays(bays, "   ")).toEqual(bays);
  });
});

describe("showCreateBay", () => {
  it("offers create only when a query matches nothing", () => {
    expect(showCreateBay("", matchBays(bays, ""))).toBe(false);
    expect(showCreateBay("   ", matchBays(bays, "   "))).toBe(false);
    expect(showCreateBay("rec", matchBays(bays, "rec"))).toBe(false);
    expect(showCreateBay("zzzz", matchBays(bays, "zzzz"))).toBe(true);
  });
});
