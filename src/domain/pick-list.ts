import { formatExpiresOn, isExpiredLot } from "./expiry";
import { allocateFifoLots } from "./lots";
import { buildPickMapStops, type PickMapLocation } from "./pick-map";
import { fromStockQty } from "./uom";

export type PickListLineInput = {
  lineId: string;
  orderId?: string;
  orderNumber?: string;
  sku: string;
  itemName: string;
  barcode?: string | null;
  qtyOrdered: number;
  qtyPicked: number;
  remaining: number;
  suggestedLocation?: { locationId: string; locationCode: string } | null;
  allocations?: { locationId: string; locationCode: string; qty: number }[] | null;
  trackLot?: boolean;
  trackSerial?: boolean;
  catchWeight?: boolean;
  trackExpiry?: boolean;
  stockUom?: string | null;
  altUom?: string | null;
  altPerStock?: number | null;
};

export type PickListLocation = PickMapLocation & {
  barcode?: string | null;
  zoneId?: string | null;
  zoneName?: string | null;
};

export type PickListLot = {
  locationId: string;
  sku: string;
  lotCode: string;
  qty: number;
  expiresOn?: number | null;
};

export type PickListLotPick = {
  lotCode: string;
  qty: number;
  expiresOn: number | null;
  expiresOnLabel: string | null;
};

export type PickListOrderSplit = {
  orderNumber: string;
  qty: number;
};

export type PickListSkuRow = {
  lineId: string;
  sku: string;
  itemName: string;
  barcode: string;
  pickQty: number;
  qtyOrdered: number;
  qtyPicked: number;
  provenance: "allocated" | "suggested";
  trackLot: boolean;
  trackSerial: boolean;
  catchWeight: boolean;
  trackExpiry: boolean;
  stockUom: string | null;
  altUom: string | null;
  altPerStock: number | null;
  uomLabel: string | null;
  lots: PickListLotPick[];
  orderSplits: PickListOrderSplit[];
};

export type PickListStop = {
  step: number;
  locationId: string;
  locationCode: string;
  locationBarcode: string;
  aisle: string | null;
  rack: string | null;
  bay: string | null;
  level: number;
  zoneName: string | null;
  address: string;
  provenance: "allocated" | "suggested" | "mixed";
  qty: number;
  skus: PickListSkuRow[];
};

export type PickListUnlocated = {
  lineId: string;
  sku: string;
  itemName: string;
  remaining: number;
  orderNumber?: string;
};

export type PickListPicked = {
  lineId: string;
  sku: string;
  itemName: string;
  qtyPicked: number;
  qtyOrdered: number;
  orderNumber?: string;
};

export type ReservationNote = "allocated" | "suggested" | "mixed" | "none";

export type OrderPickListDocument = {
  kind: "order";
  number: string;
  customerName: string;
  shopifyOrderName: string | null;
  shipTo: string | null;
  source: string | null;
  status: string;
  warehouseName: string | null;
  waveNumber: string | null;
  zoneName: string | null;
  clientCode: string | null;
  pickerName: string | null;
  remainingUnits: number;
  remainingLines: number;
  stopCount: number;
  walkStrip: string;
  reservationNote: ReservationNote;
  stops: PickListStop[];
  unlocated: PickListUnlocated[];
  alreadyPicked: PickListPicked[];
};

export type WavePickListDocument = {
  kind: "wave";
  number: string;
  mode: string;
  status: string;
  zoneName: string | null;
  clientCode: string | null;
  notes: string | null;
  remainingUnits: number;
  remainingLines: number;
  stopCount: number;
  walkStrip: string;
  orders: OrderPickListDocument[];
  stops: PickListStop[];
  unlocated: PickListUnlocated[];
  alreadyPicked: PickListPicked[];
};

export function formatShipToIdentity(order: {
  shipToCity?: string | null;
  shipToRegion?: string | null;
  shipToCountry?: string | null;
  shipToAddress?: string | null;
}): string | null {
  const parts = [order.shipToCity, order.shipToRegion, order.shipToCountry]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (parts.length) return parts.join(", ");
  const line = order.shipToAddress
    ?.split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return line || null;
}

