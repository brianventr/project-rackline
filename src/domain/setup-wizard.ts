/**
 * The "Set up your building" wizard: name the warehouse, then add the places stock passes through,
 * in the order it passes through them. Each step teaches one level of the hierarchy by building it:
 * a dock (receiving bay), racks (aisle → rack → bay → level), a bench (production), and an outbound
 * bay (shipping). The plan is worked out here, with the same geometry rules the map uses, so the
 * review step can show exactly what will be created and why something cannot be.
 */
import { gridPosition, type WarehouseMapSize } from "./map-layout";
import {
  clampInt,
  defaultAreaSpec,
  defaultRackSpec,
  expandArea,
  expandRack,
  findOpenPosition,
  groupFloorObjects,
  nextAreaCode,
  nextRackAddress,
  normalizeAisle,
  normalizeRack,
  validateDrafts,
  type AreaSpec,
  type LocationDraft,
  type LocationLike,
  type RackSpec,
} from "./rack-builder";
import { describeHierarchy, summarizeHierarchy, type HierarchyLocation } from "./hierarchy";
import { isValidTimeZone } from "./time-zone";

export type SetupStepId = "building" | "dock" | "racks" | "ship" | "bench" | "review";

export type SetupStep = {
  id: SetupStepId;
  title: string;
  /** The level of the hierarchy this step builds. */
  teaches: string;
  /** The question the step answers, for the stepper. */
  question: string;
};

export const SETUP_STEPS: readonly SetupStep[] = [
  { id: "building", title: "Your building", teaches: "Warehouse", question: "What is this place called?" },
  { id: "dock", title: "Where stock arrives", teaches: "Dock", question: "Where do boxes land?" },
  { id: "racks", title: "Where stock lives", teaches: "Aisle · rack · bay · level", question: "What do the shelves look like?" },
  { id: "bench", title: "Where things get built", teaches: "Bench", question: "Do you assemble anything?" },
  { id: "ship", title: "Where orders leave", teaches: "Outbound", question: "Where do orders wait for the carrier?" },
  { id: "review", title: "Review and create", teaches: "The whole tree", question: "Does this look like your floor?" },
];

export const SETUP_STEP_IDS: readonly SetupStepId[] = SETUP_STEPS.map((step) => step.id);

export function setupStep(id: SetupStepId): SetupStep {
  return SETUP_STEPS.find((step) => step.id === id)!;
}

export function nextSetupStep(id: SetupStepId): SetupStepId | null {
  const index = SETUP_STEP_IDS.indexOf(id);
  return SETUP_STEP_IDS[index + 1] ?? null;
}

export function previousSetupStep(id: SetupStepId): SetupStepId | null {
  const index = SETUP_STEP_IDS.indexOf(id);
  return index > 0 ? (SETUP_STEP_IDS[index - 1] ?? null) : null;
}

/* ------------------------------------------------------------------ input */

export type SetupAreaInput = { include: boolean; code: string; name: string };

export type SetupRacksInput = {
  include: boolean;
  aisle: string;
  /** Number inputs hold strings; numbers are fine too. */
  racks: number | string;
  bays: number | string;
  levels: number | string;
  /** Level 1 becomes the pick face and upper levels bulk. Only means something with 2+ levels. */
  pickFaces: boolean;
};

export type SetupInput = {
  building: { name: string; timeZone: string };
  dock: SetupAreaInput;
  racks: SetupRacksInput;
  bench: SetupAreaInput;
  ship: SetupAreaInput;
};

/** A bin that already exists in the warehouse, as `GET /api/map` or `GET /api/locations` returns it. */
export type ExistingBin = LocationLike & { id: string; code: string; slotRole?: string | null; name?: string };

export const SETUP_LIMITS = {
  racks: { min: 1, max: 8 },
  bays: { min: 1, max: 12 },
  levels: { min: 1, max: 6 },
} as const;

/** Sensible first shelves: a maker's bench gets one shelf of two levels, a warehouse two racks of three. */
export function defaultRackShape(garage: boolean): { racks: number; bays: number; levels: number } {
  return garage ? { racks: 1, bays: 4, levels: 2 } : { racks: 2, bays: 4, levels: 3 };
}

