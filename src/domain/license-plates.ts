/**
 * License plates: a tote, pallet, or carton with its own LP- code that groups stock in a bay. The
 * bay's `location:item` balances stay the ledger and a plate's lines are a share of them, so ATP,
 * pick plans, quick-ship, and waves never see plates. The invariant: at every bay, the units of an
 * item on plates never exceed the bay's balance of it.
 */
import { balanceKey, parseBalanceKey } from "./inventory";
import { allocateFifoLots, allocateSerials, type LotRow } from "./lots";
import { isExpiredLot, utcYyyymmdd } from "./expiry";

export const PLATE_TYPES = ["tote", "pallet", "carton"] as const;
export type PlateType = (typeof PLATE_TYPES)[number];
export const PLATE_TYPE_LABELS: Record<PlateType, string> = { tote: "Tote", pallet: "Pallet", carton: "Carton" };

export const PLATE_STATUSES = ["open", "closed", "shipped"] as const;
export type PlateStatus = (typeof PLATE_STATUSES)[number];
export const PLATE_STATUS_LABELS: Record<PlateStatus, string> = { open: "Open", closed: "Closed", shipped: "Shipped" };

export type PlateLine = {
  /** Absent until the line is saved. */
  id?: string;
  itemId: string;
  qty: number;
  lotCode: string | null;
  serial: string | null;
};

export type Plate = {
  id: string;
  code: string;
  status: PlateStatus;
  /** Null once the plate has shipped. */
  locationId: string | null;
  lines: PlateLine[];
};

export type PlateAction = "build" | "receive" | "move" | "pick" | "break" | "close" | "reopen";

const ALLOWED: Record<PlateStatus, readonly PlateAction[]> = {
  open: ["build", "receive", "move", "pick", "break", "close"],
  closed: ["move", "pick", "break", "reopen"],
  shipped: [],
};

const CODE_PREFIX = "LP-";
const CODE_DIGITS = 6;
const CODE_PATTERN = /^LP[-:](\d{1,12})$/;

export class PlateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlateInputError";
  }
}

export class PlateStateError extends Error {
  constructor(
    public plateCode: string,
    public status: PlateStatus,
    public action: PlateAction,
  ) {
    super(plateStateMessage(plateCode, status, action));
    this.name = "PlateStateError";
  }
}

/** Building past the bay's loose stock: the rest of it is on plates, in expired lots, or not there. */
export class PlateOverLooseError extends Error {
  constructor(
    public plateCode: string,
    public sku: string,
    public locationCode: string,
    public onHand: number,
    public loose: number,
    public qty: number,
    public lotCode: string | null = null,
    public expired = 0,
  ) {
    super(overLooseText(sku, locationCode, onHand, loose, qty, lotCode, expired));
    this.name = "PlateOverLooseError";
  }
}

/** Taking more from a plate than it holds. */
export class PlateShortError extends Error {
  constructor(
    public plateCode: string,
    public sku: string,
    public onPlate: number,
    public needed: number,
    public serial: string | null = null,
  ) {
    super(plateShortText(plateCode, sku, onPlate, needed, serial));
    this.name = "PlateShortError";
  }
}

export function plateStateMessage(code: string, status: PlateStatus, action: PlateAction): string {
  if (status === "shipped") return `${code} has shipped. Start a new plate.`;
  if (status === "closed") {
    return action === "close" ? `${code} is already closed. Reopen it to add stock.` : `${code} is closed. Reopen it to add stock.`;
  }
  return `${code} is already open. Scan items onto it, or close it.`;
}

/**
 * The sentence, then what is going on with the rest. `expired` is loose stock in expired lots,
 * which a build takes only by its lot, so `loose` leaves it out.
 */