export function formatLocationAddress(location: {
  aisle?: string | null;
  rack?: string | null;
  bay?: string | null;
  level?: number;
}): string {
  const bits: string[] = [];
  if (location.aisle) bits.push(`Aisle ${location.aisle}`);
  if (location.rack) bits.push(`Rack ${location.rack}`);
  if (location.bay) bits.push(`Bay ${location.bay}`);
  bits.push(`L${location.level ?? 1}`);
  return bits.join(" · ");
}

export function formatWalkStrip(codes: string[]): string {
  return codes.filter(Boolean).join(" → ");
}

export function formatPickUom(
  qty: number,
  stockUom?: string | null,
  altUom?: string | null,
  altPerStock?: number | null,
): string | null {
  const stock = (stockUom || "ea").trim() || "ea";
  const altQty = fromStockQty(qty, altPerStock);
  if (altQty != null && altUom?.trim()) {
    return `${qty} ${stock} · ${altQty} ${altUom.trim()}`;
  }
  return null;
}

export function reservationCopy(note: ReservationNote): string | null {
  if (note === "allocated") return "Reserved at these bays.";
  if (note === "suggested") return "Suggested pick face — start pick to reserve ATP.";
  if (note === "mixed") return "Reserved where allocated; suggested pick face for the rest.";
  return null;
}

export function pickLotsAtBay(
  lots: PickListLot[],
  locationId: string,
  sku: string,
  qty: number,
): PickListLotPick[] {
  const atBay = lots.filter((row) => row.locationId === locationId && row.sku === sku && row.qty > 0);
  if (!atBay.length || qty <= 0) return [];
  try {
    return allocateFifoLots(atBay, qty, sku).map(asLotPick);
  } catch {
    const live = atBay
      .filter((row) => !isExpiredLot(row.expiresOn))
      .sort((a, b) => {
        const ae = a.expiresOn ?? Number.MAX_SAFE_INTEGER;
        const be = b.expiresOn ?? Number.MAX_SAFE_INTEGER;
        return ae - be || a.lotCode.localeCompare(b.lotCode);
      });
    const picked: PickListLotPick[] = [];
    let remaining = qty;
    for (const row of live) {
      if (remaining <= 0) break;
      const take = Math.min(row.qty, remaining);
      picked.push(asLotPick({ lotCode: row.lotCode, qty: take, expiresOn: row.expiresOn }));
      remaining -= take;
    }
    return picked;
  }
}

function asLotPick(row: { lotCode: string; qty: number; expiresOn?: number | null }): PickListLotPick {
  return {
    lotCode: row.lotCode,
    qty: row.qty,
    expiresOn: row.expiresOn ?? null,
    expiresOnLabel: row.expiresOn != null ? formatExpiresOn(row.expiresOn) : null,
  };
}

function lineProvenance(line: PickListLineInput, locationId: string): "allocated" | "suggested" {
  const allocated = (line.allocations ?? []).some((row) => row.locationId === locationId && row.qty > 0);
  return allocated ? "allocated" : "suggested";
}

function stopProvenance(skus: PickListSkuRow[]): PickListStop["provenance"] {
  const kinds = new Set(skus.map((row) => row.provenance));
  if (kinds.size === 1) return [...kinds][0] ?? "suggested";
  return "mixed";
}

function reservationFromStops(stops: PickListStop[]): ReservationNote {
  if (!stops.length) return "none";
  const kinds = new Set(stops.flatMap((stop) => stop.skus.map((row) => row.provenance)));
  if (kinds.size === 1) return [...kinds][0] ?? "none";
  return "mixed";
}

function alreadyPickedRows(lines: PickListLineInput[]): PickListPicked[] {
  return lines
    .filter((line) => line.remaining <= 0 && line.qtyPicked > 0)
    .map((line) => ({
      lineId: line.lineId,
      sku: line.sku,
      itemName: line.itemName,
      qtyPicked: line.qtyPicked,
      qtyOrdered: line.qtyOrdered,
      orderNumber: line.orderNumber,
    }));
}

