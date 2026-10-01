import { describe, expect, it } from "vitest";
import { BOX_FILL_FACTOR, boxInside, fitBox } from "./box-fit";
import type { PackagePreset, ShipWeightLine } from "./ship-defaults";

const mailer: PackagePreset = { id: "mailer", name: "Mailer", lengthIn: 10, widthIn: 8, heightIn: 2, tareOz: 2, isDefault: false };
const small: PackagePreset = {
  id: "small",
  name: "Small box",
  lengthIn: 8,
  widthIn: 8,
  heightIn: 8,
  tareOz: 5,
  isDefault: true,
  innerLengthIn: 7.5,
  innerWidthIn: 7.5,
  innerHeightIn: 7.5,
};
const large: PackagePreset = { id: "large", name: "Large box", lengthIn: 16, widthIn: 12, heightIn: 12, tareOz: 12, isDefault: false };
const boxes = [large, small, mailer];

function line(sku: string, qty: number, sides: [number, number, number] | null, weightOz: number | null = 8): ShipWeightLine {
  return {
    sku,
    qty,
    shipWeightOz: weightOz,
    shipLengthIn: sides?.[0] ?? null,
    shipWidthIn: sides?.[1] ?? null,
    shipHeightIn: sides?.[2] ?? null,
  };
}

describe("boxInside", () => {
  it("uses the inside size when all three sides are set, longest first", () => {
    expect(boxInside(small)).toEqual([7.5, 7.5, 7.5]);
    expect(boxInside({ ...mailer, innerLengthIn: 1.5, innerWidthIn: 9.5, innerHeightIn: 7.5 })).toEqual([9.5, 7.5, 1.5]);
  });

  it("falls back to the outside size when the inside size is missing or partial", () => {
    expect(boxInside(mailer)).toEqual([10, 8, 2]);
    expect(boxInside({ ...mailer, innerLengthIn: 9, innerWidthIn: null, innerHeightIn: 1 })).toEqual([10, 8, 2]);
  });
});

describe("fitBox", () => {
  it("picks the smallest box a flat item fits in", () => {
    expect(fitBox({ lines: [line("CARD", 1, [9, 7, 1])], presets: boxes })).toEqual({ kind: "fit", preset: mailer });
  });

  it("turns an item any square way to fit", () => {
    expect(fitBox({ lines: [line("CARD", 1, [1, 9, 7])], presets: boxes })).toMatchObject({ preset: { id: "mailer" } });
    expect(fitBox({ lines: [line("POSTER", 1, [2, 10, 8])], presets: [small, mailer] })).toMatchObject({ preset: { id: "mailer" } });
  });

  it("moves up a size when an item is too big for the smallest box", () => {
    expect(fitBox({ lines: [line("LAMP", 1, [7, 7, 6])], presets: boxes })).toMatchObject({ preset: { id: "small" } });
    expect(fitBox({ lines: [line("SHADE", 1, [11, 9, 9])], presets: boxes })).toMatchObject({ preset: { id: "large" } });
  });

  it("checks the inside size, not the outside", () => {
    expect(fitBox({ lines: [line("CUBE", 1, [8, 8, 8])], presets: boxes })).toMatchObject({ preset: { id: "large" } });
  });

  it("leaves room between several items with the fill factor", () => {
    const inside = 7.5 ** 3;
    const unit = 3 * 3 * 3;
    const fits = Math.floor((inside * BOX_FILL_FACTOR) / unit);
    expect(fitBox({ lines: [line("BULB", fits, [3, 3, 3])], presets: [small, large] })).toMatchObject({ preset: { id: "small" } });
    expect(fitBox({ lines: [line("BULB", fits + 1, [3, 3, 3])], presets: [small, large] })).toMatchObject({ preset: { id: "large" } });
  });

  it("lets a single item fill the box", () => {
    expect(fitBox({ lines: [line("CUBE", 1, [7.5, 7.5, 7.5])], presets: [small, large] })).toMatchObject({ preset: { id: "small" } });
  });

  it("keeps a box's max weight, box included", () => {
    const capped = { ...small, maxWeightOz: 40 };
    expect(fitBox({ lines: [line("BRICK", 1, [4, 4, 4], 35)], presets: [capped, large] })).toMatchObject({ preset: { id: "small" } });
    expect(fitBox({ lines: [line("BRICK", 1, [4, 4, 4], 36)], presets: [capped, large] })).toMatchObject({ preset: { id: "large" } });
    expect(fitBox({ lines: [line("BRICK", 1, [4, 4, 4], 10)], presets: [capped, large], weighedOz: 41 })).toMatchObject({
      preset: { id: "large" },
    });
  });

  it("goes by the outside size, then the default box, then the name", () => {
    const twin = { ...small, id: "twin", name: "A twin", isDefault: false };
    expect(fitBox({ lines: [line("LAMP", 1, [6, 6, 6])], presets: [twin, small] })).toMatchObject({ preset: { id: "small" } });
    const other = { ...twin, id: "other", name: "B twin" };
    expect(fitBox({ lines: [line("LAMP", 1, [6, 6, 6])], presets: [other, twin] })).toMatchObject({ preset: { id: "twin" } });
  });

  it("needs a ship size on every SKU", () => {
    expect(fitBox({ lines: [line("LAMP", 1, [6, 6, 6]), line("CORD", 2, null), line("CORD", 1, null)], presets: boxes })).toEqual({
      kind: "unsized",
      skus: ["CORD"],
    });
    expect(fitBox({ lines: [], presets: boxes })).toEqual({ kind: "unsized", skus: [] });
  });

  it("ignores lines with nothing to ship", () => {
    expect(fitBox({ lines: [line("CARD", 1, [9, 7, 1]), line("CORD", 0, null)], presets: boxes })).toMatchObject({ kind: "fit" });
  });

  it("says when nothing fits", () => {
    expect(fitBox({ lines: [line("TABLE", 1, [30, 20, 4])], presets: boxes })).toEqual({ kind: "too_big" });
  });
});