export function overLooseText(
  sku: string,
  locationCode: string,
  onHand: number,
  loose: number,
  qty: number,
  lotCode: string | null = null,
  expired = 0,
): string {
  const what = lotCode ? `${sku} from lot ${lotCode}` : sku;
  if (onHand <= 0) return `${locationCode} holds no ${what}. Build the plate where the stock is.`;
  const are = loose === 1 ? "is" : "are";
  if (expired > 0) {
    if (loose <= 0) return `All the loose ${what} at ${locationCode} is in expired lots. Type the lot to put it on the plate anyway.`;
    return `Only ${loose} loose ${what} at ${locationCode} ${are} in date, and this needs ${qty}. Add ${loose} or fewer, or type the lot to add expired stock.`;
  }
  if (loose <= 0) return `No ${what} at ${locationCode} is loose. All of it is already on plates.`;
  if (onHand <= loose) return `${locationCode} holds only ${loose} ${what}, and this needs ${qty}. Add ${loose} or fewer.`;
  return `Only ${loose} ${what} at ${locationCode} ${are} loose, and this needs ${qty}. The rest is already on plates, so add ${loose} or fewer.`;
}

/** The sentence, then the fix. */
export function plateShortText(code: string, sku: string, onPlate: number, needed: number, serial: string | null = null): string {
  if (serial) return `Serial ${serial} of ${sku} is not on ${code}. Scan the bay to pick it loose.`;
  if (onPlate <= 0) return `${code} holds no ${sku}. Scan the bay to pick it loose.`;
  return `${code} holds ${onPlate} ${sku}, and this needs ${needed}. Pick ${onPlate} from it, then scan the bay for the rest.`;
}

export function canPlate(plate: Pick<Plate, "status">, action: PlateAction): boolean {
  return ALLOWED[plate.status].includes(action);
}

export function assertPlateCan(plate: Pick<Plate, "code" | "status">, action: PlateAction): void {
  if (!canPlate(plate, action)) throw new PlateStateError(plate.code, plate.status, action);
}

export function plateCode(n: number): string {
  return `${CODE_PREFIX}${String(n).padStart(CODE_DIGITS, "0")}`;
}

/** "LP-000123", "lp-123", and "LP:123" all read as LP-000123. Null when the text is not a plate code. */
export function normalizePlateCode(raw: string | null | undefined): string | null {
  const match = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "").match(CODE_PATTERN);
  if (!match) return null;
  const n = Number(match[1]);
  return n > 0 ? plateCode(n) : null;
}

export function isPlateCode(raw: string | null | undefined): boolean {
  return normalizePlateCode(raw) != null;
}

export function plateNumber(code: string): number {
  const match = code.match(CODE_PATTERN);
  return match ? Number(match[1]) : 0;
}

/** The code after the highest plate number in use. */
export function nextPlateCode(highest: number | null | undefined): string {
  return plateCode(Math.max(0, highest ?? 0) + 1);
}

export function parsePlateType(value: unknown): PlateType {
  if (value == null || value === "") return "tote";
  if (typeof value === "string" && (PLATE_TYPES as readonly string[]).includes(value)) return value as PlateType;
  throw new PlateInputError("Plate type must be tote, pallet, or carton.");
}

export function isPlateStatus(value: unknown): value is PlateStatus {
  return typeof value === "string" && (PLATE_STATUSES as readonly string[]).includes(value);
}

export function plateUnits(plate: Pick<Plate, "lines">): number {
  return plate.lines.reduce((sum, line) => sum + line.qty, 0);
}

function holding(plate: Plate): boolean {
  return plate.status !== "shipped" && plate.locationId != null;
}

export function lotKey(locationId: string, itemId: string, lotCode: string): string {
  return `${locationId}:${itemId}:${lotCode}`;
}

export function serialKey(itemId: string, serial: string): string {
  return `${itemId}:${serial}`;
}

/** Units on plates at each bay, by `location:item` balance key. A shipped plate holds none. */
export function platedByKey(plates: Plate[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const plate of plates) {
    if (!holding(plate)) continue;
    for (const line of plate.lines) {
      const key = balanceKey(plate.locationId!, line.itemId);
      totals.set(key, (totals.get(key) ?? 0) + line.qty);
    }
  }
  return totals;
}

