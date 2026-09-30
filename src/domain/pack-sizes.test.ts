import { describe, expect, it } from "vitest";
import { normalizePackSizes, packForBarcode, packText, PackSizeError, scanIntoLine, syncedAltUnit } from "./pack-sizes";

const casePack = { level: "case", qty: 12, barcode: "10012345678902", weightOz: 200, lengthIn: 12, widthIn: 10, heightIn: 8 };

describe("normalizePackSizes", () => {
  it("orders levels inner → case → pallet and normalizes barcodes and measures", () => {
    const packs = normalizePackSizes([
      { level: "pallet", qty: 480 },
      { ...casePack, barcode: " 1001 2345 678902 " },
      { level: "Inner", qty: "4", weightOz: "", lengthIn: 0 },
    ]);
    expect(packs.map((pack) => [pack.level, pack.qty])).toEqual([
      ["inner", 4],
      ["case", 12],
      ["pallet", 480],
    ]);
    expect(packs[1]!.barcode).toBe("10012345678902");
    expect(packs[0]).toMatchObject({ barcode: null, weightOz: null, lengthIn: null });
    expect(packs[1]).toMatchObject({ weightOz: 200, lengthIn: 12, widthIn: 10, heightIn: 8 });
  });

  it("accepts no levels", () => {
    expect(normalizePackSizes([])).toEqual([]);
  });

  it("refuses bad levels, sizes, and duplicates", () => {
    expect(() => normalizePackSizes({})).toThrow(PackSizeError);
    expect(() => normalizePackSizes([{ level: "crate", qty: 4 }])).toThrow("Pack level must be inner, case, or pallet");
    expect(() => normalizePackSizes([{ level: "case", qty: 1 }])).toThrow("Case qty must be a whole number of eaches, 2 or more");
    expect(() => normalizePackSizes([{ level: "case", qty: 2.5 }])).toThrow(PackSizeError);
    expect(() => normalizePackSizes([casePack, { level: "case", qty: 24 }])).toThrow("Only one case size per item");
    expect(() => normalizePackSizes([{ ...casePack, weightOz: -1 }])).toThrow("Case weight must be a whole number, 0 or more");
  });

  it("needs each level to hold whole packs of the level below", () => {
    expect(() => normalizePackSizes([{ level: "inner", qty: 5 }, { level: "case", qty: 12 }])).toThrow(
      "A case of 12 must hold whole inners of 5",
    );
    expect(() => normalizePackSizes([{ level: "case", qty: 12 }, { level: "pallet", qty: 12 }])).toThrow(
      "A pallet of 12 must hold whole cases of 12",
    );
    expect(() => normalizePackSizes([{ level: "inner", qty: 6 }, { level: "pallet", qty: 100 }])).toThrow(
      "A pallet of 100 must hold whole inners of 6",
    );
  });

  it("refuses one barcode on two levels", () => {
    expect(() => normalizePackSizes([{ level: "inner", qty: 4, barcode: "abc" }, { level: "case", qty: 12, barcode: "ABC" }])).toThrow(
      "The inner and case cannot share barcode ABC",
    );
  });
});

describe("syncedAltUnit", () => {
  const packs = normalizePackSizes([{ level: "inner", qty: 4 }, casePack]);

  it("makes the case the alt unit when none is set", () => {
    expect(syncedAltUnit({ altUom: null, altPerStock: null }, packs)).toEqual({ altUom: "case", altPerStock: 12 });
  });

  it("follows the level an alt unit is named for", () => {
    expect(syncedAltUnit({ altUom: "inner", altPerStock: 3 }, packs)).toEqual({ altUom: "inner", altPerStock: 4 });
    expect(syncedAltUnit({ altUom: "case", altPerStock: 12 }, packs)).toBeNull();
    expect(syncedAltUnit({ altUom: "pallet", altPerStock: 480 }, packs)).toEqual({ altUom: "case", altPerStock: 12 });
    expect(syncedAltUnit({ altUom: "case", altPerStock: 6 }, [])).toEqual({ altUom: null, altPerStock: null });
  });

  it("leaves a custom alt unit alone", () => {
    expect(syncedAltUnit({ altUom: "roll", altPerStock: 50 }, packs)).toBeNull();
    expect(syncedAltUnit({ altUom: null, altPerStock: null }, [])).toBeNull();
  });
});

describe("pack lookups", () => {
  const packs = normalizePackSizes([casePack]);
  it("finds a pack by scanned barcode", () => {
    expect(packForBarcode(packs, " 10012345678902 ")?.level).toBe("case");
    expect(packForBarcode(packs, "LAMP")).toBeNull();
    expect(packText(packs[0]!)).toBe("Case of 12");
  });
});

describe("scanIntoLine", () => {
  const box = { level: "case" as const, qty: 6 };

  it("replaces the prefilled qty on the first pack scan, then adds", () => {
    const first = scanIntoLine({ qty: 20, counted: false, remaining: 20 }, { pack: box });
    expect(first).toEqual({ ok: true, qty: 6, counted: true });
    const second = scanIntoLine({ qty: 6, counted: true, remaining: 20 }, { pack: box });
    expect(second).toEqual({ ok: true, qty: 12, counted: true });
    expect(scanIntoLine({ qty: 12, counted: true, remaining: 20 }, {})).toEqual({ ok: true, qty: 13, counted: true });
  });

  it("counts each scans on counting screens and fills on fill screens", () => {
    expect(scanIntoLine({ qty: 20, counted: false, remaining: 20 }, {})).toEqual({ ok: true, qty: 1, counted: true });
    expect(scanIntoLine({ qty: 0, counted: false, remaining: 20 }, { fill: true })).toEqual({ ok: true, qty: 20, counted: false });
    expect(scanIntoLine({ qty: 6, counted: true, remaining: 20 }, { fill: true })).toEqual({ ok: true, qty: 7, counted: true });
  });

  it("refuses a scan past what is left", () => {
    expect(scanIntoLine({ qty: 18, counted: true, remaining: 20 }, { pack: box })).toEqual({
      ok: false,
      problem: "A case is 6, but only 2 are left. Scan eaches or type the qty.",
    });
    expect(scanIntoLine({ qty: 0, counted: false, remaining: 4 }, { pack: box })).toMatchObject({ ok: false });
    expect(scanIntoLine({ qty: 20, counted: true, remaining: 20 }, {})).toEqual({ ok: false, problem: "All 20 are already counted." });
    expect(scanIntoLine({ qty: 0, counted: false, remaining: 0 }, {})).toEqual({ ok: false, problem: "Nothing is left on this line." });
  });

  it("counts without a limit when nothing is expected", () => {
    expect(scanIntoLine({ qty: 3, counted: true, remaining: Number.POSITIVE_INFINITY }, { pack: box })).toEqual({
      ok: true,
      qty: 9,
      counted: true,
    });
  });
});
