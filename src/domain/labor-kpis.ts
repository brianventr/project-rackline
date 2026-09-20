export const LABOR_KPI_MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
export const LABOR_KPI_EVENT_CAP = 10_000;
export const LABOR_MAX_GAP_MS = 30 * 60 * 1000;
export const LABOR_BASE_PER_LINE_MS = 8_000;
export const LABOR_UNIT_MS = 3_000;
export const LABOR_WALK_MS_PER_MAP_UNIT = 400;
export const LABOR_MATRIX_SKU_LIMIT = 8;

export const THROUGHPUT_VERBS = [
  "receive",
  "move",
  "pick",
  "pack",
  "ship",
  "replenish",
  "kit",
  "assemble",
  "rtv",
] as const;

export type ThroughputVerb = (typeof THROUGHPUT_VERBS)[number];
export type LaborKpiVerb = ThroughputVerb | "unpick" | "adjust" | "count";
export type LaborEventKind = "throughput" | "exception" | "ignore";

export type LaborMember = {
  userId: string;
  userName: string;
  role: string;
};

export type LaborItemFlags = {
  itemId: string;
  sku: string;
  name: string;
  type: string;
  trackLot: boolean;
  trackSerial: boolean;
  catchWeight: boolean;
  trackExpiry: boolean;
};

export type LaborLocation = {
  id: string;
  warehouseId: string;
  posX: number;
  posY: number;
};

export type LaborFact = {
  userId: string;
  createdAt: number;
  type: string;
  refType: string;
  refId: string;
  itemId: string;
  qty: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  reason?: string | null;
};

export type LaborKpiInput = {
  members: LaborMember[];
  items: LaborItemFlags[];
  locations: LaborLocation[];
  facts: LaborFact[];
  matrixSkuLimit?: number;
};

export type LaborStaffSku = {
  itemId: string;
  sku: string;
  units: number;
  pace: number;
};

export type LaborStaffRow = {
  userId: string;
  userName: string;
  role: string;
  lines: number;
  units: number;
  exceptionUnits: number;
  exceptionRate: number;
  activeMs: number;
  activeHours: number;
  lph: number;
  uph: number;
  expectedMs: number;
  pace: number;
  topSkus: LaborStaffSku[];
};

export type LaborSkuRow = {
  itemId: string;
  sku: string;
  name: string;
  type: string;
  trackLot: boolean;
  trackSerial: boolean;
  catchWeight: boolean;
  trackExpiry: boolean;
  complexity: number;
  units: number;
  lines: number;
  handlers: number;
  exceptionUnits: number;
  exceptionRate: number;
  expectedMs: number;
  actualMs: number;
  pace: number;
  hard: boolean;
};

export type LaborMatrixCell = {
  userId: string;
  userName: string;
  itemId: string;
  sku: string;
  units: number;
  pace: number;
};

export type LaborDailyPoint = {
  day: string;
  lines: number;
  units: number;
  pace: number;
};

export type LaborVerbMix = {
  verb: LaborKpiVerb;
  lines: number;
  units: number;
};

export type LaborDocumentRow = {
  refType: string;
  refId: string;
  verb: LaborKpiVerb;
  sku: string;
  qty: number;
  createdAt: number;
};

export type LaborKpiBoard = {
  team: {
    lines: number;
    units: number;
    exceptionUnits: number;
    exceptionRate: number;
    activeHours: number;
    pace: number;
  };
  staff: LaborStaffRow[];
  skus: LaborSkuRow[];
  matrix: LaborMatrixCell[];
  daily: LaborDailyPoint[];
  verbMix: LaborVerbMix[];
};

export type LaborStaffDetail = {
  staff: LaborStaffRow | null;
  daily: LaborDailyPoint[];
  verbMix: LaborVerbMix[];
  skus: LaborSkuRow[];
  recent: LaborDocumentRow[];
};

export type LaborSkuDetail = {
  sku: LaborSkuRow | null;
  handlers: LaborStaffRow[];
};

type Classified = {
  verb: LaborKpiVerb;
  kind: LaborEventKind;
};