function platedByLot(plates: Plate[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const plate of plates) {
    if (!holding(plate)) continue;
    for (const line of plate.lines) {
      if (!line.lotCode) continue;
      const key = lotKey(plate.locationId!, line.itemId, line.lotCode);
      totals.set(key, (totals.get(key) ?? 0) + line.qty);
    }
  }
  return totals;
}

export type PlateOverage = { locationId: string; itemId: string; plated: number; onHand: number };

/**
 * Each bay and item where plates claim more than the bay holds; empty when the invariant holds.
 * A key missing from `balances` is a bay holding none of that item.
 */
export function plateOverages(plates: Plate[], balances: Map<string, number>): PlateOverage[] {
  const overages: PlateOverage[] = [];
  for (const [key, plated] of platedByKey(plates)) {
    const onHand = balances.get(key) ?? 0;
    if (plated > onHand) overages.push({ ...parseBalanceKey(key), plated, onHand });
  }
  return overages;
}

/** What the bay holds of an item that is on no plate. */
export function looseQty(onHand: number, plated: number): number {
  return Math.max(0, onHand - plated);
}

/** A bay's lots of an item, less what its plates hold of each lot. */
export function looseLots<T extends { lotCode: string; qty: number }>(
  lots: T[],
  plates: Plate[],
  locationId: string,
  itemId: string,
): T[] {
  const plated = new Map<string, number>();
  for (const plate of plates) {
    if (!holding(plate) || plate.locationId !== locationId) continue;
    for (const line of plate.lines) {
      if (line.itemId !== itemId || !line.lotCode) continue;
      plated.set(line.lotCode, (plated.get(line.lotCode) ?? 0) + line.qty);
    }
  }
  return lots.map((row) => ({ ...row, qty: Math.max(0, row.qty - (plated.get(row.lotCode.trim().toUpperCase()) ?? 0)) }));
}

/** An item's serials on hand at a bay that no plate holds. */
export function looseSerials(serials: string[], plates: Plate[], itemId: string): string[] {
  const plated = new Set<string>();
  for (const plate of plates) {
    if (!holding(plate)) continue;
    for (const line of plate.lines) if (line.itemId === itemId && line.serial) plated.add(line.serial);
  }
  return serials.filter((serial) => !plated.has(serial.trim().toUpperCase()));
}

/** Units in lots still in date, and units in lots past their expiry. */
export function lotUnitsByExpiry(lots: LotRow[], asOf = utcYyyymmdd()): { live: number; expired: number } {
  let live = 0;
  let expired = 0;
  for (const row of lots) {
    if (row.qty <= 0) continue;
    if (isExpiredLot(row.expiresOn, asOf)) expired += row.qty;
    else live += row.qty;
  }
  return { live, expired };
}

function liveUnits(lots: LotRow[]): number {
  return lotUnitsByExpiry(lots).live;
}

/**
 * FIFO lots for taking `qty` of an item from a bay: every loose lot first, and only the shortfall
 * from lots on plates. Without plates it is plain FIFO, refusals included.
 */
export function allocateLooseFirstLots(
  lots: LotRow[],
  plates: Plate[],
  locationId: string,
  itemId: string,
  qty: number,
  sku: string,
): LotRow[] {
  const loose = looseLots(lots, plates, locationId, itemId);
  const fromLoose = liveUnits(loose);
  if (fromLoose >= qty) return allocateFifoLots(loose, qty, sku);
  if (fromLoose === 0 || liveUnits(lots) < qty) return allocateFifoLots(lots, qty, sku);
  const first = allocateFifoLots(loose, fromLoose, sku);
  const taken = new Map(first.map((row) => [row.lotCode, row.qty]));
  const rest = lots.map((row) => ({ ...row, qty: row.qty - (taken.get(row.lotCode.trim().toUpperCase()) ?? 0) }));
  const merged = new Map<string, LotRow>();
  for (const row of [...first, ...allocateFifoLots(rest, qty - fromLoose, sku)]) {
    const prior = merged.get(row.lotCode);
    if (prior) prior.qty += row.qty;
    else merged.set(row.lotCode, { ...row });
  }
  return [...merged.values()];
}