function skuRow(
  line: PickListLineInput,
  locationId: string,
  pickQty: number,
  lots: PickListLot[],
): PickListSkuRow {
  return {
    lineId: line.lineId,
    sku: line.sku,
    itemName: line.itemName,
    barcode: (line.barcode || line.sku).trim() || line.sku,
    pickQty,
    qtyOrdered: line.qtyOrdered,
    qtyPicked: line.qtyPicked,
    provenance: lineProvenance(line, locationId),
    trackLot: Boolean(line.trackLot),
    trackSerial: Boolean(line.trackSerial),
    catchWeight: Boolean(line.catchWeight),
    trackExpiry: Boolean(line.trackExpiry),
    stockUom: line.stockUom ?? null,
    altUom: line.altUom ?? null,
    altPerStock: line.altPerStock ?? null,
    uomLabel: formatPickUom(pickQty, line.stockUom, line.altUom, line.altPerStock),
    lots: line.trackLot ? pickLotsAtBay(lots, locationId, line.sku, pickQty) : [],
    orderSplits: line.orderNumber ? [{ orderNumber: line.orderNumber, qty: pickQty }] : [],
  };
}

function mergeSkuRows(rows: PickListSkuRow[], locationId: string, lots: PickListLot[]): PickListSkuRow[] {
  const grouped = new Map<string, PickListSkuRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.sku) ?? [];
    list.push(row);
    grouped.set(row.sku, list);
  }
  return [...grouped.values()].map((group) => {
    const first = group[0]!;
    if (group.length === 1) return first;
    const pickQty = group.reduce((sum, row) => sum + row.pickQty, 0);
    const splits = new Map<string, number>();
    for (const row of group) {
      for (const split of row.orderSplits) {
        splits.set(split.orderNumber, (splits.get(split.orderNumber) ?? 0) + split.qty);
      }
    }
    return {
      ...first,
      pickQty,
      qtyOrdered: group.reduce((sum, row) => sum + row.qtyOrdered, 0),
      qtyPicked: group.reduce((sum, row) => sum + row.qtyPicked, 0),
      provenance: group.some((row) => row.provenance === "allocated") ? "allocated" : "suggested",
      uomLabel: formatPickUom(pickQty, first.stockUom, first.altUom, first.altPerStock),
      lots: first.trackLot ? pickLotsAtBay(lots, locationId, first.sku, pickQty) : [],
      orderSplits: [...splits.entries()].map(([orderNumber, qty]) => ({ orderNumber, qty })),
    };
  });
}

function decorateStops(
  lines: PickListLineInput[],
  locations: PickListLocation[],
  lots: PickListLot[],
  mergeSku: boolean,
): { stops: PickListStop[]; unlocated: PickListUnlocated[] } {
  const byId = new Map(lines.map((line) => [line.lineId, line]));
  const plan = buildPickMapStops(
    lines.map((line) => ({
      lineId: line.lineId,
      sku: line.sku,
      remaining: line.remaining,
      suggestedLocation: line.suggestedLocation,
      allocations: line.allocations,
    })),
    locations,
  );

  const locById = new Map(locations.map((row) => [row.id, row]));
  const stops = plan.stops.map((stop) => {
    const location = locById.get(stop.locationId);
    const rows = stop.skus
      .map((grab) => {
        const line = byId.get(grab.lineId);
        if (!line) return null;
        return skuRow(line, stop.locationId, grab.qty, lots);
      })
      .filter((row): row is PickListSkuRow => Boolean(row));
    const skus = mergeSku ? mergeSkuRows(rows, stop.locationId, lots) : rows;
    return {
      step: stop.step,
      locationId: stop.locationId,
      locationCode: stop.locationCode,
      locationBarcode: location?.barcode || stop.locationCode,
      aisle: stop.aisle,
      rack: stop.rack,
      bay: stop.bay,
      level: stop.level,
      zoneName: location?.zoneName ?? null,
      address: formatLocationAddress(stop),
      provenance: stopProvenance(skus),
      qty: skus.reduce((sum, row) => sum + row.pickQty, 0),
      skus,
    };
  });

  const unlocated = plan.unlocated.map((row) => {
    const line = byId.get(row.lineId);
    return {
      lineId: row.lineId,
      sku: row.sku,
      itemName: line?.itemName ?? row.sku,
      remaining: row.remaining,
      orderNumber: line?.orderNumber,
    };
  });

  return { stops, unlocated };
}

export type OrderPickListInput = {
  number: string;
  customerName: string;
  status: string;
  source?: string | null;
  shopifyOrderName?: string | null;
  shipToCity?: string | null;
  shipToRegion?: string | null;
  shipToCountry?: string | null;
  shipToAddress?: string | null;
  lines: PickListLineInput[];
};

