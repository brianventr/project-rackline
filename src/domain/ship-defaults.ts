import type { ParcelDims } from "./carrier-live";
import { resolveLabelPurchase, type CarrierConnectionLike } from "./carriers";

export type PackagePreset = {
  id: string;
  name: string;
  /** Outside size: what goes on the label. */
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  tareOz: number;
  isDefault: boolean;
  /** Inside size, used to pick a box that fits; the outside size stands in when unset. */
  innerLengthIn?: number | null;
  innerWidthIn?: number | null;
  innerHeightIn?: number | null;
  /** Heaviest parcel the box should carry, box included. */
  maxWeightOz?: number | null;
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

/** `20` → `1 lb 4 oz`, `16` → `1 lb`, `9` → `9 oz`. */
export function formatOz(weightOz: number): string {
  const lb = Math.floor(weightOz / 16);
  const oz = Math.round((weightOz - lb * 16) * 10) / 10;
  if (!lb) return `${oz} oz`;
  return oz ? `${lb} lb ${oz} oz` : `${lb} lb`;
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

/** Live postage cannot be bought without a weight. The queue shows this under Needs attention (`NEED_WEIGHT`). */
export function liveWeightBlocker(
  live: boolean,
  missingWeight: readonly string[],
): { code: "NEED_WEIGHT"; error: string; sku: string | null } | null {
  if (!live || missingWeight.length === 0) return null;
  return {
    code: "NEED_WEIGHT",
    error: `Add a ship weight for ${missingWeight.join(", ")} before buying live postage`,
    sku: missingWeight[0] ?? null,
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

export type BuildingDefaultService = { serviceId: string; connectionId: string | null };

/** The building's default service, or null once its carrier account is gone or no longer offers it. */
export function buildingDefaultService(
  connections: CarrierConnectionLike[],
  warehouse: { defaultCarrierService?: string | null; defaultCarrierConnectionId?: string | null } | null | undefined,
): BuildingDefaultService | null {
  const serviceId = warehouse?.defaultCarrierService?.trim();
  if (!serviceId) return null;
  const purchase = resolveLabelPurchase({ connections, serviceId, connectionId: warehouse?.defaultCarrierConnectionId });
  return purchase.ok ? { serviceId: purchase.service.id, connectionId: purchase.connectionId } : null;
}

export function parsePresetInput(body: {
  name?: unknown;
  lengthIn?: unknown;
  widthIn?: unknown;
  heightIn?: unknown;
  tareOz?: unknown;
  innerLengthIn?: unknown;
  innerWidthIn?: unknown;
  innerHeightIn?: unknown;
  maxWeightOz?: unknown;
}): {
  name: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  tareOz: number;
  innerLengthIn: number | null;
  innerWidthIn: number | null;
  innerHeightIn: number | null;
  maxWeightOz: number | null;
} {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new Error("Box name is required");
  const blank = (value: unknown) => value === undefined || value === null || value === "";
  const dim = (value: unknown, label: string) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a whole number of inches above 0`);
    return n;
  };
  const tare = blank(body.tareOz) ? 0 : Number(body.tareOz);
  if (!Number.isInteger(tare) || tare < 0) throw new Error("Box weight must be a whole number of ounces");
  const outside = { length: dim(body.lengthIn, "Length"), width: dim(body.widthIn, "Width"), height: dim(body.heightIn, "Height") };

  const insideRaw = { length: body.innerLengthIn, width: body.innerWidthIn, height: body.innerHeightIn };
  const given = Object.values(insideRaw).filter((value) => !blank(value)).length;
  if (given > 0 && given < 3) throw new Error("Give all three inside sides, or leave the inside size blank");
  const inside = (side: keyof typeof outside) => {
    if (!given) return null;
    const n = Number(insideRaw[side]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Inside ${side} must be a number of inches above 0`);
    if (n > outside[side]) throw new Error(`Inside ${side} can't be more than the outside ${side}`);
    return Math.round(n * 100) / 100;
  };
  const maxWeight = blank(body.maxWeightOz) ? null : Number(body.maxWeightOz);
  if (maxWeight !== null && (!Number.isInteger(maxWeight) || maxWeight <= tare)) {
    throw new Error("Max weight must be a whole number of ounces above the empty box weight");
  }
  return {
    name,
    lengthIn: outside.length,
    widthIn: outside.width,
    heightIn: outside.height,
    tareOz: tare,
    innerLengthIn: inside("length"),
    innerWidthIn: inside("width"),
    innerHeightIn: inside("height"),
    maxWeightOz: maxWeight,
  };
}