/** Serials for taking `qty` of an item from a bay: loose ones first, then the ones on plates. */
export function allocateLooseFirstSerials(serials: string[], plates: Plate[], itemId: string, qty: number, sku: string): string[] {
  const loose = looseSerials(serials, plates, itemId);
  if (loose.length >= qty) return allocateSerials(loose, qty, sku);
  if (loose.length === 0 || serials.length < qty) return allocateSerials(serials, qty, sku);
  const plated = serials.filter((serial) => !loose.includes(serial));
  return [...allocateSerials(loose, loose.length, sku), ...allocateSerials(plated, qty - loose.length, sku)];
}

/** A bay's balances split into what is on plates and what is loose. */
export function withPlateShare<T extends { itemId: string; qty: number }>(
  rows: T[],
  plates: Plate[],
  locationId: string,
): (T & { onPlates: number; loose: number })[] {
  const plated = platedByKey(plates.filter((plate) => plate.locationId === locationId));
  return rows.map((row) => {
    const onPlates = Math.min(row.qty, plated.get(balanceKey(locationId, row.itemId)) ?? 0);
    return { ...row, onPlates, loose: looseQty(row.qty, onPlates) };
  });
}

export type PlateOp =
  | { kind: "add"; plateId: string; itemId: string; qty: number; lotCode?: string | null; serials?: string[] | null }
  | { kind: "take"; plateId: string; itemId: string; qty: number; lotCode?: string | null; serials?: string[] | null }
  | { kind: "relocate"; plateId: string; locationId: string }
  | { kind: "empty"; plateId: string }
  | { kind: "status"; plateId: string; status: PlateStatus };

function cleanLot(lotCode: string | null | undefined): string | null {
  const code = lotCode?.trim().toUpperCase();
  return code ? code : null;
}

function cleanSerials(serials: string[] | null | undefined): string[] {
  return (serials ?? []).map((serial) => serial.trim().toUpperCase()).filter(Boolean);
}

function requireUnits(qty: number): void {
  if (!Number.isInteger(qty) || qty <= 0) throw new PlateInputError("Qty must be a whole number of 1 or more.");
}

function copyPlate(plate: Plate): Plate {
  return { ...plate, lines: plate.lines.map((line) => ({ ...line })) };
}

function addLines(plate: Plate, op: Extract<PlateOp, { kind: "add" }>, book: Plate[]): void {
  requireUnits(op.qty);
  const lotCode = cleanLot(op.lotCode);
  const serials = cleanSerials(op.serials);
  if (serials.length === 0) {
    const same = plate.lines.find((line) => line.itemId === op.itemId && line.lotCode === lotCode && line.serial == null);
    if (same) same.qty += op.qty;
    else plate.lines.push({ itemId: op.itemId, qty: op.qty, lotCode, serial: null });
    return;
  }
  if (serials.length !== op.qty) throw new PlateInputError(`Scan ${op.qty} serial numbers, one for each unit.`);
  for (const serial of serials) {
    const holder = book.find(
      (other) => holding(other) && other.lines.some((line) => line.itemId === op.itemId && line.serial === serial),
    );
    if (holder) throw new PlateInputError(`Serial ${serial} is already on ${holder.code}.`);
    plate.lines.push({ itemId: op.itemId, qty: 1, lotCode, serial });
  }
}

/** Takes up to `qty`: the serials it names, then the oldest lines of the lot or item. */
function takeLines(plate: Plate, op: Extract<PlateOp, { kind: "take" }>): void {
  requireUnits(op.qty);
  const lotCode = cleanLot(op.lotCode);
  const serials = cleanSerials(op.serials);
  let left = op.qty;
  for (const serial of serials) {
    const index = plate.lines.findIndex((line) => line.itemId === op.itemId && line.serial === serial);
    if (index < 0 || left <= 0) continue;
    plate.lines.splice(index, 1);
    left -= 1;
  }
  for (const line of plate.lines) {
    if (left <= 0) break;
    if (line.itemId !== op.itemId || (lotCode && line.lotCode !== lotCode) || (serials.length > 0 && line.serial)) continue;
    const cut = Math.min(left, line.qty);
    line.qty -= cut;
    left -= cut;
  }
  plate.lines = plate.lines.filter((line) => line.qty > 0);
}