export function buildOrderPickList(input: {
  order: OrderPickListInput;
  locations: PickListLocation[];
  lots?: PickListLot[];
  warehouseName?: string | null;
  waveNumber?: string | null;
  zoneName?: string | null;
  clientCode?: string | null;
  pickerName?: string | null;
}): OrderPickListDocument {
  const lots = input.lots ?? [];
  const { stops, unlocated } = decorateStops(input.order.lines, input.locations, lots, false);
  const remainingLines = input.order.lines.filter((line) => line.remaining > 0);
  return {
    kind: "order",
    number: input.order.number,
    customerName: input.order.customerName,
    shopifyOrderName: input.order.shopifyOrderName ?? null,
    shipTo: formatShipToIdentity(input.order),
    source: input.order.source ?? null,
    status: input.order.status,
    warehouseName: input.warehouseName ?? null,
    waveNumber: input.waveNumber ?? null,
    zoneName: input.zoneName ?? null,
    clientCode: input.clientCode ?? null,
    pickerName: input.pickerName ?? null,
    remainingUnits: remainingLines.reduce((sum, line) => sum + line.remaining, 0),
    remainingLines: remainingLines.length,
    stopCount: stops.length,
    walkStrip: formatWalkStrip(stops.map((stop) => stop.locationCode)),
    reservationNote: reservationFromStops(stops),
    stops,
    unlocated,
    alreadyPicked: alreadyPickedRows(input.order.lines),
  };
}

export function buildWavePickList(input: {
  wave: { number: string; mode: string; status: string; notes?: string | null };
  orders: OrderPickListInput[];
  locations: PickListLocation[];
  lots?: PickListLot[];
  zoneName?: string | null;
  clientCode?: string | null;
}): WavePickListDocument {
  const lots = input.lots ?? [];
  const withNumbers = input.orders.map((order) => ({
    ...order,
    lines: order.lines.map((line) => ({
      ...line,
      orderId: line.orderId ?? order.number,
      orderNumber: line.orderNumber ?? order.number,
    })),
  }));

  if (input.wave.mode === "batch") {
    const lines = withNumbers.flatMap((order) => order.lines);
    const { stops, unlocated } = decorateStops(lines, input.locations, lots, true);
    return {
      kind: "wave",
      number: input.wave.number,
      mode: input.wave.mode,
      status: input.wave.status,
      zoneName: input.zoneName ?? null,
      clientCode: input.clientCode ?? null,
      notes: input.wave.notes ?? null,
      remainingUnits: lines.filter((line) => line.remaining > 0).reduce((sum, line) => sum + line.remaining, 0),
      remainingLines: new Set(lines.filter((line) => line.remaining > 0).map((line) => line.sku)).size,
      stopCount: stops.length,
      walkStrip: formatWalkStrip(stops.map((stop) => stop.locationCode)),
      orders: [],
      stops,
      unlocated,
      alreadyPicked: alreadyPickedRows(lines),
    };
  }

  const orders = withNumbers.map((order) =>
    buildOrderPickList({
      order,
      locations: input.locations,
      lots,
      waveNumber: input.wave.number,
      zoneName: input.zoneName,
      clientCode: input.clientCode,
    }),
  );
  const combined = decorateStops(
    withNumbers.flatMap((order) => order.lines),
    input.locations,
    lots,
    false,
  );
  return {
    kind: "wave",
    number: input.wave.number,
    mode: input.wave.mode,
    status: input.wave.status,
    zoneName: input.zoneName ?? null,
    clientCode: input.clientCode ?? null,
    notes: input.wave.notes ?? null,
    remainingUnits: orders.reduce((sum, order) => sum + order.remainingUnits, 0),
    remainingLines: orders.reduce((sum, order) => sum + order.remainingLines, 0),
    stopCount: orders.reduce((sum, order) => sum + order.stopCount, 0),
    walkStrip: formatWalkStrip(combined.stops.map((stop) => stop.locationCode)),
    orders,
    stops: [],
    unlocated: orders.flatMap((order) =>
      order.unlocated.map((row) => ({ ...row, orderNumber: row.orderNumber ?? order.number })),
    ),
    alreadyPicked: orders.flatMap((order) =>
      order.alreadyPicked.map((row) => ({ ...row, orderNumber: row.orderNumber ?? order.number })),
    ),
  };
}