export function skuComplexity(flags: {
  trackLot?: boolean | null;
  trackSerial?: boolean | null;
  catchWeight?: boolean | null;
  trackExpiry?: boolean | null;
}): number {
  return (
    1 +
    (flags.trackLot ? 0.4 : 0) +
    (flags.trackSerial ? 0.4 : 0) +
    (flags.catchWeight ? 0.3 : 0) +
    (flags.trackExpiry ? 0.3 : 0)
  );
}

export function classifyLaborFact(fact: Pick<LaborFact, "type" | "refType" | "reason">): Classified {
  if (fact.refType === "seed") return { verb: "adjust", kind: "ignore" };
  const type = fact.type;
  if (type === "pack") return { verb: "pack", kind: "throughput" };
  if (type === "pick") return { verb: "pick", kind: "throughput" };
  if (type === "ship") return { verb: "ship", kind: "throughput" };
  if (type === "receive") return { verb: "receive", kind: "throughput" };
  if (type === "rtv") return { verb: "rtv", kind: "throughput" };
  if (type === "unpick") return { verb: "unpick", kind: "exception" };
  if (type === "kit_consume" || type === "kit_produce") return { verb: "kit", kind: "throughput" };
  if (type === "wo_consume" || type === "wo_produce") return { verb: "assemble", kind: "throughput" };
  if (type === "move") {
    if (fact.refType === "replenishment") return { verb: "replenish", kind: "throughput" };
    return { verb: "move", kind: "throughput" };
  }
  if (type === "adjust") {
    const reason = (fact.reason ?? "").toLowerCase();
    if (reason.includes("cycle count")) return { verb: "count", kind: "exception" };
    return { verb: "adjust", kind: "exception" };
  }
  return { verb: "adjust", kind: "ignore" };
}

export function manhattanTravel(a: { posX: number; posY: number }, b: { posX: number; posY: number }): number {
  return Math.abs(a.posX - b.posX) + Math.abs(a.posY - b.posY);
}

export function expectedLineMs(input: {
  qty: number;
  complexity: number;
  travelMapUnits?: number;
}): number {
  const qty = Math.abs(input.qty);
  const travel = (input.travelMapUnits ?? 0) * LABOR_WALK_MS_PER_MAP_UNIT;
  return LABOR_BASE_PER_LINE_MS + qty * LABOR_UNIT_MS * input.complexity + travel;
}

/** ShipHero-style 0–10: 5 on target, 10 at ≥2× fast, 0 at ≥2× slow. */
export function paceScore(expectedMs: number, actualMs: number): number {
  if (expectedMs <= 0) return 5;
  if (actualMs <= 0) return 5;
  const ratio = actualMs / expectedMs;
  if (ratio <= 0.5) return 10;
  if (ratio >= 2) return 0;
  if (ratio <= 1) return round1(5 + 10 * (1 - ratio));
  return round1(5 - 5 * (ratio - 1));
}