/** The plates after `ops`, in the same order. Ops on a plate not in `plates` are refused. */
export function applyPlateOps(plates: Plate[], ops: PlateOp[]): Plate[] {
  const next = plates.map(copyPlate);
  const byId = new Map(next.map((plate) => [plate.id, plate]));
  for (const op of ops) {
    const plate = byId.get(op.plateId);
    if (!plate) throw new PlateInputError("That plate was not found.");
    switch (op.kind) {
      case "add":
        assertPlateCan(plate, "build");
        addLines(plate, op, next);
        break;
      case "take":
        assertPlateCan(plate, "pick");
        takeLines(plate, op);
        break;
      case "relocate":
        assertPlateCan(plate, "move");
        plate.locationId = op.locationId;
        break;
      case "empty":
        assertPlateCan(plate, "break");
        plate.lines = [];
        break;
      case "status":
        if (op.status === "closed") assertPlateCan(plate, "close");
        if (op.status === "open" && plate.status !== "open") assertPlateCan(plate, "reopen");
        plate.status = op.status;
        if (op.status === "shipped") plate.locationId = null;
        break;
    }
  }
  return next;
}

/** Open plates give stock up before closed ones, and the newest plate first. */
function giveUpOrder(a: Plate, b: Plate): number {
  const rank = (plate: Plate) => (plate.status === "open" ? 0 : 1);
  return rank(a) - rank(b) || plateNumber(b.code) - plateNumber(a.code);
}

function shrinkTo(plates: Plate[], limits: Map<string, number>, keyOf: (plate: Plate, line: PlateLine) => string | null): void {
  const plated = new Map<string, number>();
  for (const plate of plates) {
    if (!holding(plate)) continue;
    for (const line of plate.lines) {
      const key = keyOf(plate, line);
      if (key) plated.set(key, (plated.get(key) ?? 0) + line.qty);
    }
  }
  const excess = new Map<string, number>();
  for (const [key, qty] of plated) {
    const limit = Math.max(0, limits.get(key) ?? 0);
    if (qty > limit) excess.set(key, qty - limit);
  }
  if (excess.size === 0) return;
  for (const plate of plates.filter(holding).sort(giveUpOrder)) {
    for (let index = plate.lines.length - 1; index >= 0; index -= 1) {
      const line = plate.lines[index]!;
      const key = keyOf(plate, line);
      const over = key ? (excess.get(key) ?? 0) : 0;
      if (over <= 0) continue;
      const cut = Math.min(over, line.qty);
      line.qty -= cut;
      excess.set(key!, over - cut);
    }
    plate.lines = plate.lines.filter((line) => line.qty > 0);
  }
}

/** The stock ledger once a plan posts, as the plates at its bays see it. */
export type PlateLedger = {
  /** Every balance the plates sit on, by `location:item`. A missing key holds none. */
  balances: Map<string, number>;
  /** Every lot balance the plates' lot lines sit on, by `location:item:lot`. A missing key holds none. */
  lots?: Map<string, number>;
  /** Where each serial the plan moved ended up, by `item:serial`; null once it left the building. */
  serials?: Map<string, string | null>;
  /** Bays a pick took stock from. A closed plate a pick emptied has shipped. */
  pickedFrom?: Set<string>;
};

/**
 * Plates after the ledger moved under them. Stock that left a bay comes off its loose units first;
 * only a shortfall comes off plates, open plates before closed ones and the newest first.
 */
export function reconcilePlates(plates: Plate[], ledger: PlateLedger): Plate[] {
  const next = plates.map(copyPlate);
  const serials = ledger.serials;
  if (serials && serials.size > 0) {
    for (const plate of next) {
      if (!holding(plate)) continue;
      plate.lines = plate.lines.filter((line) => {
        if (!line.serial) return true;
        const key = serialKey(line.itemId, line.serial);
        return !serials.has(key) || serials.get(key) === plate.locationId;
      });
    }
  }
  if (ledger.lots) {
    shrinkTo(next, ledger.lots, (plate, line) => (line.lotCode ? lotKey(plate.locationId!, line.itemId, line.lotCode) : null));
  }
  shrinkTo(next, ledger.balances, (plate, line) => balanceKey(plate.locationId!, line.itemId));
  return next;
}

