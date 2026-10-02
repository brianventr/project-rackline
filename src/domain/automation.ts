/**
 * How the automation map drives replenishment, reorder alerts, and operator reminders.
 * Restock policy and customer email stay on their own columns; this object is the rest.
 * Defaults match the behavior from before the map existed.
 */

export const REPLENISH_MODES = ["suggest", "auto_queue"] as const;
export type ReplenishMode = (typeof REPLENISH_MODES)[number];

export const BULK_GAPS = ["silent", "exception"] as const;
export type BulkGap = (typeof BULK_GAPS)[number];

export const REORDER_ALERTS = ["today", "exception"] as const;
export type ReorderAlert = (typeof REORDER_ALERTS)[number];

export const REMIND_HOURS_MAX = 336;

export type AutomationPolicy = {
  /** Suggest a floor job, or open a draft replenishment when bulk can cover the pick face. */
  replenishMode: ReplenishMode;
  /** A pick face below its minimum with nothing in bulk. */
  bulkGap: BulkGap;
  /** Hours an open replenishment may sit before an exception. Null leaves it quiet. */
  remindOpenAfterHours: number | null;
  /** Below reorder point stays on Today, and can also enter Exceptions. */
  reorderAlert: ReorderAlert;
};

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  replenishMode: "suggest",
  bulkGap: "silent",
  remindOpenAfterHours: null,
  reorderAlert: "today",
};

export const HOUR_MS = 3_600_000;

export function isReplenishMode(value: unknown): value is ReplenishMode {
  return value === "suggest" || value === "auto_queue";
}

export function isBulkGap(value: unknown): value is BulkGap {
  return value === "silent" || value === "exception";
}

export function isReorderAlert(value: unknown): value is ReorderAlert {
  return value === "today" || value === "exception";
}

function readHours(value: unknown, strict: boolean): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > REMIND_HOURS_MAX) {
    if (strict) throw new Error(`Reminder hours must be a whole number from 1 to ${REMIND_HOURS_MAX}, or off.`);
    return null;
  }
  return n;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** A stored JSON column. Unknown or partial values fall back to the defaults. */
export function automationPolicyFromStored(value: unknown): AutomationPolicy {
  const body = asRecord(value);
  if (!body) return { ...DEFAULT_AUTOMATION_POLICY };
  return {
    replenishMode: isReplenishMode(body.replenishMode) ? body.replenishMode : DEFAULT_AUTOMATION_POLICY.replenishMode,
    bulkGap: isBulkGap(body.bulkGap) ? body.bulkGap : DEFAULT_AUTOMATION_POLICY.bulkGap,
    remindOpenAfterHours: readHours(body.remindOpenAfterHours, false),
    reorderAlert: isReorderAlert(body.reorderAlert) ? body.reorderAlert : DEFAULT_AUTOMATION_POLICY.reorderAlert,
  };
}

/** A publish from the map. Every field must be explicit. */
export function parseAutomationPolicy(value: unknown): AutomationPolicy {
  const body = asRecord(value);
  if (!body) throw new Error("Automation policy is missing.");
  if (!isReplenishMode(body.replenishMode)) throw new Error("Replenish mode must be suggest or auto-queue.");
  if (!isBulkGap(body.bulkGap)) throw new Error("Choose silent or an exception when bulk is empty.");
  if (!isReorderAlert(body.reorderAlert)) throw new Error("Reorder alerts stay on Today, or also enter Exceptions.");
  return {
    replenishMode: body.replenishMode,
    bulkGap: body.bulkGap,
    remindOpenAfterHours: readHours(body.remindOpenAfterHours, true),
    reorderAlert: body.reorderAlert,
  };
}

export function automationPolicyJson(policy: AutomationPolicy): string {
  return JSON.stringify(policy);
}

/** Suggestions that do not already have an open replenishment for the same item and pick face. */
export function uncoveredSuggestions<T extends { itemId: string; toLocationId: string }>(
  suggestions: readonly T[],
  open: readonly { itemId: string; toLocationId: string }[],
): T[] {
  const covered = new Set(open.map((row) => `${row.itemId}:${row.toLocationId}`));
  return suggestions.filter((row) => !covered.has(`${row.itemId}:${row.toLocationId}`));
}

export function replenishmentReminderDue(createdAt: number, now: number, hours: number | null): boolean {
  if (hours == null) return false;
  return createdAt + hours * HOUR_MS <= now;
}