const PREFERRED_CODE: Record<AreaSpec["type"], string> = { receiving: "DOCK", production: "BENCH", shipping: "SHIP" };
const AREA_NAME: Record<AreaSpec["type"], string> = {
  receiving: "Receiving dock",
  production: "Assembly bench",
  shipping: "Shipping bay",
};

/**
 * "DOCK" when it is free, else the map builder's own next code (RECV, RECV-2, …). Barcodes are unique
 * across the organization, so `takenCodes` (bins in other buildings) count as taken too.
 */
export function suggestAreaCode(
  existing: { code?: string }[],
  type: AreaSpec["type"],
  takenCodes: Iterable<string> = [],
): string {
  const taken = new Set([...existing.map((row) => row.code?.toUpperCase()).filter(Boolean), ...[...takenCodes].map(normalizeCode)]);
  const preferred = PREFERRED_CODE[type];
  if (!taken.has(preferred)) return preferred;
  const others = [...takenCodes].map((code) => ({ code: normalizeCode(code) }));
  return nextAreaCode([...(existing as LocationLike[]), ...(others as LocationLike[])], type);
}

/**
 * The first aisle letter whose next rack would not collide with a bin anywhere in the organization
 * (a second building cannot reuse A-01-01, since barcodes are unique per organization).
 */
export function suggestAisle(existing: ExistingBin[], takenCodes: Iterable<string> = []): string {
  const taken = new Set([...takenCodes].map(normalizeCode));
  const objects = groupFloorObjects(existing);
  for (let index = 0; index < 26; index += 1) {
    const aisle = String.fromCharCode(65 + index);
    const rack = nextRackAddress(objects, aisle).rack;
    const prefix = `${aisle}-${rack}-`;
    if (![...taken].some((code) => code.startsWith(prefix))) return aisle;
  }
  return "A";
}

/**
 * What the wizard starts with. Steps whose bin already exists start switched off, so an owner who
 * built a dock by hand is not offered a second one; the toggle is still there for a second dock.
 */
export function defaultSetupInput(input: {
  warehouse: { name: string; timeZone?: string | null };
  existing: ExistingBin[];
  garage: boolean;
  /** The browser's zone, used while the building is still on UTC. */
  browserTimeZone?: string | null;
  /** Codes of bins in the organization's other buildings; barcodes are unique per organization. */
  takenCodes?: Iterable<string>;
}): SetupInput {
  const { existing, garage } = input;
  const taken = input.takenCodes ?? [];
  const has = (type: string) => existing.some((row) => row.type === type);
  const shape = defaultRackShape(garage);
  const currentZone = input.warehouse.timeZone?.trim() || "UTC";
  const browserZone = input.browserTimeZone?.trim() || "";
  const timeZone = currentZone === "UTC" && browserZone && isValidTimeZone(browserZone) ? browserZone : currentZone;
  return {
    building: { name: input.warehouse.name, timeZone },
    dock: { include: !has("receiving"), code: suggestAreaCode(existing, "receiving", taken), name: AREA_NAME.receiving },
    racks: {
      include: !has("storage"),
      aisle: suggestAisle(existing, taken),
      racks: shape.racks,
      bays: shape.bays,
      levels: shape.levels,
      pickFaces: shape.levels > 1,
    },
    bench: { include: !has("production"), code: suggestAreaCode(existing, "production", taken), name: AREA_NAME.production },
    ship: { include: !has("shipping"), code: suggestAreaCode(existing, "shipping", taken), name: AREA_NAME.shipping },
  };
}

/* ------------------------------------------------------------------ the plan */

export type SetupSource = "dock" | "rack" | "bench" | "ship";

export type SlotRole = "pick" | "bulk" | "none";

export type PlannedBin = LocationDraft & { slotRole: SlotRole; source: SetupSource };

export type SetupIssue = { step: SetupStepId; field?: string; message: string };

