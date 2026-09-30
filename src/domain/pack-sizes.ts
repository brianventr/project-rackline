/**
 * Pack sizes: the inner, case, and pallet an item comes in. Stock is always counted in eaches; a pack
 * is a multiple with its own barcode, so scanning a case label counts the case's eaches.
 */
import { normalizeBarcode } from "./barcodes";

export const PACK_LEVELS = ["inner", "case", "pallet"] as const;
export type PackLevel = (typeof PACK_LEVELS)[number];

export const PACK_LABELS: Record<PackLevel, string> = { inner: "Inner", case: "Case", pallet: "Pallet" };

export type PackSize = {
  level: PackLevel;
  /** Eaches in one pack. */
  qty: number;
  barcode: string | null;
  weightOz: number | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
};

export class PackSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackSizeError";
  }
}

export function isPackLevel(value: unknown): value is PackLevel {
  return typeof value === "string" && (PACK_LEVELS as readonly string[]).includes(value);
}

const MAX_PACK_QTY = 1_000_000;

function measure(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) throw new PackSizeError(`${label} must be a whole number, 0 or more`);
  return n || null;
}

/**
 * Checks an item's pack levels and puts them in inner → case → pallet order. Each level holds at
 * least 2 eaches and a whole number of the level below it (a case of 24 holds inners of 6, not 5).
 */
export function normalizePackSizes(rows: unknown): PackSize[] {
  if (!Array.isArray(rows)) throw new PackSizeError("Pack sizes must be a list");
  const byLevel = new Map<PackLevel, PackSize>();
  for (const raw of rows as Record<string, unknown>[]) {
    const level = typeof raw?.level === "string" ? raw.level.trim().toLowerCase() : raw?.level;
    if (!isPackLevel(level)) throw new PackSizeError("Pack level must be inner, case, or pallet");
    const label = PACK_LABELS[level];
    if (byLevel.has(level)) throw new PackSizeError(`Only one ${level} size per item`);
    const qty = typeof raw.qty === "number" ? raw.qty : Number(String(raw.qty ?? "").trim());
    if (!Number.isInteger(qty) || qty < 2 || qty > MAX_PACK_QTY) {
      throw new PackSizeError(`${label} qty must be a whole number of eaches, 2 or more`);
    }
    const barcode = typeof raw.barcode === "string" && raw.barcode.trim() ? normalizeBarcode(raw.barcode) : null;
    if (barcode && barcode.length > 64) throw new PackSizeError(`${label} barcode is too long`);
    byLevel.set(level, {
      level,
      qty,
      barcode,
      weightOz: measure(raw.weightOz, `${label} weight`),
      lengthIn: measure(raw.lengthIn, `${label} length`),
      widthIn: measure(raw.widthIn, `${label} width`),
      heightIn: measure(raw.heightIn, `${label} height`),
    });
  }
  const ordered = PACK_LEVELS.flatMap((level) => (byLevel.has(level) ? [byLevel.get(level)!] : []));
  for (let i = 1; i < ordered.length; i += 1) {
    const below = ordered[i - 1]!;
    const pack = ordered[i]!;
    if (pack.qty <= below.qty || pack.qty % below.qty !== 0) {
      throw new PackSizeError(
        `A ${pack.level} of ${pack.qty} must hold whole ${below.level === "inner" ? "inners" : "cases"} of ${below.qty}`,
      );
    }
  }
  const seen = new Map<string, PackLevel>();
  for (const pack of ordered) {
    if (!pack.barcode) continue;
    const other = seen.get(pack.barcode);
    if (other) throw new PackSizeError(`The ${other} and ${pack.level} cannot share barcode ${pack.barcode}`);
    seen.set(pack.barcode, pack.level);
  }
  return ordered;
}

/**
 * The item's single alternate unit (what `altQty` on ASN and order lines converts with) after its
 * packs change. An alt unit named for a pack level follows that level; with none set, the case
 * becomes the alt unit. A custom alt unit ("roll", "box") is left alone. Null means no change.
 */
export function syncedAltUnit(
  current: { altUom: string | null; altPerStock: number | null },
  packs: PackSize[],
): { altUom: string | null; altPerStock: number | null } | null {
  const name = current.altUom?.trim().toLowerCase() || null;
  const casePack = packs.find((pack) => pack.level === "case");
  let next: { altUom: string | null; altPerStock: number | null } | null = null;
  if (name && isPackLevel(name)) {
    const same = packs.find((pack) => pack.level === name);
    next = same
      ? { altUom: name, altPerStock: same.qty }
      : casePack
        ? { altUom: "case", altPerStock: casePack.qty }
        : { altUom: null, altPerStock: null };
  } else if (!name && casePack) {
    next = { altUom: "case", altPerStock: casePack.qty };
  }
  if (!next || (next.altUom === current.altUom && next.altPerStock === current.altPerStock)) return null;
  return next;
}

export function packForBarcode(packs: PackSize[], code: string): PackSize | null {
  const value = normalizeBarcode(code);
  return packs.find((pack) => pack.barcode === value) ?? null;
}

/** "Case of 12". */
export function packText(pack: Pick<PackSize, "level" | "qty">): string {
  return `${PACK_LABELS[pack.level]} of ${pack.qty}`;
}

export type ScannedQty = { ok: true; qty: number; counted: boolean } | { ok: false; problem: string };

/**
 * A line's qty after scanning its SKU or one of its pack barcodes. A pack scan counts: the first one
 * replaces whatever the screen prefilled, later ones add its eaches. Once a line is being counted,
 * an each scan adds one. Before that, `fill` screens (pick, putaway, pack) keep their old answer to an
 * each scan and fill the remaining qty. A scan that would go past `remaining` is refused.
 */
export function scanIntoLine(
  line: { qty: number; counted: boolean; remaining: number },
  scan: { pack?: Pick<PackSize, "level" | "qty"> | null; fill?: boolean },
): ScannedQty {
  const pack = scan.pack && scan.pack.qty > 1 ? scan.pack : null;
  if (line.remaining <= 0) return { ok: false, problem: "Nothing is left on this line." };
  if (!pack && scan.fill && !line.counted) return { ok: true, qty: line.remaining, counted: false };
  const base = line.counted ? Math.max(0, line.qty) : 0;
  const units = pack ? pack.qty : 1;
  const left = line.remaining - base;
  if (units > left) {
    if (left <= 0) return { ok: false, problem: `All ${line.remaining} are already counted.` };
    return {
      ok: false,
      problem: pack
        ? `A ${pack.level} is ${pack.qty}, but only ${left} ${left === 1 ? "is" : "are"} left. Scan eaches or type the qty.`
        : `Only ${left} ${left === 1 ? "is" : "are"} left.`,
    };
  }
  return { ok: true, qty: base + units, counted: true };
}
