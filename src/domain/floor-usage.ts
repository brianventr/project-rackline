/**
 * Floor launcher and scan-feedback rules: how verb tiles group by flow, which verbs a
 * person reaches for most, how much open work sits behind each verb, and how a scan
 * result is answered (tone, buzz). Pure so the launcher and the scanner stay thin.
 */
import { DEFAULT_JOB_REASON } from "./job-rank";

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type FloorGroupId = "inbound" | "outbound" | "stock" | "make" | "tools";

export const FLOOR_GROUPS: readonly { id: FloorGroupId; label: string }[] = [
  { id: "inbound", label: "Inbound" },
  { id: "outbound", label: "Outbound" },
  { id: "stock", label: "Stock" },
  { id: "make", label: "Make" },
  { id: "tools", label: "Tools" },
];

/** Which flow each floor screen belongs to. Anything unlisted lands in Tools. */
export const FLOOR_PATH_GROUP: Readonly<Record<string, FloorGroupId>> = {
  "/floor/receive": "inbound",
  "/floor/asn": "inbound",
  "/floor/yard": "inbound",
  "/floor/putaway": "inbound",
  "/floor/return": "inbound",
  "/floor/pick": "outbound",
  "/floor/wave": "outbound",
  "/floor/pack": "outbound",
  "/floor/ship": "outbound",
  "/floor/rtv": "outbound",
  "/floor/replenish": "stock",
  "/floor/count": "stock",
  "/floor/hold": "stock",
  "/floor/adjust": "stock",
  "/floor/assemble": "make",
  "/floor/kit": "make",
  "/floor/lookup": "tools",
  "/floor/print": "tools",
  "/floor/checkout": "tools",
};

function barePath(path: string): string {
  const bare = path.split("?")[0]?.split("#")[0] ?? "";
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
}

export function floorGroupFor(path: string): FloorGroupId {
  return FLOOR_PATH_GROUP[barePath(path)] ?? "tools";
}

/** Split tiles into flow groups in `FLOOR_GROUPS` order. Tile order inside a group is kept; empty groups are dropped. */
export function groupFloorTiles<T extends { to: string }>(
  tiles: readonly T[],
): { id: FloorGroupId; label: string; tiles: T[] }[] {
  return FLOOR_GROUPS.map((group) => ({
    ...group,
    tiles: tiles.filter((tile) => floorGroupFor(tile.to) === group.id),
  })).filter((group) => group.tiles.length > 0);
}

// ---------------------------------------------------------------------------
// Usage ("Your usual")
// ---------------------------------------------------------------------------

/** Tap counts per floor path, e.g. `{ "/floor/pick": 12 }`. */
export type FloorUsage = Record<string, number>;

export const USUAL_LIMIT = 4;

/** Cap per path so one verb cannot drown the rest forever; halving keeps the order. */
const USAGE_CAP = 500;

export function floorUsageKey(userId: string): string {
  return `rackline.floorUsage.${userId}`;
}

/** Read stored counts, dropping anything that is not a positive finite number. */
export function parseFloorUsage(raw: string | null | undefined): FloorUsage {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const usage: FloorUsage = {};
  for (const [path, count] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0 && path.startsWith("/floor")) {
      usage[path] = Math.floor(count);
    }
  }
  return usage;
}

/** Count one tap on a floor path. Returns a new object; when a path hits the cap every count is halved. */
export function recordFloorTap(usage: FloorUsage, path: string): FloorUsage {
  const key = barePath(path);
  if (!key.startsWith("/floor")) return usage;
  const next: FloorUsage = { ...usage, [key]: (usage[key] ?? 0) + 1 };
  if ((next[key] ?? 0) <= USAGE_CAP) return next;
  const halved: FloorUsage = {};
  for (const [row, count] of Object.entries(next)) {
    const value = Math.floor(count / 2);
    if (value > 0) halved[row] = value;
  }
  return halved;
}

/**
 * The paths this person taps most, best first. Only paths in `allowed` count (role and
 * Garage filters already applied); ties keep the `allowed` order so the row is stable.
 */
export function usualFloorPaths(usage: FloorUsage, allowed: readonly string[], limit = USUAL_LIMIT): string[] {
  return allowed
    .map((path, index) => ({ path, index, count: usage[barePath(path)] ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((row) => row.path);
}

// ---------------------------------------------------------------------------
// Open work per verb
// ---------------------------------------------------------------------------

export type OpenWorkJob = { verb: string; status?: string | null; assigneeId: string | null };

/**
 * Open jobs per verb that this person can take: unassigned or already theirs. Work
 * claimed by a teammate is left out so the badge only counts what they could start.
 */
export function openWorkByVerb(jobs: readonly OpenWorkJob[], userId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of jobs) {
    if (job.status && job.status !== "open" && job.status !== "claimed") continue;
    if (job.assigneeId && job.assigneeId !== userId) continue;
    counts[job.verb] = (counts[job.verb] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Next job copy
// ---------------------------------------------------------------------------

/** "B-01-01-2 → B-01-01", one side when only one is known, or null. */
export function jobBayRoute(job: { fromCode: string | null; toCode: string | null }): string | null {
  const parts = [job.fromCode, job.toCode].filter((code): code is string => Boolean(code && code.trim()));
  return parts.length ? parts.join(" → ") : null;
}

/** The ranking reason worth showing, or null when it is the default "oldest open work". */
export function jobReasonText(job: { reason?: string | null }): string | null {
  const reason = job.reason?.trim();
  if (!reason || reason === DEFAULT_JOB_REASON) return null;
  return reason;
}

// ---------------------------------------------------------------------------
// Scan feedback
// ---------------------------------------------------------------------------

export type ScanFeedbackPrefs = {
  beep: boolean;
  preferCamera: boolean;
  vibrate: boolean;
  flash: boolean;
};

export function defaultScanPrefs(): ScanFeedbackPrefs {
  return { beep: true, preferCamera: false, vibrate: true, flash: true };
}

/** Read stored scanner prefs. Feedback defaults on; camera-first defaults off. */
export function parseScanPrefs(raw: string | null | undefined): ScanFeedbackPrefs {
  if (!raw) return defaultScanPrefs();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultScanPrefs();
  }
  if (!parsed || typeof parsed !== "object") return defaultScanPrefs();
  const row = parsed as Partial<Record<keyof ScanFeedbackPrefs, unknown>>;
  return {
    beep: row.beep !== false,
    preferCamera: row.preferCamera === true,
    vibrate: row.vibrate !== false,
    flash: row.flash !== false,
  };
}

/** Short buzz for a good scan, double buzz for a bad one (ms on/off/on). */
export const SCAN_VIBRATION = {
  ok: [40] as readonly number[],
  bad: [90, 70, 90] as readonly number[],
};

export function scanVibration(accepted: boolean): number[] {
  return [...(accepted ? SCAN_VIBRATION.ok : SCAN_VIBRATION.bad)];
}

/** Every scan already beeps when it is heard; an accept right after that stays quiet so it does not double-beep. */
export const HEARD_TONE_WINDOW_MS = 1500;

export function scanResultTone(
  accepted: boolean,
  lastHeardAt: number | null,
  now: number,
): "ok" | "bad" | null {
  if (!accepted) return "bad";
  if (lastHeardAt != null && now - lastHeardAt >= 0 && now - lastHeardAt < HEARD_TONE_WINDOW_MS) return null;
  return "ok";
}