export type SetupRequest =
  | { kind: "warehouse"; body: { name?: string; timeZone?: string } }
  | {
      kind: "area";
      source: Exclude<SetupSource, "rack">;
      body: { type: AreaSpec["type"]; code: string; name: string; posX: number; posY: number; sizeX: number; sizeY: number; sizeZ: number };
      codes: string[];
    }
  | { kind: "rack"; body: RackSpec; codes: string[] }
  | { kind: "slotRole"; code: string; slotRole: Exclude<SlotRole, "none"> };

export type SetupPlan = {
  /** Every bin the wizard would create, in creation order. */
  bins: PlannedBin[];
  /** The API calls, in order. Empty when there is nothing to do or the plan has issues. */
  requests: SetupRequest[];
  issues: SetupIssue[];
  /** One line: "1 dock · 2 racks with 24 bins (8 pick faces, 16 bulk bays) · 1 outbound bay". */
  description: string;
};

export type SetupContext = {
  /** Bins in this building: they are obstacles on the map and their codes are taken. */
  existing: ExistingBin[];
  warehouse: WarehouseMapSize & { name: string; timeZone?: string | null };
  /** Codes of bins in the organization's other buildings. Barcodes are unique per organization, not per building. */
  takenCodes?: Iterable<string>;
  /** Garage Mode names its menus differently (Shop → Bench setup rather than Settings → Warehouse). */
  garage?: boolean;
};

