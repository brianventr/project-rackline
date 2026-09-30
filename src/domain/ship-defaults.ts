import type { ParcelDims } from "./carrier-live";

export type PackagePreset = {
  id: string;
  name: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  tareOz: number;
  isDefault: boolean;
};

export type ShipWeightLine = {
  sku: string;
  qty: number;
  shipWeightOz?: number | null;
  shipLengthIn?: number | null;
  shipWidthIn?: number | null;
  shipHeightIn?: number | null;
};

export type OrderParcelInput = {
  lines: ShipWeightLine[];
  preset?: PackagePreset | null;
  /** Weight and dims already typed on the order win over the computed ones. */
  order?: {
    packageWeightOz?: number | null;
    packageLengthIn?: number | null;
    packageWidthIn?: number | null;
    packageHeightIn?: number | null;
  } | null;
};

export type OrderParcel = {
  parcel: Partial<ParcelDims>;
  /** SKUs with no ship weight; empty when the weight came from the order or every SKU has one. */
  missingWeight: string[];
  source: "order" | "computed";
  presetId: string | null;
};

function positive(value: number | null | undefined): number | undefined {
  return value != null && value > 0 ? value : undefined;
}

export function pickPreset(presets: PackagePreset[], presetId?: string | null): PackagePreset | null {
  if (presetId) return presets.find((row) => row.id === presetId) ?? null;
  return presets.find((row) => row.isDefault) ?? null;
}

export function orderParcel(input: OrderParcelInput): OrderParcel {
  const lines = input.lines.filter((line) => line.qty > 0);
  const preset = input.preset ?? null;
  const typedWeight = positive(input.order?.packageWeightOz);
  const dims = orderDims(lines, preset, input.order);
  if (typedWeight) {
    return { parcel: { weightOz: typedWeight, ...dims }, missingWeight: [], source: "order", presetId: preset?.id ?? null };
  }
  const missingWeight = [...new Set(lines.filter((line) => !positive(line.shipWeightOz)).map((line) => line.sku))];
  const contents = lines.reduce((sum, line) => sum + line.qty * (positive(line.shipWeightOz) ?? 0), 0);
  const weightOz = missingWeight.length ? undefined : contents + (preset?.tareOz ?? 0);
  return {
    parcel: { ...(weightOz ? { weightOz } : {}), ...dims },
    missingWeight,
    source: "computed",
    presetId: preset?.id ?? null,
  };
}

function orderDims(
  lines: ShipWeightLine[],
  preset: PackagePreset | null,
  order: OrderParcelInput["order"],
): Partial<Pick<ParcelDims, "lengthIn" | "widthIn" | "heightIn">> {
  const typed = {
    lengthIn: positive(order?.packageLengthIn),
    widthIn: positive(order?.packageWidthIn),
    heightIn: positive(order?.packageHeightIn),
  };
  if (typed.lengthIn && typed.widthIn && typed.heightIn) return typed;
  if (preset) return { lengthIn: preset.lengthIn, widthIn: preset.widthIn, heightIn: preset.heightIn };
  const only = lines.length === 1 && lines[0]!.qty === 1 ? lines[0]! : null;
  if (only && positive(only.shipLengthIn) && positive(only.shipWidthIn) && positive(only.shipHeightIn)) {
    return { lengthIn: only.shipLengthIn!, widthIn: only.shipWidthIn!, heightIn: only.shipHeightIn! };
  }
  return {};
}

export function defaultShipService(input: {
  requested?: string | null;
  warehouseDefault?: string | null;
  orderService?: string | null;
}): string | null {
  return input.requested?.trim() || input.orderService?.trim() || input.warehouseDefault?.trim() || null;
}

export function defaultShipConnection(input: {
  requested?: string | null;
  warehouseDefault?: string | null;
  orderConnection?: string | null;
}): string | null {
  return input.requested?.trim() || input.orderConnection?.trim() || input.warehouseDefault?.trim() || null;
}

export function parsePresetInput(body: {
  name?: unknown;
  lengthIn?: unknown;
  widthIn?: unknown;
  heightIn?: unknown;
  tareOz?: unknown;
}): { name: string; lengthIn: number; widthIn: number; heightIn: number; tareOz: number } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new Error("Box name is required");
  const dim = (value: unknown, label: string) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a whole number of inches above 0`);
    return n;
  };
  const tare = body.tareOz === undefined || body.tareOz === null || body.tareOz === "" ? 0 : Number(body.tareOz);
  if (!Number.isInteger(tare) || tare < 0) throw new Error("Box weight must be a whole number of ounces");
  return {
    name,
    lengthIn: dim(body.lengthIn, "Length"),
    widthIn: dim(body.widthIn, "Width"),
    heightIn: dim(body.heightIn, "Height"),
    tareOz: tare,
  };
}
