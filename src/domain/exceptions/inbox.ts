/**
 * The exception inbox: problems scattered across Rackline gathered into one list that people claim
 * and resolve like jobs. Each problem is derived live from its source (an order whose post-back
 * failed, an open hold, a parcel stuck in transit...), so it leaves the inbox on its own once the
 * source is fixed. Only who claimed, snoozed, or resolved it is stored, keyed by source and key.
 */
import type { OperatingMode } from "../operating-mode";

export const EXCEPTION_SEVERITIES = ["blocking", "warning", "info"] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

export const SEVERITY_LABELS: Record<ExceptionSeverity, string> = {
  blocking: "Blocking",
  warning: "Warning",
  info: "Info",
};

/** Floor problems are fixed with a scanner (release a hold, recount a bay); the floor launcher lists them too. */
export type ExceptionLane = "office" | "floor";

/** An existing endpoint the inbox can run in place, with that endpoint's own guards. */
export type ExceptionAction = { id: string; label: string };

/** Which modes list a source. Garage packs away counts, EDI, and capacity, so their problems stay out too. */
export type ExceptionSourceInfo = { id: string; label: string; modes: readonly OperatingMode[] };

export type ExceptionSourceRef = Pick<ExceptionSourceInfo, "id" | "label">;

export const BOTH_MODES: readonly OperatingMode[] = ["garage", "warehouse"];
export const MANUFACTURER_ONLY: readonly OperatingMode[] = ["warehouse"];
export const GARAGE_ONLY: readonly OperatingMode[] = ["garage"];

/** Most problems one source lists; past it the inbox shows the oldest and says the source is capped. */
export const SOURCE_LIMIT = 50;

export const DAY_MS = 86_400_000;

/** One problem as its source reports it. */
export type ExceptionItem = {
  source: string;
  /** Unique within the source and stable while the problem lasts. */
  key: string;
  kind: string;
  kindLabel: string;
  severity: ExceptionSeverity;
  title: string;
  /** What happened and what fixes it, in plain words. */
  detail: string;
  /** Null for a problem not tied to one building (a store connection, a supplier's ASN): every building lists it. */
  warehouseId: string | null;
  orderId: string | null;
  itemId: string | null;
  locationId: string | null;
  /** When the problem started, as near as the source can tell; null when it cannot. */
  createdAt: number | null;
  /** The screen that fixes it. */
  link: string;
  floorLink: string | null;
  lane: ExceptionLane;
  /** Only an owner can fix it from settings, so operators do not see it. */
  ownerOnly: boolean;
  action: ExceptionAction | null;
};

export type ExceptionDraft = Pick<ExceptionItem, "source" | "key" | "kind" | "kindLabel" | "severity" | "title" | "detail" | "link"> &
  Partial<Omit<ExceptionItem, "source" | "key" | "kind" | "kindLabel" | "severity" | "title" | "detail" | "link">>;

export function exceptionItem(draft: ExceptionDraft): ExceptionItem {
  return {
    warehouseId: null,
    orderId: null,
    itemId: null,
    locationId: null,
    createdAt: null,
    floorLink: null,
    lane: "office",
    ownerOnly: false,
    action: null,
    ...draft,
  };
}

export function exceptionId(source: string, key: string): string {
  return `${source}:${key}`;
}

/** "1 unit", "3 units". */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

/** "A", "A and B", "A, B and C", "A, B and 3 more". */
export function listText(values: readonly string[], max = 3): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length > max) return `${values.slice(0, max).join(", ")} and ${values.length - max} more`;
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/** Reads a stored JSON column without trusting it. */
export function parseJsonObject(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const SEVERITY_RANK: Record<ExceptionSeverity, number> = { blocking: 0, warning: 1, info: 2 };

/** Blocking first, then oldest first. A problem with no start time goes after the dated ones of its severity. */
export function compareExceptions(
  a: Pick<ExceptionItem, "source" | "key" | "severity" | "createdAt">,
  b: Pick<ExceptionItem, "source" | "key" | "severity" | "createdAt">,
): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity) return bySeverity;
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt == null) return 1;
    if (b.createdAt == null) return -1;
    return a.createdAt - b.createdAt;
  }
  return exceptionId(a.source, a.key).localeCompare(exceptionId(b.source, b.key));
}

/** One item per source and key: the more severe one, then the one that started first. */
export function dedupeExceptions(items: readonly ExceptionItem[]): ExceptionItem[] {
  const kept = new Map<string, ExceptionItem>();
  for (const item of items) {
    const id = exceptionId(item.source, item.key);
    const current = kept.get(id);
    if (!current || compareExceptions(item, current) < 0) kept.set(id, item);
  }
  return [...kept.values()];
}

/** Sources a mode lists, in registry order. */
export function sourcesForMode<T extends ExceptionSourceInfo>(sources: readonly T[], mode: OperatingMode): T[] {
  return sources.filter((source) => source.modes.includes(mode));
}

/** What one person sees: owner-only problems drop for operators. */
export function visibleTo<T extends Pick<ExceptionItem, "ownerOnly">>(items: readonly T[], role: string): T[] {
  return role === "owner" ? [...items] : items.filter((item) => !item.ownerOnly);
}