export type PlateNames = { skus?: Map<string, string>; bays?: Map<string, string> };

/**
 * Applies `ops` and reconciles the plates with the ledger after a plan. Refuses an add or a relocate
 * that would put more on plates than the bay holds loose. A closed plate a pick emptied has shipped.
 */
export function settlePlates(plates: Plate[], ops: PlateOp[], ledger: PlateLedger, names: PlateNames = {}): Plate[] {
  const applied = applyPlateOps(plates, ops);
  assertOpsFit(plates, applied, ops, ledger, names);
  const reconciled = reconcilePlates(applied, ledger);
  return reconciled.map((plate, index) => {
    const before = plates[index]!;
    const emptied = before.lines.length > 0 && plate.lines.length === 0;
    if (plate.status === "closed" && emptied && plate.locationId && ledger.pickedFrom?.has(plate.locationId)) {
      return { ...plate, status: "shipped" as const, locationId: null };
    }
    return plate;
  });
}

function assertOpsFit(before: Plate[], after: Plate[], ops: PlateOp[], ledger: PlateLedger, names: PlateNames): void {
  const touched = new Set(ops.filter((op) => op.kind === "add" || op.kind === "relocate").map((op) => op.plateId));
  if (touched.size === 0) return;
  const addedByKey = new Map<string, { qty: number; plateId: string }>();
  const addedByLot = new Map<string, { qty: number; plateId: string }>();
  const byId = new Map(after.map((plate) => [plate.id, plate]));
  for (const op of ops) {
    if (op.kind !== "add") continue;
    const locationId = byId.get(op.plateId)?.locationId;
    if (!locationId) continue;
    const key = balanceKey(locationId, op.itemId);
    addedByKey.set(key, { qty: (addedByKey.get(key)?.qty ?? 0) + op.qty, plateId: op.plateId });
    const lot = cleanLot(op.lotCode);
    if (lot) {
      const lk = lotKey(locationId, op.itemId, lot);
      addedByLot.set(lk, { qty: (addedByLot.get(lk)?.qty ?? 0) + op.qty, plateId: op.plateId });
    }
  }
  const codeOf = (plateId: string) => byId.get(plateId)?.code ?? before.find((plate) => plate.id === plateId)?.code ?? "A plate";
  const plated = platedByKey(after);
  for (const plate of after) {
    if (!touched.has(plate.id) || !holding(plate)) continue;
    for (const line of plate.lines) {
      const key = balanceKey(plate.locationId!, line.itemId);
      const onHand = ledger.balances.get(key) ?? 0;
      const total = plated.get(key) ?? 0;
      if (total <= onHand) continue;
      const added = addedByKey.get(key);
      throw new PlateOverLooseError(
        codeOf(added?.plateId ?? plate.id),
        names.skus?.get(line.itemId) ?? "this SKU",
        names.bays?.get(plate.locationId!) ?? "this bay",
        onHand,
        looseQty(onHand, total - (added?.qty ?? 0)),
        added?.qty ?? total,
      );
    }
  }
  if (!ledger.lots) return;
  const lotPlated = platedByLot(after);
  for (const [key, added] of addedByLot) {
    const onHand = ledger.lots.get(key) ?? 0;
    const total = lotPlated.get(key) ?? 0;
    if (total <= onHand) continue;
    const [locationId, itemId, lotCode] = splitLotKey(key);
    throw new PlateOverLooseError(
      codeOf(added.plateId),
      names.skus?.get(itemId) ?? "this SKU",
      names.bays?.get(locationId) ?? "this bay",
      onHand,
      looseQty(onHand, total - added.qty),
      added.qty,
      lotCode,
    );
  }
}