/** Where the map size lives, in the words of this shop's menu. */
export function warehouseSettingsLabel(garage: boolean | undefined): string {
  return garage ? "Shop → Bench setup" : "Settings → Warehouse";
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;

/** Upper-case and trim a code the way the server stores it. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function wholeNumber(value: number | string, field: string, min: number, max: number, issues: SetupIssue[]): number | null {
  const raw = typeof value === "number" ? value : Number(String(value).trim());
  if (String(value).trim() === "" || !Number.isInteger(raw)) {
    issues.push({ step: "racks", field, message: `${field[0]!.toUpperCase()}${field.slice(1)} must be a whole number.` });
    return null;
  }
  if (raw < min || raw > max) {
    issues.push({ step: "racks", field, message: `${field[0]!.toUpperCase()}${field.slice(1)} must be between ${min} and ${max}.` });
    return null;
  }
  return raw;
}

function checkCode(
  step: Exclude<SetupSource, "rack">,
  raw: string,
  taken: Set<string>,
  issues: SetupIssue[],
): string | null {
  const code = normalizeCode(raw);
  if (!code) {
    issues.push({ step, field: "code", message: "Enter a code. It becomes the barcode on the bay." });
    return null;
  }
  if (!CODE_PATTERN.test(code)) {
    issues.push({ step, field: "code", message: "Codes use letters, numbers, dashes, and underscores, with no spaces." });
    return null;
  }
  if (taken.has(code)) {
    issues.push({ step, field: "code", message: `${code} already exists. Pick another code.` });
    return null;
  }
  taken.add(code);
  return code;
}

function obstacleOf(bin: PlannedBin | ExistingBin): LocationLike {
  return bin;
}

function areaSeed(type: AreaSpec["type"], warehouse: WarehouseMapSize): { posX: number; posY: number } {
  if (type === "receiving") return { posX: 2, posY: 1 };
  if (type === "shipping") return { posX: Math.max(2, warehouse.mapWidth - 20), posY: Math.max(2, warehouse.mapDepth - 6) };
  return { posX: Math.max(2, warehouse.mapWidth - 10), posY: 7 };
}

/**
 * Turn the form into bins and API calls. Codes are checked against what exists and each other;
 * geometry is checked with the map's own rules, sliding a piece to the nearest open spot when its
 * usual place is taken. Any issue leaves `requests` empty so nothing half-builds.
 */
export function planSetup(input: SetupInput, ctx: SetupContext): SetupPlan {
  const issues: SetupIssue[] = [];
  const bins: PlannedBin[] = [];
  const requests: SetupRequest[] = [];
  const existing = ctx.existing;
  const taken = new Set([...existing.map((row) => normalizeCode(row.code)), ...[...(ctx.takenCodes ?? [])].map(normalizeCode)]);
  const obstacles: LocationLike[] = existing.map(obstacleOf);

  // Building
  const name = input.building.name.trim();
  if (!name) issues.push({ step: "building", field: "name", message: "Give the building a name." });
  const timeZone = input.building.timeZone.trim();
  if (!timeZone) issues.push({ step: "building", field: "timeZone", message: "Enter a timezone, like America/Los_Angeles." });
  else if (!isValidTimeZone(timeZone)) {
    issues.push({ step: "building", field: "timeZone", message: "Use an IANA timezone name, like America/Los_Angeles." });
  }
  const warehousePatch: { name?: string; timeZone?: string } = {};
  if (name && name !== ctx.warehouse.name) warehousePatch.name = name;
  if (timeZone && isValidTimeZone(timeZone) && timeZone !== (ctx.warehouse.timeZone?.trim() || "UTC")) {
    warehousePatch.timeZone = timeZone;
  }
  if (Object.keys(warehousePatch).length) requests.push({ kind: "warehouse", body: warehousePatch });

  function planArea(source: Exclude<SetupSource, "rack">, type: AreaSpec["type"], area: SetupAreaInput) {
    if (!area.include) return;
    const code = checkCode(source, area.code, taken, issues);
    const areaName = area.name.trim() || AREA_NAME[type];
    if (!code) return;
    const base = defaultAreaSpec(type, obstacles, 0, 0);
    const spec = (posX: number, posY: number): AreaSpec => ({ ...base, code, name: areaName, posX, posY });
    const seed = areaSeed(type, ctx.warehouse);
    const spot = findOpenPosition((x, y) => [expandArea(spec(x, y))], obstacles, ctx.warehouse, new Set(), seed);
    if (!spot) {
      issues.push({
        step: source,
        message: `There is no room on the map for ${code}. Enlarge the map under ${warehouseSettingsLabel(ctx.garage)}, or leave this step for later.`,
      });
      return;
    }
    const final = spec(spot.posX, spot.posY);
    const draft = expandArea(final);
    bins.push({ ...draft, slotRole: "none", source });
    obstacles.push(draft);
    requests.push({
      kind: "area",
      source,
      body: {
        type,
        code: final.code,
        name: final.name,
        posX: final.posX,
        posY: final.posY,
        sizeX: final.sizeX,
        sizeY: final.sizeY,
        sizeZ: final.sizeZ,
      },
      codes: [draft.code],
    });
  }

  function planRacks(racks: SetupRacksInput) {
    if (!racks.include) return;
    const aisleRaw = racks.aisle.trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(aisleRaw)) {
      issues.push({ step: "racks", field: "aisle", message: "An aisle is one to three letters, like A or AB." });
      return;
    }
    const aisle = normalizeAisle(aisleRaw);
    const count = wholeNumber(racks.racks, "racks", SETUP_LIMITS.racks.min, SETUP_LIMITS.racks.max, issues);
    const bays = wholeNumber(racks.bays, "bays", SETUP_LIMITS.bays.min, SETUP_LIMITS.bays.max, issues);
    const levels = wholeNumber(racks.levels, "levels", SETUP_LIMITS.levels.min, SETUP_LIMITS.levels.max, issues);
    if (count === null || bays === null || levels === null) return;
    // Two units per level is the map's default; squeeze when the building's height would not fit.
    const levelHeight = clampInt(Math.floor(ctx.warehouse.mapHeight / levels), 1, 2);
    const start = Number.parseInt(nextRackAddress(groupFloorObjects(obstacles), aisle).rack, 10) || 1;
    for (let index = 0; index < count; index += 1) {
      const rack = normalizeRack(start + index);
      const seed = gridPosition(aisle, rack, "01", 1);
      const spec = (posX: number, posY: number): RackSpec =>
        defaultRackSpec({ aisle, rack, posX, posY, rotation: 0, bays, levels, bayWidth: 3, bayDepth: 4, bayPitch: 4, levelHeight });
      const codeClash = expandRack(spec(seed.posX, seed.posY)).find((draft) => taken.has(draft.code));
      if (codeClash) {
        issues.push({ step: "racks", field: "aisle", message: `${codeClash.code} already exists. Pick another aisle.` });
        return;
      }
      const spot = findOpenPosition((x, y) => expandRack(spec(x, y)), obstacles, ctx.warehouse, new Set(), seed);
      if (!spot) {
        issues.push({
          step: "racks",
          message: `There is no room on the map for rack ${aisle}-${rack} (${bays} bays, ${levels} levels). Try fewer bays or levels, or enlarge the map's width, depth, or height under ${warehouseSettingsLabel(ctx.garage)}.`,
        });
        return;
      }
      const final = spec(spot.posX, spot.posY);
      const drafts = expandRack(final);
      const roles = racks.pickFaces && levels > 1;
      for (const draft of drafts) {
        const slotRole: SlotRole = roles ? (draft.level === 1 ? "pick" : "bulk") : "none";
        bins.push({ ...draft, slotRole, source: "rack" });
        obstacles.push(draft);
        taken.add(draft.code);
      }
      requests.push({ kind: "rack", body: final, codes: drafts.map((draft) => draft.code) });
    }
  }

  // Floor order: boxes land on the dock, go to the shelves, get built at the bench, leave from outbound.
  planArea("dock", "receiving", input.dock);
  planRacks(input.racks);
  planArea("bench", "production", input.bench);
  planArea("ship", "shipping", input.ship);

  for (const bin of bins) {
    if (bin.slotRole !== "none") requests.push({ kind: "slotRole", code: bin.code, slotRole: bin.slotRole });
  }

  // Belt and braces: the same check the server runs, over everything at once.
  if (!issues.length && bins.length) {
    const issue = validateDrafts(bins, existing.map(obstacleOf), ctx.warehouse);
    if (issue) issues.push({ step: "review", message: issue.message });
  }

  return {
    bins,
    requests: issues.length ? [] : requests,
    issues,
    description: describeHierarchy(summarizeHierarchy(bins)),
  };
}