/** A problem tied to no building shows in every building. */
export function inBuilding<T extends Pick<ExceptionItem, "warehouseId">>(items: readonly T[], warehouseId: string): T[] {
  return items.filter((item) => item.warehouseId === null || item.warehouseId === warehouseId);
}

/** The stored state for one problem, with names for the people on it. */
export type ExceptionClaim = {
  source: string;
  key: string;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAt: number | null;
  snoozedUntil: number | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
};

export type ExceptionState = "open" | "snoozed" | "resolved";

export type ExceptionView = ExceptionItem & {
  id: string;
  state: ExceptionState;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAt: number | null;
  snoozedUntil: number | null;
  resolvedAt: number | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
};

/**
 * The claim that still applies. A resolution made before the problem last started belongs to an
 * earlier occurrence: the problem came back, so it reads as new and unclaimed.
 */
export function currentClaim(item: Pick<ExceptionItem, "createdAt">, claim: ExceptionClaim | null | undefined): ExceptionClaim | null {
  if (!claim) return null;
  if (claim.resolvedAt != null && item.createdAt != null && item.createdAt > claim.resolvedAt) return null;
  return claim;
}

export function exceptionState(claim: ExceptionClaim | null, now: number): ExceptionState {
  if (claim?.resolvedAt != null) return "resolved";
  if (claim?.snoozedUntil != null && claim.snoozedUntil > now) return "snoozed";
  return "open";
}

export function exceptionView(item: ExceptionItem, stored: ExceptionClaim | null | undefined, now: number): ExceptionView {
  const claim = currentClaim(item, stored);
  const state = exceptionState(claim, now);
  return {
    ...item,
    id: exceptionId(item.source, item.key),
    state,
    claimedBy: claim?.claimedBy ?? null,
    claimedByName: claim?.claimedBy ? (claim.claimedByName ?? null) : null,
    claimedAt: claim?.claimedBy ? (claim.claimedAt ?? null) : null,
    snoozedUntil: state === "snoozed" ? claim!.snoozedUntil : null,
    resolvedAt: state === "resolved" ? claim!.resolvedAt : null,
    resolvedByName: state === "resolved" ? (claim!.resolvedByName ?? null) : null,
    resolutionNote: state === "resolved" ? (claim!.resolutionNote ?? null) : null,
  };
}

/** Items with their claims, deduped and sorted. */
export function buildInbox(items: readonly ExceptionItem[], claims: readonly ExceptionClaim[], now: number): ExceptionView[] {
  const byId = new Map(claims.map((claim) => [exceptionId(claim.source, claim.key), claim]));
  return dedupeExceptions(items)
    .sort(compareExceptions)
    .map((item) => exceptionView(item, byId.get(exceptionId(item.source, item.key)), now));
}

export type ExceptionCounts = {
  open: number;
  blocking: number;
  mine: number;
  unclaimed: number;
  floor: number;
  snoozed: number;
  resolved: number;
};

export function countExceptions(views: readonly ExceptionView[], userId: string): ExceptionCounts {
  const counts: ExceptionCounts = { open: 0, blocking: 0, mine: 0, unclaimed: 0, floor: 0, snoozed: 0, resolved: 0 };
  for (const view of views) {
    if (view.state === "snoozed") counts.snoozed += 1;
    if (view.state === "resolved") counts.resolved += 1;
    if (view.state !== "open") continue;
    counts.open += 1;
    if (view.severity === "blocking") counts.blocking += 1;
    if (view.lane === "floor") counts.floor += 1;
    if (!view.claimedBy) counts.unclaimed += 1;
    else if (view.claimedBy === userId) counts.mine += 1;
  }
  return counts;
}

export type ExceptionInbox = {
  items: ExceptionView[];
  counts: ExceptionCounts;
  /** What this mode watches, in registry order. */
  sources: ExceptionSourceRef[];
  /** Sources that hit `SOURCE_LIMIT`; the inbox shows their oldest problems only. */
  capped: ExceptionSourceRef[];
  /** Sources that could not be read this time. Their problems are missing, not fixed. */
  failed: ExceptionSourceRef[];
};

export type ExceptionVerb = "claim" | "unclaim" | "snooze" | "resolve" | "reopen" | "action";

export type ClaimPatch = {
  claimedBy: string | null;
  claimedAt: number | null;
  snoozedUntil: number | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
};

export type ClaimRequest =
  | { verb: "claim"; takeOver?: boolean }
  | { verb: "unclaim" }
  | { verb: "snooze"; until: number }
  | { verb: "resolve"; note: string }
  | { verb: "reopen" }
  | { verb: "action" };

export type ClaimDecision =
  | { ok: true; patch: ClaimPatch }
  | { ok: false; code: "EXCEPTION_CLAIMED" | "EXCEPTION_RESOLVED"; error: string };

function claimedByText(claim: ExceptionClaim): string {
  return `${claim.claimedByName || "Someone else"} has claimed this.`;
}