export function sessionActiveMs(timestamps: number[]): number {
  if (timestamps.length < 2) return 0;
  const times = [...timestamps].sort((a, b) => a - b);
  let active = 0;
  let sessionStart = times[0]!;
  let prev = times[0]!;
  for (const time of times.slice(1)) {
    if (time - prev > LABOR_MAX_GAP_MS) {
      active += prev - sessionStart;
      sessionStart = time;
    }
    prev = time;
  }
  active += prev - sessionStart;
  return active;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function startOfUtcDay(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function laborRangeMs(now: number, preset: "today" | "7d" | "30d"): { from: number; to: number } {
  if (preset === "today") return { from: startOfUtcDay(now), to: now };
  if (preset === "30d") return { from: now - LABOR_KPI_MAX_RANGE_MS, to: now };
  return { from: now - 7 * 24 * 60 * 60 * 1000, to: now };
}

type Worked = {
  fact: LaborFact;
  classified: Classified;
  item: LaborItemFlags;
  expectedMs: number;
  actualMs: number;
};

export function buildLaborKpis(input: LaborKpiInput): LaborKpiBoard {
  const members = new Map(input.members.map((row) => [row.userId, row]));
  const items = new Map(input.items.map((row) => [row.itemId, row]));
  const locations = new Map(input.locations.map((row) => [row.id, row]));
  const worked = annotateFacts(input.facts, members, items, locations);

  const staff = rollupStaff(worked, members);
  const skus = rollupSkus(worked, items);
  const topSkuIds = skus.slice(0, input.matrixSkuLimit ?? LABOR_MATRIX_SKU_LIMIT).map((row) => row.itemId);
  const matrix = rollupMatrix(worked, members, topSkuIds);
  const daily = rollupDaily(worked);
  const verbMix = rollupVerbs(worked);

  const lines = staff.reduce((sum, row) => sum + row.lines, 0);
  const units = staff.reduce((sum, row) => sum + row.units, 0);
  const exceptionUnits = staff.reduce((sum, row) => sum + row.exceptionUnits, 0);
  const expectedMs = staff.reduce((sum, row) => sum + row.expectedMs, 0);
  const actualMs = staff.reduce((sum, row) => sum + row.activeMs, 0);

  return {
    team: {
      lines,
      units,
      exceptionUnits,
      exceptionRate: rate(exceptionUnits, units + exceptionUnits),
      activeHours: hours(actualMs),
      pace: paceScore(expectedMs, actualMs),
    },
    staff,
    skus,
    matrix,
    daily,
    verbMix,
  };
}

export function laborStaffDetail(board: LaborKpiBoard, facts: LaborFact[], userId: string): LaborStaffDetail {
  const staff = board.staff.find((row) => row.userId === userId) ?? null;
  const daily = board.daily;
  const mine = facts.filter((fact) => fact.userId === userId);
  const recent = mine
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 25)
    .map((fact) => {
      const classified = classifyLaborFact(fact);
      return {
        refType: fact.refType,
        refId: fact.refId,
        verb: classified.verb,
        sku: board.skus.find((row) => row.itemId === fact.itemId)?.sku ?? fact.itemId,
        qty: Math.abs(fact.qty),
        createdAt: fact.createdAt,
      };
    });
  return {
    staff,
    daily,
    verbMix: board.verbMix,
    skus: board.skus,
    recent,
  };
}

export function laborSkuDetail(board: LaborKpiBoard, itemId: string): LaborSkuDetail {
  const sku = board.skus.find((row) => row.itemId === itemId) ?? null;
  const handlerIds = new Set(board.matrix.filter((cell) => cell.itemId === itemId && cell.units > 0).map((cell) => cell.userId));
  return {
    sku,
    handlers: board.staff.filter((row) => handlerIds.has(row.userId)),
  };
}

function annotateFacts(
  facts: LaborFact[],
  members: Map<string, LaborMember>,
  items: Map<string, LaborItemFlags>,
  locations: Map<string, LaborLocation>,
): Worked[] {
  const eligible = facts
    .filter((fact) => members.has(fact.userId))
    .map((fact) => ({ fact, classified: classifyLaborFact(fact), item: items.get(fact.itemId) }))
    .filter((row): row is { fact: LaborFact; classified: Classified; item: LaborItemFlags } => Boolean(row.item) && row.classified.kind !== "ignore")
    .sort((a, b) => a.fact.createdAt - b.fact.createdAt || a.fact.userId.localeCompare(b.fact.userId));

  const travel = new Map<string, number>();
  const prevLoc = new Map<string, string>();
  for (const row of eligible) {
    if (row.classified.kind !== "throughput") continue;
    const locId = row.fact.fromLocationId ?? row.fact.toLocationId;
    const key = `${row.fact.userId}:${row.fact.refId}`;
    const prevId = prevLoc.get(key);
    if (locId && prevId && locId !== prevId) {
      const a = locations.get(prevId);
      const b = locations.get(locId);
      if (a && b) travel.set(eventKey(row.fact), manhattanTravel(a, b));
    }
    if (locId) prevLoc.set(key, locId);
  }

  const withExpected: Worked[] = eligible.map((row) => ({
    ...row,
    expectedMs:
      row.classified.kind === "throughput"
        ? expectedLineMs({
            qty: row.fact.qty,
            complexity: skuComplexity(row.item),
            travelMapUnits: travel.get(eventKey(row.fact)) ?? 0,
          })
        : 0,
    actualMs: 0,
  }));

  const groups = new Map<string, Worked[]>();
  for (const row of withExpected) {
    const key = `${row.fact.userId}:${row.fact.refId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  for (const group of groups.values()) {
    const throughput = group.filter((row) => row.classified.kind === "throughput");
    const active = sessionActiveMs(throughput.map((row) => row.fact.createdAt));
    const expectedTotal = throughput.reduce((sum, row) => sum + row.expectedMs, 0);
    for (const row of throughput) {
      if (active <= 0 || expectedTotal <= 0) {
        row.actualMs = row.expectedMs;
      } else {
        row.actualMs = active * (row.expectedMs / expectedTotal);
      }
    }
  }
  return withExpected;
}

function rollupStaff(worked: Worked[], members: Map<string, LaborMember>): LaborStaffRow[] {
  const byUser = new Map<string, Worked[]>();
  for (const row of worked) {
    const list = byUser.get(row.fact.userId) ?? [];
    list.push(row);
    byUser.set(row.fact.userId, list);
  }
  const rows: LaborStaffRow[] = [];
  for (const member of members.values()) {
    const list = byUser.get(member.userId) ?? [];
    const throughput = list.filter((row) => row.classified.kind === "throughput");
    const exceptions = list.filter((row) => row.classified.kind === "exception");
    const units = sumQty(throughput);
    const exceptionUnits = sumQty(exceptions);
    const expectedMs = throughput.reduce((sum, row) => sum + row.expectedMs, 0);
    const activeMs = throughput.reduce((sum, row) => sum + row.actualMs, 0);
    const activeHours = hours(activeMs);
    const skuUnits = new Map<string, { itemId: string; sku: string; units: number; expectedMs: number; actualMs: number }>();
    for (const row of throughput) {
      const current = skuUnits.get(row.item.itemId) ?? {
        itemId: row.item.itemId,
        sku: row.item.sku,
        units: 0,
        expectedMs: 0,
        actualMs: 0,
      };
      current.units += Math.abs(row.fact.qty);
      current.expectedMs += row.expectedMs;
      current.actualMs += row.actualMs;
      skuUnits.set(row.item.itemId, current);
    }
    const topSkus = [...skuUnits.values()]
      .sort((a, b) => b.units - a.units)
      .slice(0, 5)
      .map((row) => ({ itemId: row.itemId, sku: row.sku, units: row.units, pace: paceScore(row.expectedMs, row.actualMs) }));
    if (throughput.length === 0 && exceptions.length === 0) continue;
    rows.push({
      userId: member.userId,
      userName: member.userName,
      role: member.role,
      lines: throughput.length,
      units,
      exceptionUnits,
      exceptionRate: rate(exceptionUnits, units + exceptionUnits),
      activeMs,
      activeHours,
      lph: activeHours > 0 ? round1(throughput.length / activeHours) : 0,
      uph: activeHours > 0 ? round1(units / activeHours) : 0,
      expectedMs,
      pace: paceScore(expectedMs, activeMs),
      topSkus,
    });
  }
  return rows.sort((a, b) => b.units - a.units || a.userName.localeCompare(b.userName));
}

function rollupSkus(worked: Worked[], items: Map<string, LaborItemFlags>): LaborSkuRow[] {
  const byItem = new Map<string, Worked[]>();
  for (const row of worked) {
    const list = byItem.get(row.item.itemId) ?? [];
    list.push(row);
    byItem.set(row.item.itemId, list);
  }
  const rows: LaborSkuRow[] = [];
  for (const [itemId, list] of byItem) {
    const item = items.get(itemId);
    if (!item) continue;
    const throughput = list.filter((row) => row.classified.kind === "throughput");
    const exceptions = list.filter((row) => row.classified.kind === "exception");
    if (throughput.length === 0 && exceptions.length === 0) continue;
    const units = sumQty(throughput);
    const exceptionUnits = sumQty(exceptions);
    const expectedMs = throughput.reduce((sum, row) => sum + row.expectedMs, 0);
    const actualMs = throughput.reduce((sum, row) => sum + row.actualMs, 0);
    const handlers = new Set(throughput.map((row) => row.fact.userId)).size;
    const pace = paceScore(expectedMs, actualMs);
    rows.push({
      itemId: item.itemId,
      sku: item.sku,
      name: item.name,
      type: item.type,
      trackLot: item.trackLot,
      trackSerial: item.trackSerial,
      catchWeight: item.catchWeight,
      trackExpiry: item.trackExpiry,
      complexity: round1(skuComplexity(item)),
      units,
      lines: throughput.length,
      handlers,
      exceptionUnits,
      exceptionRate: rate(exceptionUnits, units + exceptionUnits),
      expectedMs,
      actualMs,
      pace,
      hard: throughput.length > 0 && pace < 5,
    });
  }
  return rows.sort((a, b) => b.units - a.units || a.sku.localeCompare(b.sku));
}

function rollupMatrix(worked: Worked[], members: Map<string, LaborMember>, skuIds: string[]): LaborMatrixCell[] {
  const wanted = new Set(skuIds);
  const cells = new Map<string, { userId: string; itemId: string; sku: string; units: number; expectedMs: number; actualMs: number }>();
  for (const row of worked) {
    if (row.classified.kind !== "throughput") continue;
    if (!wanted.has(row.item.itemId)) continue;
    const key = `${row.fact.userId}:${row.item.itemId}`;
    const current = cells.get(key) ?? {
      userId: row.fact.userId,
      itemId: row.item.itemId,
      sku: row.item.sku,
      units: 0,
      expectedMs: 0,
      actualMs: 0,
    };
    current.units += Math.abs(row.fact.qty);
    current.expectedMs += row.expectedMs;
    current.actualMs += row.actualMs;
    cells.set(key, current);
  }
  return [...cells.values()]
    .map((cell) => ({
      userId: cell.userId,
      userName: members.get(cell.userId)?.userName ?? cell.userId,
      itemId: cell.itemId,
      sku: cell.sku,
      units: cell.units,
      pace: paceScore(cell.expectedMs, cell.actualMs),
    }))
    .sort((a, b) => b.units - a.units);
}

function rollupDaily(worked: Worked[]): LaborDailyPoint[] {
  const byDay = new Map<string, { lines: number; units: number; expectedMs: number; actualMs: number }>();
  for (const row of worked) {
    if (row.classified.kind !== "throughput") continue;
    const day = utcDay(row.fact.createdAt);
    const current = byDay.get(day) ?? { lines: 0, units: 0, expectedMs: 0, actualMs: 0 };
    current.lines += 1;
    current.units += Math.abs(row.fact.qty);
    current.expectedMs += row.expectedMs;
    current.actualMs += row.actualMs;
    byDay.set(day, current);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, row]) => ({
      day,
      lines: row.lines,
      units: row.units,
      pace: paceScore(row.expectedMs, row.actualMs),
    }));
}

function rollupVerbs(worked: Worked[]): LaborVerbMix[] {
  const byVerb = new Map<LaborKpiVerb, LaborVerbMix>();
  for (const row of worked) {
    if (row.classified.kind === "ignore") continue;
    const current = byVerb.get(row.classified.verb) ?? { verb: row.classified.verb, lines: 0, units: 0 };
    current.lines += 1;
    current.units += Math.abs(row.fact.qty);
    byVerb.set(row.classified.verb, current);
  }
  return [...byVerb.values()].sort((a, b) => b.units - a.units);
}

function eventKey(fact: LaborFact): string {
  return `${fact.userId}:${fact.refId}:${fact.createdAt}:${fact.itemId}:${fact.type}:${fact.qty}`;
}

function sumQty(rows: Worked[]): number {
  return rows.reduce((sum, row) => sum + Math.abs(row.fact.qty), 0);
}

function rate(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return round1((part / whole) * 100);
}

function hours(ms: number): number {
  return round2(ms / 3_600_000);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