/** Issues for one step, so its fields can show them inline. */
export function issuesForStep(plan: SetupPlan, step: SetupStepId): SetupIssue[] {
  return plan.issues.filter((issue) => issue.step === step);
}

/** The first step with a problem, so Create can jump back to it. */
export function firstIssueStep(plan: SetupPlan): SetupStepId | null {
  for (const id of SETUP_STEP_IDS) if (plan.issues.some((issue) => issue.step === id)) return id;
  return null;
}

/** Planned bins as the hierarchy tree reads them. */
export function plannedHierarchy(bins: PlannedBin[]): HierarchyLocation[] {
  return bins.map((bin) => ({
    code: bin.code,
    name: bin.name,
    type: bin.type,
    area: bin.area,
    aisle: bin.aisle,
    rack: bin.rack,
    bay: bin.bay,
    level: bin.level,
    slotRole: bin.slotRole,
  }));
}

/** Existing bins as the hierarchy tree reads them. */
export function existingHierarchy(existing: ExistingBin[]): HierarchyLocation[] {
  return existing.map((bin) => ({
    id: bin.id,
    code: bin.code,
    name: bin.name,
    type: bin.type,
    area: bin.area,
    aisle: bin.aisle,
    rack: bin.rack,
    bay: bin.bay,
    level: bin.level,
    slotRole: bin.slotRole,
    units: bin.unitsOnHand,
  }));
}

/** Whether a step adds anything, for the stepper's ticks. */
export function stepIncluded(input: SetupInput, step: SetupStepId): boolean {
  switch (step) {
    case "building":
    case "review":
      return true;
    case "dock":
      return input.dock.include;
    case "racks":
      return input.racks.include;
    case "bench":
      return input.bench.include;
    case "ship":
      return input.ship.include;
  }
}

