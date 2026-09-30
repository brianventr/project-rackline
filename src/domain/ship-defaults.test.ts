import { describe, expect, it } from "vitest";
import {
  defaultShipConnection,
  defaultShipService,
  orderParcel,
  parsePresetInput,
  pickPreset,
  type PackagePreset,
} from "./ship-defaults";

const mailer: PackagePreset = {
  id: "p1",
  name: "Mailer",
  lengthIn: 10,
  widthIn: 8,
  heightIn: 2,
  tareOz: 2,
  isDefault: true,
};
const box: PackagePreset = { ...mailer, id: "p2", name: "Box", lengthIn: 12, widthIn: 12, heightIn: 6, tareOz: 6, isDefault: false };

describe("ship defaults", () => {
  it("sums SKU ship weight times qty plus the box tare", () => {
    const result = orderParcel({
      lines: [
        { sku: "A", qty: 2, shipWeightOz: 5 },
        { sku: "B", qty: 1, shipWeightOz: 3 },
      ],
      preset: mailer,
    });
    expect(result.parcel).toEqual({ weightOz: 15, lengthIn: 10, widthIn: 8, heightIn: 2 });
    expect(result.missingWeight).toEqual([]);
    expect(result.source).toBe("computed");
    expect(result.presetId).toBe("p1");
  });

  it("lists SKUs with no ship weight and leaves the weight unset", () => {
    const result = orderParcel({
      lines: [
        { sku: "A", qty: 1, shipWeightOz: 5 },
        { sku: "B", qty: 1 },
        { sku: "B", qty: 2, shipWeightOz: 0 },
      ],
    });
    expect(result.missingWeight).toEqual(["B"]);
    expect(result.parcel.weightOz).toBeUndefined();
  });

  it("keeps a weight already typed on the order", () => {
    const result = orderParcel({
      lines: [{ sku: "B", qty: 1 }],
      order: { packageWeightOz: 20, packageLengthIn: 4, packageWidthIn: 4, packageHeightIn: 4 },
      preset: mailer,
    });
    expect(result.source).toBe("order");
    expect(result.missingWeight).toEqual([]);
    expect(result.parcel).toEqual({ weightOz: 20, lengthIn: 4, widthIn: 4, heightIn: 4 });
  });

  it("uses a lone unit's own dims when there is no box preset", () => {
    const result = orderParcel({
      lines: [{ sku: "A", qty: 1, shipWeightOz: 9, shipLengthIn: 6, shipWidthIn: 5, shipHeightIn: 4 }],
    });
    expect(result.parcel).toEqual({ weightOz: 9, lengthIn: 6, widthIn: 5, heightIn: 4 });
    const two = orderParcel({
      lines: [{ sku: "A", qty: 2, shipWeightOz: 9, shipLengthIn: 6, shipWidthIn: 5, shipHeightIn: 4 }],
    });
    expect(two.parcel).toEqual({ weightOz: 18 });
  });

  it("picks the requested preset, else the default", () => {
    expect(pickPreset([mailer, box])?.id).toBe("p1");
    expect(pickPreset([mailer, box], "p2")?.id).toBe("p2");
    expect(pickPreset([box])).toBeNull();
    expect(pickPreset([mailer], "missing")).toBeNull();
  });

  it("prefers the requested service, then the order's, then the building default", () => {
    expect(defaultShipService({ requested: "ups-ground", orderService: "usps", warehouseDefault: "fedex" })).toBe("ups-ground");
    expect(defaultShipService({ orderService: "usps", warehouseDefault: "fedex" })).toBe("usps");
    expect(defaultShipService({ warehouseDefault: "fedex" })).toBe("fedex");
    expect(defaultShipService({})).toBeNull();
    expect(defaultShipConnection({ warehouseDefault: "c1" })).toBe("c1");
  });

  it("validates box presets", () => {
    expect(parsePresetInput({ name: " Mailer ", lengthIn: 10, widthIn: "8", heightIn: 2 })).toEqual({
      name: "Mailer",
      lengthIn: 10,
      widthIn: 8,
      heightIn: 2,
      tareOz: 0,
    });
    expect(() => parsePresetInput({ name: "", lengthIn: 1, widthIn: 1, heightIn: 1 })).toThrow(/name/);
    expect(() => parsePresetInput({ name: "X", lengthIn: 0, widthIn: 1, heightIn: 1 })).toThrow(/Length/);
    expect(() => parsePresetInput({ name: "X", lengthIn: 1, widthIn: 1, heightIn: 1, tareOz: -1 })).toThrow(/weight/);
  });
});
