import type { PackagePreset, ShipWeightLine } from "./ship-defaults";

/**
 * Share of a box's inside volume that more than one item may take up. Rigid items never pack solid, so the rest is
 * left for the gaps between them and some padding.
 */
export const BOX_FILL_FACTOR = 0.8;

export type BoxFit =
  | { kind: "fit"; preset: PackagePreset }
  /** Some lines have no ship size, so no box can be checked. */
  | { kind: "unsized"; skus: string[] }
  | { kind: "too_big" };

type Sides = [number, number, number];

function positive(value: number | null | undefined): value is number {
  return value != null && value > 0;
}

function longestFirst(sides: number[]): Sides {
  const [a = 0, b = 0, c = 0] = [...sides].sort((x, y) => y - x);
  return [a, b, c];
}

function volume(sides: Sides): number {
  return sides[0] * sides[1] * sides[2];
}

/** A box's inside, longest side first: its inside size when all three sides are set, else its outside size. */
export function boxInside(preset: PackagePreset): Sides {
  const inner = [preset.innerLengthIn, preset.innerWidthIn, preset.innerHeightIn];
  if (inner.every(positive)) return longestFirst(inner);
  return longestFirst([preset.lengthIn, preset.widthIn, preset.heightIn]);
}

function holds(preset: PackagePreset, lines: { sides: Sides; qty: number }[], parcelOz: number): boolean {
  const inside = boxInside(preset);
  if (!lines.every((line) => line.sides.every((side, i) => side <= inside[i]!))) return false;
  const units = lines.reduce((sum, line) => sum + line.qty, 0);
  const itemsVolume = lines.reduce((sum, line) => sum + volume(line.sides) * line.qty, 0);
  if (units > 1 && itemsVolume > volume(inside) * BOX_FILL_FACTOR) return false;
  return !(positive(preset.maxWeightOz) && parcelOz > preset.maxWeightOz);
}

/**
 * The smallest box the order goes in.
 *
 * Every unit has to fit on its own: its sides and the box's inside sides, each sorted longest first, compare one by
 * one, which allows any square turn of the unit. More than one unit also has to fit by volume, taking up at most
 * `BOX_FILL_FACTOR` of the inside. A box with a max weight has to carry the parcel: the weighed weight when there is
 * one, else the SKU ship weights plus the empty box (SKUs with no weight count as nothing).
 *
 * Smallest means the least outside volume, since carriers bill the outside size; ties go to the default box, then by
 * name. Needs a ship size on every SKU.
 */
export function fitBox(input: { lines: ShipWeightLine[]; presets: PackagePreset[]; weighedOz?: number | null }): BoxFit {
  const lines = input.lines.filter((line) => line.qty > 0);
  const unsized = lines.filter((line) => ![line.shipLengthIn, line.shipWidthIn, line.shipHeightIn].every(positive));
  if (!lines.length || unsized.length) return { kind: "unsized", skus: [...new Set(unsized.map((line) => line.sku))] };
  const sized = lines.map((line) => ({ sides: longestFirst([line.shipLengthIn!, line.shipWidthIn!, line.shipHeightIn!]), qty: line.qty }));
  const itemsOz = lines.reduce((sum, line) => sum + line.qty * (positive(line.shipWeightOz) ? line.shipWeightOz : 0), 0);
  const weighed = positive(input.weighedOz) ? input.weighedOz : null;
  const outside = (preset: PackagePreset) => preset.lengthIn * preset.widthIn * preset.heightIn;
  const [best] = input.presets
    .filter((preset) => holds(preset, sized, weighed ?? itemsOz + preset.tareOz))
    .sort((a, b) => outside(a) - outside(b) || Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  return best ? { kind: "fit", preset: best } : { kind: "too_big" };
}