/** Codes the rack step will mint, for the live preview ("A-01-01 … A-01-04-3"). */
export function previewRackCodes(racks: SetupRacksInput, existing: ExistingBin[]): string[] {
  const aisleRaw = racks.aisle.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(aisleRaw)) return [];
  const bays = Number(String(racks.bays).trim());
  const levels = Number(String(racks.levels).trim());
  const count = Number(String(racks.racks).trim());
  if (![bays, levels, count].every((n) => Number.isInteger(n) && n >= 1)) return [];
  const aisle = normalizeAisle(aisleRaw);
  const start = Number.parseInt(nextRackAddress(groupFloorObjects(existing), aisle).rack, 10) || 1;
  const codes: string[] = [];
  for (let index = 0; index < Math.min(count, SETUP_LIMITS.racks.max); index += 1) {
    const rack = normalizeRack(start + index);
    const spec = defaultRackSpec({
      aisle,
      rack,
      bays: Math.min(bays, SETUP_LIMITS.bays.max),
      levels: Math.min(levels, SETUP_LIMITS.levels.max),
    });
    codes.push(...expandRack(spec).map((draft) => draft.code));
  }
  return codes;
}

/* ------------------------------------------------------------------ after a failed create */

/** What a create run managed before it stopped, from the requests that completed. */
export type SetupCreated = { dock: boolean; racks: number; bench: boolean; ship: boolean };

/** Read `SetupCreated` off the requests that completed. */
export function summarizeCompleted(completed: readonly SetupRequest[]): SetupCreated {
  const created: SetupCreated = { dock: false, racks: 0, bench: false, ship: false };
  for (const request of completed) {
    if (request.kind === "area") created[request.source] = true;
    if (request.kind === "rack") created.racks += 1;
  }
  return created;
}

function count(value: number | string): number {
  const n = Number(String(value).trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * The form after a partial create: what the person typed stays, but a step whose bin this run
 * already made switches off, and a rack step that got some of its racks asks only for the rest
 * (numbering continues from the next free rack). `fresh` is the default form for the refetched map.
 */
export function mergeSetupInput(prev: SetupInput, fresh: SetupInput, created: SetupCreated): SetupInput {
  const requested = count(prev.racks.racks);
  const racks: SetupRacksInput = !prev.racks.include
    ? fresh.racks
    : created.racks >= requested && requested > 0
      ? { ...prev.racks, include: false }
      : created.racks > 0
        ? { ...prev.racks, racks: requested - created.racks }
        : prev.racks;
  const area = (previous: SetupAreaInput, next: SetupAreaInput, done: boolean): SetupAreaInput =>
    !previous.include ? next : done ? { ...previous, include: false } : previous;
  return {
    building: prev.building,
    dock: area(prev.dock, fresh.dock, created.dock),
    racks,
    bench: area(prev.bench, fresh.bench, created.bench),
    ship: area(prev.ship, fresh.ship, created.ship),
  };
}

/**
 * Slot-role patches a failed run still owes: the roles it planned for bins that now exist but do not
 * carry that role yet. A retry runs these after its own requests, so a half-labelled rack gets finished.
 */
export function pendingSlotRoles(
  requests: readonly SetupRequest[],
  completed: readonly SetupRequest[],
  bins: readonly ExistingBin[],
): SetupRequest[] {
  const done = new Set(completed);
  const byCode = new Map(bins.map((bin) => [normalizeCode(bin.code), bin]));
  const pending: SetupRequest[] = [];
  for (const request of requests) {
    if (request.kind !== "slotRole" || done.has(request)) continue;
    const bin = byCode.get(normalizeCode(request.code));
    if (!bin || (bin.slotRole ?? "none") === request.slotRole) continue;
    pending.push(request);
  }
  return pending;
}

/** Requests for a run: the plan's own, then any carried-over slot roles not already in it. */
export function withCarriedRequests(requests: readonly SetupRequest[], carried: readonly SetupRequest[]): SetupRequest[] {
  const seen = new Set(requests.filter((request) => request.kind === "slotRole").map((request) => (request.kind === "slotRole" ? normalizeCode(request.code) : "")));
  const extra = carried.filter((request) => request.kind === "slotRole" && !seen.has(normalizeCode(request.code)));
  return [...requests, ...extra];
}