/**
 * Like a floor job: anyone can take an unclaimed problem, and a claimed one is its claimer's. An owner
 * can unclaim it, take it over, or act on it anyway; an operator gets EXCEPTION_CLAIMED.
 */
export function decideClaim(
  stored: ExceptionClaim | null,
  request: ClaimRequest,
  viewer: { userId: string; role: string; now: number },
): ClaimDecision {
  const { userId, now } = viewer;
  const owner = viewer.role === "owner";
  const claim = stored;
  const base: ClaimPatch = {
    claimedBy: claim?.claimedBy ?? null,
    claimedAt: claim?.claimedAt ?? null,
    snoozedUntil: claim?.snoozedUntil ?? null,
    resolvedAt: claim?.resolvedAt ?? null,
    resolvedBy: claim?.resolvedBy ?? null,
    resolutionNote: claim?.resolutionNote ?? null,
  };
  const heldByOther = Boolean(claim?.claimedBy && claim.claimedBy !== userId);
  const refuse = (): ClaimDecision => ({
    ok: false,
    code: "EXCEPTION_CLAIMED",
    error: `${claimedByText(claim!)} ${owner ? "Take it over to work on it." : "Ask them or an owner to unclaim it."}`,
  });

  switch (request.verb) {
    case "claim": {
      if (heldByOther && !(owner && request.takeOver)) return refuse();
      const already = claim?.claimedBy === userId && claim.resolvedAt == null;
      return {
        ok: true,
        patch: {
          claimedBy: userId,
          claimedAt: already ? (claim!.claimedAt ?? now) : now,
          snoozedUntil: null,
          resolvedAt: null,
          resolvedBy: null,
          resolutionNote: null,
        },
      };
    }
    case "unclaim":
      if (heldByOther && !owner) return refuse();
      return { ok: true, patch: { ...base, claimedBy: null, claimedAt: null } };
    case "snooze":
      if (heldByOther && !owner) return refuse();
      if (claim?.resolvedAt != null) return resolvedAlready();
      return { ok: true, patch: { ...base, snoozedUntil: request.until } };
    case "resolve":
      if (heldByOther && !owner) return refuse();
      if (claim?.resolvedAt != null) return resolvedAlready();
      return { ok: true, patch: { ...base, snoozedUntil: null, resolvedAt: now, resolvedBy: userId, resolutionNote: request.note } };
    case "reopen":
      if (heldByOther && !owner) return refuse();
      return { ok: true, patch: { ...base, snoozedUntil: null, resolvedAt: null, resolvedBy: null, resolutionNote: null } };
    case "action":
      if (heldByOther && !owner) return refuse();
      return { ok: true, patch: base };
  }
}

function resolvedAlready(): ClaimDecision {
  return { ok: false, code: "EXCEPTION_RESOLVED", error: "This is already resolved. Reopen it first." };
}

/** Snooze lengths the inbox offers, in hours. */
export const SNOOZE_HOURS = [1, 4, 24, 72, 168] as const;
export const MAX_SNOOZE_HOURS = 336;

export function snoozeLabel(hours: number): string {
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;
  const days = Math.round(hours / 24);
  if (days === 7) return "1 week";
  return days === 1 ? "1 day" : `${days} days`;
}

/** When a snooze of `hours` ends, or null when the length is not a whole number of hours up to two weeks. */
export function snoozeUntil(hours: unknown, now: number): number | null {
  const n = typeof hours === "number" ? hours : typeof hours === "string" && hours.trim() ? Number(hours) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_SNOOZE_HOURS) return null;
  return now + n * 3_600_000;
}

export const RESOLUTION_NOTE_MAX = 500;

/** The trimmed note, or null when it is blank. Long notes are cut, not refused. */
export function resolutionNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > RESOLUTION_NOTE_MAX ? `${text.slice(0, RESOLUTION_NOTE_MAX - 1).trimEnd()}…` : text;
}

export const EXCEPTION_AUDIT_ACTIONS: Record<ExceptionVerb, string> = {
  claim: "exception.claim",
  unclaim: "exception.unclaim",
  snooze: "exception.snooze",
  resolve: "exception.resolve",
  reopen: "exception.reopen",
  action: "exception.action",
};

/** The audit row's one-line summary: "Resolved: Order 1042 is going back to the sender (customer refunded)". */
export function exceptionAuditSummary(
  verb: ExceptionVerb,
  item: Pick<ExceptionItem, "title">,
  extra: { takeOver?: boolean; hours?: number; note?: string; actionLabel?: string } = {},
): string {
  switch (verb) {
    case "claim":
      return `${extra.takeOver ? "Took over" : "Claimed"}: ${item.title}`;
    case "unclaim":
      return `Unclaimed: ${item.title}`;
    case "snooze":
      return `Snoozed${extra.hours ? ` ${snoozeLabel(extra.hours)}` : ""}: ${item.title}`;
    case "resolve":
      return `Resolved: ${item.title}${extra.note ? ` (${extra.note})` : ""}`;
    case "reopen":
      return `Reopened: ${item.title}`;
    case "action":
      return `${extra.actionLabel ?? "Ran action"}: ${item.title}`;
  }
}