function splitLotKey(key: string): [string, string, string] {
  const first = key.indexOf(":");
  const second = key.indexOf(":", first + 1);
  return [key.slice(0, first), key.slice(first + 1, second), key.slice(second + 1)];
}

/** Ops that put received stock straight onto a plate. An empty plate comes to the receiving bay. */
export function receiveOntoPlate(
  plate: Plate,
  locationId: string,
  lines: { itemId: string; qty: number; lotCode?: string | null; serials?: string[] | null }[],
): PlateOp[] {
  const ops: PlateOp[] = plate.locationId === locationId ? [] : [{ kind: "relocate", plateId: plate.id, locationId }];
  for (const line of lines) {
    if (line.qty <= 0) continue;
    ops.push({
      kind: "add",
      plateId: plate.id,
      itemId: line.itemId,
      qty: line.qty,
      lotCode: line.lotCode ?? null,
      serials: line.serials?.length ? line.serials : null,
    });
  }
  return ops;
}

export type PlateMoveLine = { itemId: string; lotCode: string | null; qty: number; serials: string[] | null };

/** The ledger moves a plate needs to go somewhere: one per item and lot, with its serials together. */
export function plateMoveLines(lines: PlateLine[]): PlateMoveLine[] {
  const groups = new Map<string, PlateMoveLine>();
  for (const line of lines) {
    const key = `${line.itemId}|${line.lotCode ?? ""}|${line.serial ? "serial" : ""}`;
    const group = groups.get(key) ?? { itemId: line.itemId, lotCode: line.lotCode, qty: 0, serials: line.serial ? [] : null };
    group.qty += line.qty;
    if (line.serial) group.serials!.push(line.serial);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export type PlateWant = { itemId: string; sku: string; qty: number; lotCode?: string | null; serials?: string[] | null };

/** One slice of a pick that comes off a plate, with the lot and serials it carries. */
export type PlatePiece = { want: number; qty: number; lotCode: string | null; serials: string[] | null };

/**
 * How a pick comes off one plate, want by want: the serials or lot each names, else the plate's
 * oldest lines first. Refuses a want the plate cannot cover, since a plate scan means it all
 * comes off that plate.
 */
export function drawFromPlate(plate: Plate, wants: PlateWant[]): PlatePiece[] {
  assertPlateCan(plate, "pick");
  const lines = plate.lines.map((line) => ({ ...line }));
  const pieces: PlatePiece[] = [];
  const push = (want: number, qty: number, lotCode: string | null, serial: string | null) => {
    const last = pieces[pieces.length - 1];
    if (last && last.want === want && last.lotCode === lotCode && (last.serials != null) === (serial != null)) {
      last.qty += qty;
      if (serial) last.serials!.push(serial);
      return;
    }
    pieces.push({ want, qty, lotCode, serials: serial ? [serial] : null });
  };
  wants.forEach((want, index) => {
    requireUnits(want.qty);
    const lotCode = cleanLot(want.lotCode);
    const serials = cleanSerials(want.serials);
    const onPlate = lines
      .filter((line) => line.itemId === want.itemId && (!lotCode || line.lotCode === lotCode))
      .reduce((sum, line) => sum + line.qty, 0);
    let left = want.qty;
    for (const serial of serials) {
      const line = lines.find((row) => row.itemId === want.itemId && row.serial === serial && row.qty > 0);
      if (!line) throw new PlateShortError(plate.code, want.sku, onPlate, want.qty, serial);
      line.qty = 0;
      push(index, 1, line.lotCode, serial);
      left -= 1;
    }
    for (const line of lines) {
      if (left <= 0) break;
      if (line.qty <= 0 || line.itemId !== want.itemId || (lotCode && line.lotCode !== lotCode)) continue;
      if (serials.length > 0 && line.serial) continue;
      const cut = Math.min(left, line.qty);
      line.qty -= cut;
      left -= cut;
      if (line.serial) push(index, 1, line.lotCode, line.serial);
      else push(index, cut, line.lotCode, null);
    }
    if (left > 0) throw new PlateShortError(plate.code, want.sku, onPlate, want.qty);
  });
  return pieces;
}
